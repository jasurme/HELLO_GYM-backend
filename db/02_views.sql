-- =====================================================================
--  Views: derived data lives here instead of in stored columns (3NF).
--  The app and the management reports read from these views.
-- =====================================================================

-- ---------------------------------------------------------------------
-- v_subscription_status: every subscription with its derived status
--   cancelled       cancelled_at is set
--   expired         end_date has passed
--   pending_payment paid total < agreed price
--   upcoming        starts in the future
--   frozen          a freeze covers today
--   active          otherwise
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_subscription_status AS
SELECT
  s.subscription_id,
  s.member_id,
  CONCAT(u.first_name, ' ', u.last_name)       AS member_name,
  u.email                                      AS member_email,
  s.plan_id,
  p.plan_name,
  s.start_date,
  s.end_date,
  s.price_krw,
  COALESCE(pay.paid_krw, 0)                    AS paid_krw,
  s.price_krw - COALESCE(pay.paid_krw, 0)      AS balance_krw,
  s.cancelled_at,
  s.created_at,
  CASE
    WHEN s.cancelled_at IS NOT NULL            THEN 'cancelled'
    WHEN s.end_date < CURDATE()                THEN 'expired'
    WHEN COALESCE(pay.paid_krw, 0) < s.price_krw THEN 'pending_payment'
    WHEN s.start_date > CURDATE()              THEN 'upcoming'
    WHEN fz.subscription_id IS NOT NULL        THEN 'frozen'
    ELSE 'active'
  END                                          AS status,
  GREATEST(DATEDIFF(s.end_date, CURDATE()), 0) AS days_left
FROM subscriptions s
JOIN users u            ON u.user_id = s.member_id
JOIN membership_plans p ON p.plan_id = s.plan_id
LEFT JOIN (
  SELECT subscription_id, SUM(amount_krw) AS paid_krw
  FROM payments
  WHERE status = 'paid' AND subscription_id IS NOT NULL
  GROUP BY subscription_id
) pay ON pay.subscription_id = s.subscription_id
LEFT JOIN (
  SELECT DISTINCT subscription_id
  FROM subscription_freezes
  WHERE CURDATE() BETWEEN freeze_start AND freeze_end
) fz ON fz.subscription_id = s.subscription_id;

-- ---------------------------------------------------------------------
-- v_active_subscriptions: subscriptions a member can book with today
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_active_subscriptions AS
SELECT *
FROM v_subscription_status
WHERE status = 'active';

-- ---------------------------------------------------------------------
-- v_expiring_subscriptions: active (or frozen) subscriptions ending
-- within 30 days, with whether the member has already renewed
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_expiring_subscriptions AS
SELECT
  v.subscription_id,
  v.member_id,
  v.member_name,
  v.member_email,
  u.phone                                      AS member_phone,
  v.plan_name,
  v.end_date,
  v.days_left,
  EXISTS (
    SELECT 1 FROM subscriptions nxt
    WHERE nxt.member_id = v.member_id
      AND nxt.cancelled_at IS NULL
      AND nxt.start_date > v.end_date
  )                                            AS has_renewed
FROM v_subscription_status v
JOIN users u ON u.user_id = v.member_id
WHERE v.status IN ('active', 'frozen')
  AND v.end_date <= CURDATE() + INTERVAL 30 DAY;

-- ---------------------------------------------------------------------
-- v_trainer_schedule: bookings with names, price and payment state,
-- for calendars and lists
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_trainer_schedule AS
SELECT
  b.booking_id,
  b.trainer_id,
  CONCAT(tu.first_name, ' ', tu.last_name)     AS trainer_name,
  b.member_id,
  CONCAT(mu.first_name, ' ', mu.last_name)     AS member_name,
  mu.email                                     AS member_email,
  mu.phone                                     AS member_phone,
  b.starts_at,
  b.ends_at,
  TIMESTAMPDIFF(MINUTE, b.starts_at, b.ends_at) AS duration_min,
  b.status,
  b.price_krw,
  (SELECT p.status FROM payments p
   WHERE p.booking_id = b.booking_id
   ORDER BY p.payment_id DESC LIMIT 1)         AS payment_status,
  b.member_note,
  b.trainer_note,
  b.cancelled_at
FROM bookings b
JOIN users tu ON tu.user_id = b.trainer_id
JOIN users mu ON mu.user_id = b.member_id;

