-- =====================================================================
--  Management reports. The admin dashboard runs these exact queries:
--  src/services/reports.js loads each one by its `-- @name` tag.
--  They are also ready to run as-is in Workbench.
--  Built on the views in 02_views.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Report 1: Active membership counts
-- ---------------------------------------------------------------------

-- 1a. Members per subscription status today
-- @name active_by_status
SELECT status, COUNT(*) AS subscriptions
FROM v_subscription_status
WHERE status IN ('active', 'frozen', 'upcoming', 'pending_payment')
GROUP BY status
ORDER BY FIELD(status, 'active', 'frozen', 'upcoming', 'pending_payment');

-- 1b. Active memberships per plan, with share of the total
-- @name active_by_plan
SELECT
  p.plan_name,
  p.duration_months,
  p.sessions_per_month,
  COUNT(a.subscription_id)                                        AS active_members,
  ROUND(100 * COUNT(a.subscription_id) / SUM(COUNT(a.subscription_id)) OVER (), 1) AS pct_of_active
FROM membership_plans p
LEFT JOIN v_active_subscriptions a ON a.plan_id = p.plan_id
GROUP BY p.plan_id, p.plan_name, p.duration_months, p.sessions_per_month
ORDER BY active_members DESC;

-- ---------------------------------------------------------------------
-- Report 2: Collected subscription revenue
-- ---------------------------------------------------------------------

-- 2a. Headline figures: this month, this year, all time
-- @name revenue_headline
SELECT
  SUM(CASE WHEN paid_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN amount_krw ELSE 0 END) AS this_month_krw,
  SUM(CASE WHEN paid_at >= DATE_FORMAT(CURDATE(), '%Y-01-01') THEN amount_krw ELSE 0 END) AS this_year_krw,
  SUM(amount_krw)                                                                        AS all_time_krw
FROM payments
WHERE status = 'paid';

-- 2b. Revenue by plan and payment method (last 12 months)
-- @name revenue_by_plan_method
SELECT
  mp.plan_name,
  pay.method,
  COUNT(*)            AS payments,
  SUM(pay.amount_krw) AS revenue_krw
FROM payments pay
JOIN subscriptions s     ON s.subscription_id = pay.subscription_id
JOIN membership_plans mp ON mp.plan_id = s.plan_id
WHERE pay.status = 'paid'
  AND pay.paid_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01') - INTERVAL 11 MONTH
GROUP BY mp.plan_name, pay.method WITH ROLLUP;

-- 2c. Outstanding balances (sold but not fully paid)
-- @name outstanding_balances
SELECT subscription_id, member_name, plan_name, price_krw, paid_krw, balance_krw, start_date
FROM v_subscription_status
WHERE status = 'pending_payment'
ORDER BY start_date;

-- ---------------------------------------------------------------------
-- Report 3: Trainer bookings
-- ---------------------------------------------------------------------

-- 3a. Lifetime totals per trainer (view), busiest first
-- @name trainer_lifetime
SELECT *
FROM v_trainer_booking_stats
ORDER BY completed DESC;

-- 3b. Sessions per trainer in a date range (here: the last 30 days)
-- @name trainer_last_30_days
SELECT
  trainer_name,
  COUNT(*)                                          AS sessions,
  SUM(status = 'completed')                         AS completed,
  SUM(status = 'no_show')                           AS no_shows,
  ROUND(100 * SUM(status = 'no_show') / NULLIF(SUM(status IN ('completed', 'no_show')), 0), 1) AS no_show_pct,
  COUNT(DISTINCT member_id)                         AS members
FROM v_trainer_schedule
WHERE status <> 'cancelled'
  AND starts_at >= NOW() - INTERVAL 30 DAY
  AND starts_at <  NOW()
GROUP BY trainer_id, trainer_name
ORDER BY sessions DESC;

-- ---------------------------------------------------------------------
-- Report 4: Monthly revenue trend, last 12 months.
-- A recursive CTE produces every month so months with no payments show 0.
-- ---------------------------------------------------------------------
-- @name revenue_trend
WITH RECURSIVE months AS (
  SELECT DATE_FORMAT(CURDATE(), '%Y-%m-01') - INTERVAL 11 MONTH AS month_start
  UNION ALL
  SELECT month_start + INTERVAL 1 MONTH FROM months
  WHERE month_start < DATE_FORMAT(CURDATE(), '%Y-%m-01')
)
SELECT
  DATE_FORMAT(m.month_start, '%Y-%m')  AS month,
  COALESCE(r.payments, 0)              AS payments,
  COALESCE(r.revenue_krw, 0)           AS revenue_krw,
  COALESCE(r.refunded_krw, 0)          AS refunded_krw
FROM months m
LEFT JOIN v_monthly_revenue r ON r.month = DATE_FORMAT(m.month_start, '%Y-%m')
ORDER BY m.month_start;

-- ---------------------------------------------------------------------
-- Report 5: Subscriptions expiring soon (next 7 and 30 days)
-- ---------------------------------------------------------------------
-- @name expiring_soon
SELECT
  member_name,
  member_email,
  member_phone,
  plan_name,
  end_date,
  days_left,
  CASE WHEN days_left <= 7 THEN 'within 7 days' ELSE 'within 30 days' END AS window_label,
  IF(has_renewed, 'yes', 'no')                                           AS renewed
FROM v_expiring_subscriptions
ORDER BY end_date, member_name;
