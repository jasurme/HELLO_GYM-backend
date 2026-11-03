const {
  SEED, loginAs, futureWeekday, isoDate, memberWithPlan,
} = require('./helpers');
const { sequelize } = require('../src/models');

describe('booking personal-training sessions', () => {
  let admin;

  beforeAll(async () => {
    admin = await loginAs(SEED.admin);
  });

  test('slot finder lists only times inside the trainer hours, marking taken ones', async () => {
    const { agent } = await memberWithPlan(admin);
    const monday = futureWeekday(1, 25); // past the seeded bookings
    const res = await agent.get(`/api/member/trainers/${SEED.trainerId}/slots`).query({ date: monday, duration: 60 });
    expect(res.status).toBe(200);
    // Daniel: Mon 07:00–11:00 and 17:00–21:00 → 60-minute starts every 30 min
    expect(res.body.windows).toEqual([{ startTime: '07:00', endTime: '11:00' }, { startTime: '17:00', endTime: '21:00' }]);
    expect(res.body.slots.map((s) => s.time)).toEqual(['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00',
      '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00']);
    expect(res.body.eligibility).toMatchObject({ eligible: true, quota: 4 });

    const sunday = futureWeekday(7, 25);
    const off = await agent.get(`/api/member/trainers/${SEED.trainerId}/slots`).query({ date: sunday });
    expect(off.body.windows).toEqual([]);
    expect(off.body.slots).toEqual([]);
  });

  test('a member books a slot, which then shows as taken for others', async () => {
    const a = await memberWithPlan(admin);
    const b = await memberWithPlan(admin);
    const day = futureWeekday(2, 26);
    const booked = await a.agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${day} 08:00`, duration: 60, memberNote: 'legs' });
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({ status: 'booked', startsAt: `${day} 08:00:00`, endsAt: `${day} 09:00:00`, durationMin: 60, memberNote: 'legs' });

    const slots = await b.agent.get(`/api/member/trainers/${SEED.trainerId}/slots`).query({ date: day, duration: 60 });
    const byTime = Object.fromEntries(slots.body.slots.map((s) => [s.time, s.reason]));
    expect(byTime['07:30']).toBe('taken'); // 07:30–08:30 overlaps
    expect(byTime['08:00']).toBe('taken');
    expect(byTime['09:00']).toBe(null);
  });

  test('double booking a trainer is refused (R2), double booking a member too (R3)', async () => {
    const a = await memberWithPlan(admin);
    const b = await memberWithPlan(admin);
    const day = futureWeekday(3, 27);
    expect((await a.agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${day} 17:00`, duration: 90 })).status).toBe(201);

    const clash = await b.agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${day} 18:00`, duration: 60 });
    expect(clash.status).toBe(409);
    expect(clash.body.error.rule).toBe('R2');

    const self = await a.agent.post('/api/member/bookings').send({ trainerId: SEED.otherTrainerId, startsAt: `${day} 18:00`, duration: 60 });
    expect(self.status).toBe(409);
    expect(self.body.error.rule).toBe('R3');
  });

  test('simultaneous requests for the same slot: exactly one succeeds', async () => {
    const members = await Promise.all([1, 2, 3, 4, 5].map((n) => memberWithPlan(admin, { firstName: `Racer${n}` })));
    const day = futureWeekday(4, 28);
    const results = await Promise.all(members.map((m) => m.agent.post('/api/member/bookings')
      .send({ trainerId: SEED.trainerId, startsAt: `${day} 07:00`, duration: 60 })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.rule).toBe('R2');

    const [[count]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM bookings WHERE trainer_id = ${SEED.trainerId} AND starts_at = '${day} 07:00:00' AND status <> 'cancelled'`,
    );
    expect(count.n).toBe(1);
  });

  test('outside working hours is refused (R4)', async () => {
    const { agent } = await memberWithPlan(admin);
    const res = await agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${futureWeekday(1, 25)} 13:00`, duration: 60 });
    expect(res.status).toBe(409);
    expect(res.body.error.rule).toBe('R4');
  });

  test('the monthly quota is enforced (R5) and cancelled sessions free it again', async () => {
    const { agent } = await memberWithPlan(admin); // 4 sessions / month
    // Five weekdays in one calendar month, past the seeded bookings (21 days)
    // and inside the 60-day booking window.
    const weekdaysFrom = (from) => {
      const out = [];
      for (const d = new Date(from); out.length < 5 && d.getMonth() === from.getMonth(); d.setDate(d.getDate() + 1)) {
        if (((d.getDay() + 6) % 7) + 1 <= 5) out.push(isoDate(d));
      }
      return out;
    };
    const start = new Date();
    start.setDate(start.getDate() + 22);
    let days = weekdaysFrom(start);
    if (days.length < 5) days = weekdaysFrom(new Date(start.getFullYear(), start.getMonth() + 1, 1));
    const ids = [];
    for (const day of days.slice(0, 4)) {
      const r = await agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${day} 20:00`, duration: 60 });
      expect(r.status).toBe(201);
      ids.push(r.body.bookingId);
    }
    const fifth = await agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${days[4]} 20:00`, duration: 60 });
    expect(fifth.status).toBe(409);
    expect(fifth.body.error.rule).toBe('R5');
    expect(fifth.body.error.message).toMatch(/used all 4 sessions/);

    expect((await agent.post(`/api/member/bookings/${ids[0]}/cancel`)).status).toBe(200);
    expect((await agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${days[4]} 20:00`, duration: 60 })).status).toBe(201);
  });

  test.each([
    ['joonho', 'R1', /membership ends on/],
    ['sara', 'R1', /not fully paid/],
    ['ethan', 'R1', /frozen/],
    ['taeyang', 'R5', /does not include personal training/],
  ])('%s cannot book: %s', async (who, rule, message) => {
    const agent = await loginAs(SEED[who]);
    const day = futureWeekday(5, 2); // within the next 2 weeks (inside the frozen/unpaid period)
    const res = await agent.post('/api/member/bookings').send({ trainerId: SEED.otherTrainerId, startsAt: `${day} 10:00`, duration: 60 });
    expect(res.status).toBe(409);
    expect(res.body.error.rule).toBe(rule);
    expect(res.body.error.message).toMatch(message);
  });

  test('invalid lengths, off-grid times, past times and short notice are refused', async () => {
    const { agent } = await memberWithPlan(admin);
    const day = futureWeekday(1, 25);
    expect((await agent.post('/api/member/bookings').send({ trainerId: 3, startsAt: `${day} 08:00`, duration: 45 })).status).toBe(400);
    expect((await agent.post('/api/member/bookings').send({ trainerId: 3, startsAt: `${day} 08:15`, duration: 60 })).status).toBe(400);
    expect((await agent.post('/api/member/bookings').send({ trainerId: 3, startsAt: '2020-01-06 08:00', duration: 60 })).status).toBe(409);
    const soon = new Date(Date.now() + 30 * 60000);
    soon.setMinutes(soon.getMinutes() < 30 ? 30 : 60, 0, 0);
    const soonText = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')} ${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
    const late = await agent.post('/api/member/bookings').send({ trainerId: 3, startsAt: soonText, duration: 60 });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/at least 60 minutes ahead|already passed/);
  });

  test('members cancel up to 12 hours before; the desk can still cancel later', async () => {
    const m = await memberWithPlan(admin);
    // A session ~2 hours from now (next :00/:30). Late at night, use 01:00 tomorrow instead,
    // which is still less than 12 hours away and keeps the session inside one day.
    const start = new Date(Date.now() + 2 * 3600000);
    start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
    if (start.getHours() >= 23 || start.getHours() < 1) {
      start.setTime(new Date(start.getFullYear(), start.getMonth(), start.getDate() + (start.getHours() >= 23 ? 1 : 0), 1, 0).getTime());
    }
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const end = new Date(start.getTime() + 30 * 60000);

    // A fresh trainer whose only window is exactly that half hour.
    const trainer = await admin.post('/api/admin/trainers').send({
      email: `late.${Date.now()}@binaryfit.test`, password: 'Trainer123', firstName: 'Late', lastName: 'Coach', specialization: 'Testing',
    });
    expect(trainer.status).toBe(201);
    const window = await admin.post(`/api/admin/trainers/${trainer.body.userId}/availability`)
      .send({ dayOfWeek: ((start.getDay() + 6) % 7) + 1, startTime: hhmm(start), endTime: hhmm(end) });
    expect(window.status).toBe(201);

    const day = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const booking = await admin.post('/api/admin/bookings').send({
      memberId: m.memberId, trainerId: trainer.body.userId, startsAt: `${day} ${hhmm(start)}`, duration: 30,
    });
    expect(booking.status).toBe(201);

    const memberCancel = await m.agent.post(`/api/member/bookings/${booking.body.bookingId}/cancel`);
    expect(memberCancel.status).toBe(409);
    expect(memberCancel.body.error.message).toMatch(/12 hours/);
    expect((await admin.post(`/api/admin/bookings/${booking.body.bookingId}/cancel`)).status).toBe(200);
  });

  test('a session cannot be completed before it starts, and a cancelled one cannot be revived (R8)', async () => {
    const m = await memberWithPlan(admin);
    const day = futureWeekday(2, 29);
    const b = await m.agent.post('/api/member/bookings').send({ trainerId: SEED.trainerId, startsAt: `${day} 09:00`, duration: 60 });
    const trainer = await loginAs(SEED.trainer);
    const early = await trainer.patch(`/api/trainer/sessions/${b.body.bookingId}`).send({ status: 'completed' });
    expect(early.status).toBe(409);
    expect(early.body.error.rule).toBe('R8');

    expect((await m.agent.post(`/api/member/bookings/${b.body.bookingId}/cancel`)).status).toBe(200);
    expect((await m.agent.post(`/api/member/bookings/${b.body.bookingId}/cancel`)).status).toBe(409);
  });

  test('a trainer marks a past session completed with a note', async () => {
    const trainer = await loginAs(SEED.trainer);
    const toMark = await trainer.get('/api/trainer/sessions').query({ scope: 'to_mark' });
    expect(toMark.status).toBe(200);
    if (!toMark.body.length) return; // seed may have none on some days
    const res = await trainer.patch(`/api/trainer/sessions/${toMark.body[0].bookingId}`).send({ status: 'completed', trainerNote: 'Solid work' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'completed', trainerNote: 'Solid work' });
  });
});