-- ---------------------------------------------------------------------
-- v_trainer_booking_stats: lifetime booking totals and PT revenue per trainer
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_trainer_booking_stats AS
SELECT
  t.trainer_id,
  CONCAT(u.first_name, ' ', u.last_name)                        AS trainer_name,
  t.specialization,
  COUNT(b.booking_id)                                           AS total_bookings,
  COALESCE(SUM(b.status = 'booked' AND b.starts_at >= NOW()), 0) AS upcoming,
  COALESCE(SUM(b.status = 'completed'), 0)                      AS completed,
  COALESCE(SUM(b.status = 'no_show'), 0)                        AS no_shows,
  COALESCE(SUM(b.status = 'cancelled'), 0)                      AS cancelled,
  COALESCE(ROUND(SUM(CASE WHEN b.status = 'completed'
                          THEN TIMESTAMPDIFF(MINUTE, b.starts_at, b.ends_at) END) / 60, 1), 0)
                                                                AS hours_delivered,
  COUNT(DISTINCT CASE WHEN b.status <> 'cancelled' THEN b.member_id END)
                                                                AS distinct_members,
  (SELECT COALESCE(SUM(p.amount_krw), 0)
   FROM payments p JOIN bookings pb ON pb.booking_id = p.booking_id
   WHERE pb.trainer_id = t.trainer_id AND p.status = 'paid')    AS revenue_krw
FROM trainers t
JOIN users u          ON u.user_id = t.trainer_id
LEFT JOIN bookings b  ON b.trainer_id = t.trainer_id
GROUP BY t.trainer_id, u.first_name, u.last_name, t.specialization;

-- ---------------------------------------------------------------------
-- v_monthly_revenue: collected (paid) and refunded money per month,
-- split into memberships and personal-training sessions
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_monthly_revenue AS
SELECT
  DATE_FORMAT(paid_at, '%Y-%m')                                AS month,
  SUM(status = 'paid')                                         AS payments,
  SUM(CASE WHEN status = 'paid' AND subscription_id IS NOT NULL THEN amount_krw ELSE 0 END) AS membership_krw,
  SUM(CASE WHEN status = 'paid' AND booking_id IS NOT NULL      THEN amount_krw ELSE 0 END) AS training_krw,
  SUM(CASE WHEN status = 'paid'     THEN amount_krw ELSE 0 END) AS revenue_krw,
  SUM(CASE WHEN status = 'refunded' THEN amount_krw ELSE 0 END) AS refunded_krw
FROM payments
WHERE paid_at IS NOT NULL
GROUP BY DATE_FORMAT(paid_at, '%Y-%m');

-- ---------------------------------------------------------------------
-- v_member_monthly_usage: personal-training sessions per member per month
-- (cancelled sessions not counted)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_member_monthly_usage AS
SELECT
  member_id,
  DATE_FORMAT(starts_at, '%Y-%m') AS month,
  COUNT(*)                        AS sessions_used
FROM bookings
WHERE status <> 'cancelled'
GROUP BY member_id, DATE_FORMAT(starts_at, '%Y-%m');

-- =====================================================================
--  Social area
-- =====================================================================

-- ---------------------------------------------------------------------
-- v_post_stats: like and comment counts per post
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_post_stats AS
SELECT
  p.post_id,
  (SELECT COUNT(*) FROM post_likes l    WHERE l.post_id = p.post_id) AS likes,
  (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.post_id) AS comments
FROM posts p;

-- ---------------------------------------------------------------------
-- v_user_social_stats: profile header counts (posts, followers, following)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_user_social_stats AS
SELECT
  u.user_id,
  (SELECT COUNT(*) FROM posts p   WHERE p.author_id   = u.user_id) AS posts,
  (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.user_id) AS followers,
  (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.user_id) AS following
FROM users u;

-- ---------------------------------------------------------------------
-- v_user_tag_interest: what each user likes, as a score per hashtag.
-- It is derived from their own activity, so it is never stored:
--   comment on a #tag post = 3, like = 2, own post using the #tag = 1.
-- The "Suggested for you" feed ranks posts by these scores.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_user_tag_interest AS
SELECT x.user_id, x.tag_id, h.name AS tag, SUM(x.weight) AS score
FROM (
  SELECT l.user_id, ph.tag_id, 2 AS weight
  FROM post_likes l JOIN post_hashtags ph ON ph.post_id = l.post_id
  UNION ALL
  SELECT c.author_id, ph.tag_id, 3
  FROM post_comments c JOIN post_hashtags ph ON ph.post_id = c.post_id
  UNION ALL
  SELECT p.author_id, ph.tag_id, 1
  FROM posts p JOIN post_hashtags ph ON ph.post_id = p.post_id
) x
JOIN hashtags h ON h.tag_id = x.tag_id
GROUP BY x.user_id, x.tag_id, h.name;
