// R7: role-based access. Each role reaches only its own area and records.
const { app, request, SEED, loginAs } = require('./helpers');
const { sequelize } = require('../src/models');

describe('role-based access (R7)', () => {
  let member;
  let trainer;
  let admin;

  beforeAll(async () => {
    [member, trainer, admin] = await Promise.all([loginAs(SEED.minji), loginAs(SEED.trainer), loginAs(SEED.admin)]);
  });

  test('anonymous users get 401 from protected APIs and are redirected from dashboards', async () => {
    for (const path of ['/api/member/overview', '/api/trainer/overview', '/api/admin/members', '/api/admin/reports/summary']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    const page = await request(app).get('/admin/');
    expect(page.status).toBe(302);
    expect(page.headers.location).toMatch(/^\/login\.html\?next=/);
  });

  test('public endpoints are open', async () => {
    expect((await request(app).get('/api/plans')).status).toBe(200);
    expect((await request(app).get('/api/trainers')).status).toBe(200);
  });

  test.each([
    ['member', '/api/trainer/overview', 403],
    ['member', '/api/admin/members', 403],
    ['member', '/api/admin/reports/revenue', 403],
    ['trainer', '/api/member/overview', 403],
    ['trainer', '/api/admin/payments', 403],
    ['admin', '/api/member/overview', 403],
    ['admin', '/api/trainer/sessions', 403],
  ])('%s → %s is %i', async (role, path, status) => {
    const agent = { member, trainer, admin }[role];
    expect((await agent.get(path)).status).toBe(status);
  });

  test('dashboard pages are only served to their own role', async () => {
    const res = await member.get('/admin/reports.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/member/');
    expect((await admin.get('/admin/reports.html')).status).toBe(200);
  });

  test("a member cannot see or cancel another member's session", async () => {
    const [[other]] = await sequelize.query(
      "SELECT booking_id FROM bookings WHERE member_id <> 9 AND status = 'booked' AND starts_at > NOW() + INTERVAL 1 DAY LIMIT 1",
    );
    const res = await member.post(`/api/member/bookings/${other.booking_id}/cancel`);
    expect(res.status).toBe(404);

    const mine = await member.get('/api/member/bookings');
    expect(mine.body.every((b) => b.memberId === 9)).toBe(true);
  });

  test("a trainer cannot mark or cancel another trainer's session", async () => {
    const [[other]] = await sequelize.query(
      "SELECT booking_id FROM bookings WHERE trainer_id <> 3 AND status = 'booked' AND starts_at > NOW() LIMIT 1",
    );
    expect((await trainer.patch(`/api/trainer/sessions/${other.booking_id}`).send({ trainerNote: 'x' })).status).toBe(404);
    expect((await trainer.post(`/api/trainer/sessions/${other.booking_id}/cancel`)).status).toBe(404);

    const sessions = await trainer.get('/api/trainer/sessions');
    expect(sessions.body.every((s) => s.trainerId === 3)).toBe(true);
  });

  test("a member cannot read another member's subscription", async () => {
    const [[other]] = await sequelize.query('SELECT subscription_id FROM subscriptions WHERE member_id <> 9 LIMIT 1');
    expect((await member.get(`/api/member/subscriptions/${other.subscription_id}`)).status).toBe(404);
  });
});
