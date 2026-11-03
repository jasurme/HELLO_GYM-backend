const {
  app, request, SEED, loginAs, uniqueEmail, futureWeekday, isoDate, memberWithPlan,
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

  async function newMemberAgent() {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/register').send({
      email: uniqueEmail('buyer'), password: 'Buyer1234', firstName: 'Buy', lastName: 'Er',
    });
    return { agent, memberId: res.body.userId };
  }

  test('buying online creates a subscription awaiting payment; checkout activates it', async () => {
    const { agent } = await newMemberAgent();
    const bought = await agent.post('/api/member/subscriptions').send({ planId: 3 });
    expect(bought.status).toBe(201);
    expect(bought.body).toMatchObject({ planName: 'PT Monthly', status: 'pending_payment', balanceKrw: 290000 });
    expect(bought.body.payments).toEqual([expect.objectContaining({ status: 'pending', method: 'online', amountKrw: 290000 })]);

    // Cannot book before paying (R1)
    const early = await agent.post('/api/member/bookings').send({ trainerId: SEED.otherTrainerId, startsAt: `${futureWeekday(2, 3)} 10:00`, duration: 60 });
    expect(early.status).toBe(409);
    expect(early.body.error.rule).toBe('R1');

    // A simulated decline is recorded as a failed payment; the balance stays.
    const declined = await agent.post(`/api/member/subscriptions/${bought.body.subscriptionId}/checkout`).send({ simulateFailure: true });
    expect(declined.status).toBe(402);
    const afterDecline = await agent.get(`/api/member/subscriptions/${bought.body.subscriptionId}`);
    expect(afterDecline.body.status).toBe('pending_payment');
    expect(afterDecline.body.payments.map((p) => p.status)).toEqual(['failed']);

    const paid = await agent.post(`/api/member/subscriptions/${bought.body.subscriptionId}/checkout`).send({});
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: 'active', paidKrw: 290000, balanceKrw: 0 });
    expect(paid.body.payments.map((p) => p.status)).toEqual(['failed', 'paid']);

    const overview = await agent.get('/api/member/overview');
    expect(overview.body.current.status).toBe('active');
    expect(overview.body.usage).toEqual({ quota: 4, used: 0, remaining: 4 });
  });

  test('the end date is start + duration − 1 day, and renewals queue after it', async () => {
    const { agent } = await newMemberAgent();
    const first = await agent.post('/api/member/subscriptions').send({ planId: 1 });
    const today = first.body.startDate;
    const [y, m, d] = today.split('-').map(Number);
    const expectedEnd = isoDate(new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()) - 1));
    expect(first.body.endDate).toBe(expectedEnd);

    // Unpaid → no second purchase yet
    const blocked = await agent.post('/api/member/subscriptions').send({ planId: 1 });
    expect(blocked.status).toBe(409);
    await agent.post(`/api/member/subscriptions/${first.body.subscriptionId}/checkout`).send({});

    // Within 30 days of the end → renewal starts the day after the current end
    const renewal = await agent.post('/api/member/subscriptions').send({ planId: 2 });
    expect(renewal.status).toBe(201);
    expect(renewal.body.startDate).toBe(addDays(first.body.endDate, 1));
    expect(renewal.body.status).toBe('pending_payment');

    // A second renewal is refused
    expect((await agent.post('/api/member/subscriptions').send({ planId: 2 })).status).toBe(409);
  });

  test('renewing is only offered within 30 days of the end date', async () => {
    const minji = await loginAs(SEED.minji); // Premium with ~140 days left
    const res = await minji.post('/api/member/subscriptions').send({ planId: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/within 30 days/);
  });

  test('a member can drop an unpaid order but not a paid one', async () => {
    const { agent } = await newMemberAgent();
    const sub = await agent.post('/api/member/subscriptions').send({ planId: 1 });
    const dropped = await agent.post(`/api/member/subscriptions/${sub.body.subscriptionId}/cancel`);
    expect(dropped.status).toBe(200);
    expect(dropped.body.status).toBe('cancelled');
    expect(dropped.body.payments[0].status).toBe('failed');

    const paid = await memberWithPlan(admin, { planId: 1 });
    const refused = await paid.agent.post(`/api/member/subscriptions/${paid.subscription.subscriptionId}/cancel`);
    expect(refused.status).toBe(409);
  });

  test('the desk cannot sell overlapping subscriptions (R6) or take more than the price (R9)', async () => {
    const m = await memberWithPlan(admin, { planId: 1 });
    const overlap = await admin.post('/api/admin/subscriptions').send({ memberId: m.memberId, planId: 2, startDate: m.subscription.startDate });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.rule).toBe('R6');

    const extra = await admin.post('/api/admin/payments').send({ subscriptionId: m.subscription.subscriptionId, amountKrw: 1000, method: 'cash' });
    expect(extra.status).toBe(409);
    expect(extra.body.error.rule).toBe('R9');

    // Without a start date, the desk sale queues after the current plan.
    const queued = await admin.post('/api/admin/subscriptions').send({ memberId: m.memberId, planId: 1 });
    expect(queued.status).toBe(201);
    expect(queued.body.startDate).toBe(addDays(m.subscription.endDate, 1));
  });

  test('payment status changes follow the lifecycle', async () => {
    const m = await memberWithPlan(admin, { planId: 1 });
    const sub = await admin.post('/api/admin/subscriptions').send({ memberId: m.memberId, planId: 1 });
    const pending = await admin.post('/api/admin/payments').send({ subscriptionId: sub.body.subscriptionId, amountKrw: 70000, method: 'bank_transfer', status: 'pending' });
    expect(pending.status).toBe(201);
    expect((await admin.patch(`/api/admin/payments/${pending.body.paymentId}`).send({ status: 'paid' })).status).toBe(200);
    const back = await admin.patch(`/api/admin/payments/${pending.body.paymentId}`).send({ status: 'failed' });
    expect(back.status).toBe(409);
    expect(back.body.error.message).toMatch(/cannot go from paid to failed/);
    expect((await admin.patch(`/api/admin/payments/${pending.body.paymentId}`).send({ status: 'refunded' })).status).toBe(200);
  });

  test('a freeze pushes the end date back and blocks bookings in that period (R10)', async () => {
    const m = await memberWithPlan(admin, { planId: 4 });
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

  test('cancelling a subscription cancels its future sessions and can refund', async () => {
    const m = await memberWithPlan(admin, { planId: 4 });
    const day = futureWeekday(5, 30);
    const b = await m.agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${day} 09:00`, duration: 60 });
    expect(b.status).toBe(201);

    const cancelled = await admin.post(`/api/admin/subscriptions/${m.subscription.subscriptionId}/cancel`).send({ refund: true });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ cancelledSessions: 1, refundedKrw: 790000 });
    expect(cancelled.body.subscription.status).toBe('cancelled');

    const sessions = await m.agent.get('/api/member/bookings').query({ scope: 'past' });
    expect(sessions.body.find((s) => s.bookingId === b.body.bookingId).status).toBe('cancelled');
  });

  test('plans: price changes keep sold prices; sold plans cannot be deleted', async () => {
    const created = await admin.post('/api/admin/plans').send({ planName: `Test plan ${Date.now()}`, durationMonths: 1, priceKrw: 50000, sessionsPerMonth: 2 });
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
