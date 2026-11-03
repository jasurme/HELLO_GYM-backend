const { SEED, loginAs } = require('./helpers');
const { sequelize } = require('../src/models');
const reports = require('../src/services/reports');

const one = async (sql) => (await sequelize.query(sql))[0][0];

describe('management reports', () => {
  let admin;

  beforeAll(async () => {
    admin = await loginAs(SEED.admin);
  });

  test('every named query in db/05_reports.sql is loaded', () => {
    expect(Object.keys(reports.queries).sort()).toEqual([
      'active_by_plan', 'active_by_status', 'expiring_soon', 'outstanding_balances', 'revenue_by_plan_method',
      'revenue_headline', 'revenue_trend', 'trainer_last_30_days', 'trainer_lifetime',
    ]);
  });

  test('summary figures match the views', async () => {
    const res = await admin.get('/api/admin/reports/summary');
    expect(res.status).toBe(200);
    const active = await one("SELECT COUNT(*) AS n FROM v_subscription_status WHERE status IN ('active', 'frozen')");
    expect(res.body.activeMembers).toBe(active.n);
    expect(res.body.activeMembers).toBeGreaterThan(20);
    expect(res.body.revenueThisYearKrw).toBeGreaterThan(0);
  });

  test('active memberships: per-plan counts add up to the active total', async () => {
    const res = await admin.get('/api/admin/reports/active-memberships');
    const activeRow = res.body.byStatus.find((r) => r.status === 'active');
    const perPlan = res.body.byPlan.reduce((sum, p) => sum + p.activeMembers, 0);
    expect(perPlan).toBe(activeRow.subscriptions);
    const pct = res.body.byPlan.reduce((sum, p) => sum + (p.pctOfActive || 0), 0);
    expect(pct).toBeGreaterThan(99.5);
    expect(pct).toBeLessThan(100.5);
  });

  test('revenue: 12 consecutive months, totals consistent with payments', async () => {
    const res = await admin.get('/api/admin/reports/revenue');
    const { trend, headline, byPlanMethod } = res.body;
    expect(trend).toHaveLength(12);
    const months = trend.map((t) => t.month);
    expect([...months].sort()).toEqual(months);

    const year = await one(
      "SELECT COALESCE(SUM(amount_krw), 0) AS krw FROM payments WHERE status = 'paid' AND paid_at >= DATE_FORMAT(CURDATE(), '%Y-01-01')",
    );
    expect(headline.thisYearKrw).toBe(year.krw);

    // The ROLLUP grand total equals the sum of the 12-month trend
    const grand = byPlanMethod.find((r) => r.planName === null && r.method === null);
    expect(grand.revenueKrw).toBe(trend.reduce((s, t) => s + t.revenueKrw, 0));
  });

  test('trainer bookings for a date range', async () => {
    const res = await admin.get('/api/admin/reports/trainers').query({ from: '2000-01-01', to: '2100-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.range).toHaveLength(res.body.lifetime.length);
    // Over all time, non-cancelled sessions equal lifetime total minus cancelled
    for (const t of res.body.range) {
      const life = res.body.lifetime.find((l) => l.trainerId === t.trainerId);
      expect(t.sessions).toBe(life.totalBookings - life.cancelled);
    }
  });

  test('expiring soon lists only live subscriptions ending within 30 days', async () => {
    const res = await admin.get('/api/admin/reports/expiring');
    expect(res.body.length).toBeGreaterThan(0);
    for (const e of res.body) {
      expect(e.daysLeft).toBeGreaterThanOrEqual(0);
      expect(e.daysLeft).toBeLessThanOrEqual(30);
    }
    expect(res.body.some((e) => e.memberEmail === SEED.minji)).toBe(false);
    expect(res.body.some((e) => e.memberEmail === 'yuna.choi@binaryfit.test')).toBe(true);
  });
});
