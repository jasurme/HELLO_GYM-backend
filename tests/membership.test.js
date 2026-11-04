const {
  app, request, SEED, PLANS, loginAs, uniqueEmail, futureWeekday, isoDate, memberWithPlan,
} = require('./helpers');

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
};

describe('memberships and payments', () => {
  let admin;

  beforeAll(async () => {
    admin = await loginAs(SEED.admin);
  });

  // A visitor who signs up online with a 1 Month membership (paid at once).
  async function newMemberAgent(planId = PLANS.month) {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/register').send({
      email: uniqueEmail('buyer'), password: 'Buyer1234', firstName: 'Buy', lastName: 'Er', planId,
    });
    expect(res.status).toBe(201);
    const overview = await agent.get('/api/member/overview');
    return { agent, memberId: res.body.userId, current: overview.body.current };
  }

  test('a membership ends the day before the same date n months later', async () => {
    const { current } = await newMemberAgent(PLANS.month);
    const [y, m, d] = current.startDate.split('-').map(Number);
    const expectedEnd = isoDate(new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()) - 1));
    expect(current).toMatchObject({ planName: '1 Month', status: 'active', endDate: expectedEnd, paidKrw: 70000 });
  });

  test('renewing online is one step: paid at once, or nothing at all when the card is declined', async () => {
    const { agent, current } = await newMemberAgent(PLANS.month); // within 30 days of its end

    const declined = await agent.post('/api/member/subscriptions').send({ planId: PLANS.quarter, simulateFailure: true });
    expect(declined.status).toBe(402);
    expect((await agent.get('/api/member/subscriptions')).body).toHaveLength(1);

    const renewal = await agent.post('/api/member/subscriptions').send({ planId: PLANS.quarter });
    expect(renewal.status).toBe(201);
    expect(renewal.body).toMatchObject({ planName: '3 Months', status: 'upcoming', balanceKrw: 0, startDate: addDays(current.endDate, 1) });
    expect(renewal.body.payments).toEqual([expect.objectContaining({ status: 'paid', method: 'online', amountKrw: 189000 })]);

    // One renewal ahead at most
    const second = await agent.post('/api/member/subscriptions').send({ planId: PLANS.quarter });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/already renewed/);
  });

  test('renewing is only offered within 30 days of the end date', async () => {
    const minji = await loginAs(SEED.minji); // 6 Months with ~140 days left
    const res = await minji.post('/api/member/subscriptions').send({ planId: PLANS.month });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/within 30 days/);
  });

  test('a membership the desk left awaiting payment can be paid online', async () => {
    const m = await memberWithPlan(admin, { planId: PLANS.month });
    const queued = await admin.post('/api/admin/subscriptions').send({ memberId: m.memberId, planId: PLANS.quarter });
    expect(queued.body.status).toBe('pending_payment');
    await admin.post('/api/admin/payments').send({
      subscriptionId: queued.body.subscriptionId, amountKrw: 189000, method: 'bank_transfer', status: 'pending',
    });

    const overview = await m.agent.get('/api/member/overview');
    expect(overview.body.unpaid.map((u) => u.subscriptionId)).toEqual([queued.body.subscriptionId]);
    const blocked = await m.agent.post('/api/member/subscriptions').send({ planId: PLANS.month });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/finish paying/);

    // A declined checkout is recorded as a failed payment; the balance stays
    const declined = await m.agent.post(`/api/member/subscriptions/${queued.body.subscriptionId}/checkout`).send({ simulateFailure: true });
    expect(declined.status).toBe(402);
    const afterDecline = await m.agent.get(`/api/member/subscriptions/${queued.body.subscriptionId}`);
    expect(afterDecline.body.status).toBe('pending_payment');
    expect(afterDecline.body.payments.map((x) => x.status)).toEqual(['failed']);

    const paid = await m.agent.post(`/api/member/subscriptions/${queued.body.subscriptionId}/checkout`).send({});
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: 'upcoming', paidKrw: 189000, balanceKrw: 0 });
  });

  test('the desk cannot sell overlapping subscriptions (R6) or take more than the price (R9)', async () => {
    const m = await memberWithPlan(admin, { planId: PLANS.month });
    const overlap = await admin.post('/api/admin/subscriptions').send({ memberId: m.memberId, planId: PLANS.quarter, startDate: m.subscription.startDate });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.rule).toBe('R6');

    const extra = await admin.post('/api/admin/payments').send({ subscriptionId: m.subscription.subscriptionId, amountKrw: 1000, method: 'cash' });
    expect(extra.status).toBe(409);
    expect(extra.body.error.rule).toBe('R9');

    // Without a start date, the desk sale queues after the current plan.
    const queued = await admin.post('/api/admin/subscriptions').send({ memberId: m.memberId, planId: PLANS.month });
    expect(queued.status).toBe(201);
    expect(queued.body.startDate).toBe(addDays(m.subscription.endDate, 1));
  });

  test('payment status changes follow the lifecycle', async () => {
    const m = await memberWithPlan(admin, { planId: PLANS.month });
    const sub = await admin.post('/api/admin/subscriptions').send({ memberId: m.memberId, planId: PLANS.month });
    const pending = await admin.post('/api/admin/payments').send({ subscriptionId: sub.body.subscriptionId, amountKrw: 70000, method: 'bank_transfer', status: 'pending' });
    expect(pending.status).toBe(201);
    expect((await admin.patch(`/api/admin/payments/${pending.body.paymentId}`).send({ status: 'paid' })).status).toBe(200);
    const back = await admin.patch(`/api/admin/payments/${pending.body.paymentId}`).send({ status: 'failed' });
    expect(back.status).toBe(409);
    expect(back.body.error.message).toMatch(/cannot go from paid to failed/);
    expect((await admin.patch(`/api/admin/payments/${pending.body.paymentId}`).send({ status: 'refunded' })).status).toBe(200);
  });

  test('a freeze pushes the end date back and blocks bookings in that period (R10)', async () => {
    const m = await memberWithPlan(admin, { planId: PLANS.year });
    const freezeStart = futureWeekday(1, 10);
    const frozen = await admin.post(`/api/admin/subscriptions/${m.subscription.subscriptionId}/freezes`)
      .send({ freezeStart, days: 7, reason: 'Trip' });
    expect(frozen.status).toBe(201);
    expect(frozen.body.endDate).toBe(addDays(m.subscription.endDate, 7));

    const during = await m.agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${addDays(freezeStart, 2)} 08:00`, duration: 60 });
    expect(during.status).toBe(409);
    expect(during.body.error.message).toMatch(/frozen/);

    // Overlapping freeze refused by the trigger
    const again = await admin.post(`/api/admin/subscriptions/${m.subscription.subscriptionId}/freezes`).send({ freezeStart: addDays(freezeStart, 3), days: 5 });
    expect(again.status).toBe(409);
    expect(again.body.error.rule).toBe('R10');

    // Removing the (future) freeze gives the days back
    const detail = await admin.get(`/api/admin/subscriptions/${m.subscription.subscriptionId}`);
    expect((await admin.delete(`/api/admin/freezes/${detail.body.freezes[0].freezeId}`)).status).toBe(204);
    const after = await admin.get(`/api/admin/subscriptions/${m.subscription.subscriptionId}`);
    expect(after.body.endDate).toBe(m.subscription.endDate);
  });

  test('cancelling a membership cancels and refunds its future sessions, and can refund the membership', async () => {
    const m = await memberWithPlan(admin, { planId: PLANS.year });
    const day = futureWeekday(5, 30);
    const b = await m.agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${day} 09:00`, duration: 60 });
    expect(b.status).toBe(201);

    const cancelled = await admin.post(`/api/admin/subscriptions/${m.subscription.subscriptionId}/cancel`).send({ refund: true });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ cancelledSessions: 1, refundedKrw: 600000 });
    expect(cancelled.body.subscription.status).toBe('cancelled');

    const sessions = await m.agent.get('/api/member/bookings').query({ scope: 'past' });
    expect(sessions.body.find((s) => s.bookingId === b.body.bookingId)).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' });
  });

  test('plans: price changes keep sold prices; sold plans cannot be deleted', async () => {
    const created = await admin.post('/api/admin/plans').send({ planName: `Test plan ${Date.now()}`, durationMonths: 1, priceKrw: 50000 });
    expect(created.status).toBe(201);
    const m = await memberWithPlan(admin, { planId: created.body.planId });
    await admin.patch(`/api/admin/plans/${created.body.planId}`).send({ priceKrw: 99000 });
    const sub = await admin.get(`/api/admin/subscriptions/${m.subscription.subscriptionId}`);
    expect(sub.body.priceKrw).toBe(50000);

    const del = await admin.delete(`/api/admin/plans/${created.body.planId}`);
    expect(del.status).toBe(409);
    expect((await admin.patch(`/api/admin/plans/${created.body.planId}`).send({ isActive: false })).status).toBe(200);
    expect((await request(app).get('/api/plans')).body.some((p) => p.planId === created.body.planId)).toBe(false);
  });
});
