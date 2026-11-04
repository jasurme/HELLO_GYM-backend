const fs = require('fs');
const path = require('path');
const { splitSql } = require('../lib/split-sql');
const { select, selectOne } = require('../lib/sql');

// The management reports are the SQL in db/05_reports.sql, loaded by their
// `-- @name` tags, so the dashboard and the script never drift apart.
const REPORT_FILE = path.join(__dirname, '..', '..', 'db', '05_reports.sql');
const queries = {};
for (const stmt of splitSql(fs.readFileSync(REPORT_FILE, 'utf8'))) {
  const name = stmt.match(/^--\s*@name\s+(\w+)\s*$/m)?.[1];
  if (name) queries[name] = stmt;
}

const run = (name) => {
  if (!queries[name]) throw new Error(`Report query "${name}" not found in db/05_reports.sql`);
  return select(queries[name]);
};

// KPI tiles for the admin dashboard.
async function summary() {
  const [active, revenue, sessions, expiring, outstanding] = await Promise.all([
    selectOne("SELECT COUNT(*) AS n FROM v_subscription_status WHERE status IN ('active', 'frozen')"),
    run('revenue_headline').then((rows) => rows[0]),
    selectOne(
      `SELECT COUNT(*) AS n FROM bookings
       WHERE status <> 'cancelled'
         AND starts_at >= CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY
         AND starts_at <  CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY + INTERVAL 7 DAY`,
    ),
    selectOne('SELECT COUNT(*) AS n FROM v_expiring_subscriptions WHERE days_left <= 7 AND NOT has_renewed'),
    selectOne("SELECT COUNT(*) AS n, COALESCE(SUM(balance_krw), 0) AS krw FROM v_subscription_status WHERE status = 'pending_payment'"),
  ]);
  return {
    activeMembers: active.n,
    revenueThisMonthKrw: revenue.thisMonthKrw || 0,
    revenueThisYearKrw: revenue.thisYearKrw || 0,
    trainingThisYearKrw: revenue.thisYearTrainingKrw || 0,
    sessionsThisWeek: sessions.n,
    expiringIn7Days: expiring.n,
    pendingPayments: outstanding.n,
    pendingPaymentsKrw: outstanding.krw,
  };
}

async function activeMemberships() {
  const [byStatus, byPlan] = await Promise.all([run('active_by_status'), run('active_by_plan')]);
  return { byStatus, byPlan };
}

async function revenue() {
  const [headline, trend, byProductMethod, outstanding] = await Promise.all([
    run('revenue_headline'), run('revenue_trend'), run('revenue_by_product_method'), run('outstanding_balances'),
  ]);
  return { headline: headline[0], trend, byProductMethod, outstanding };
}

// Report 3 for any date range (the script's 3b uses the last 30 days).
async function trainerBookings({ from, to }) {
  const [lifetime, range] = await Promise.all([
    run('trainer_lifetime'),
    select(
      `SELECT
         t.trainer_id,
         CONCAT(u.first_name, ' ', u.last_name)                          AS trainer_name,
         t.specialization,
         COUNT(b.booking_id)                                             AS sessions,
         COALESCE(SUM(b.status = 'booked'), 0)                           AS booked,
         COALESCE(SUM(b.status = 'completed'), 0)                        AS completed,
         COALESCE(SUM(b.status = 'no_show'), 0)                          AS no_shows,
         ROUND(100 * SUM(b.status = 'no_show') / NULLIF(SUM(b.status IN ('completed', 'no_show')), 0), 1) AS no_show_pct,
         COALESCE(ROUND(SUM(TIMESTAMPDIFF(MINUTE, b.starts_at, b.ends_at)) / 60, 1), 0) AS hours,
         COUNT(DISTINCT b.member_id)                                     AS members,
         COALESCE(SUM(b.price_krw), 0)                                   AS revenue_krw  -- live sessions are paid
       FROM trainers t
       JOIN users u ON u.user_id = t.trainer_id
       LEFT JOIN bookings b ON b.trainer_id = t.trainer_id
             AND b.status <> 'cancelled'
             AND b.starts_at >= :from AND b.starts_at < :to + INTERVAL 1 DAY
       GROUP BY t.trainer_id, u.first_name, u.last_name, t.specialization
       ORDER BY sessions DESC, trainer_name`,
      { from, to },
    ),
  ]);
  return { from, to, range, lifetime };
}

async function expiring() {
  return run('expiring_soon');
}

module.exports = { queries, summary, activeMemberships, revenue, trainerBookings, expiring };
