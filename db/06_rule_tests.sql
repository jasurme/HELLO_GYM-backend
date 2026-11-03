-- =====================================================================
--  Business-rule demonstration: run after 04_seed.sql.
--
--  Each statement tagged "-- expect: R#" (or a constraint name) MUST be
--  rejected by the database; "-- expect: ok" must succeed.
--  Everything runs in ONE transaction that is rolled back at the end,
--  so the database is left exactly as it was.
--
--  Automated:  npm run db:check-rules
--  Workbench:  run statement by statement (Ctrl+Enter) to show each error
--  CLI:        mysql gym_db --force < db/06_rule_tests.sql
--
--  Seeded people used below (ids are stable across reseeds):
--    9  Minji Kim     active Premium (8 PT/month)
--   10  Joon-ho Lee   subscription expired
--   11  Sara Ahmed    subscription not paid yet
--   12  Tae-yang Seo  active Basic plan, no personal training
--   14  Ethan Brooks  subscription frozen right now
--    3  Daniel Park   trainer, Mon–Fri 07–11 & 17–21, Sat 09–13
--    6  Emily Jung    trainer, Mon–Fri 09–13 & 18–21
-- =====================================================================

START TRANSACTION;

-- A Monday at least a month ahead (past the seeded bookings), plus helpers.
SET @mon = DATE_FORMAT(CURDATE() + INTERVAL 2 MONTH, '%Y-%m-01');
SET @mon = @mon + INTERVAL ((7 - WEEKDAY(@mon)) % 7) DAY;
SET @sun = @mon + INTERVAL 6 DAY;
SET @tomorrow = CURDATE() + INTERVAL 1 DAY;
SET @minji_sub = (SELECT subscription_id FROM v_subscription_status WHERE member_id = 9 AND status = 'active');
SET @ethan_sub = (SELECT MAX(subscription_id) FROM subscriptions WHERE member_id = 14);
SET @taeyang_sub = (SELECT MAX(subscription_id) FROM subscriptions WHERE member_id = 12);

-- A fresh test member on PT Quarterly (4 sessions/month), paid in cash.
INSERT INTO users (role_id, email, password_hash, first_name, last_name)
VALUES (3, 'rule.tester@binaryfit.test', REPEAT('x', 60), 'Rule', 'Tester');
SET @tester = LAST_INSERT_ID();
INSERT INTO members (member_id) VALUES (@tester);
INSERT INTO subscriptions (member_id, plan_id, start_date, end_date, price_krw)
VALUES (@tester, 4, CURDATE(), CURDATE() + INTERVAL 3 MONTH - INTERVAL 1 DAY, 790000);
SET @tester_sub = LAST_INSERT_ID();
INSERT INTO payments (subscription_id, amount_krw, method, status) VALUES (@tester_sub, 790000, 'cash', 'paid');

-- ---------------------------------------------------------------------
-- R4 · sessions must be inside the trainer's working hours
-- ---------------------------------------------------------------------
-- Daniel does not work on Sundays.
-- expect: R4
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (9, 3, @sun + INTERVAL 10 HOUR, @sun + INTERVAL 11 HOUR);

-- Monday 09:00–10:00 is inside his hours.
-- expect: ok
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (9, 3, @mon + INTERVAL 9 HOUR, @mon + INTERVAL 10 HOUR);
SET @minji_booking = LAST_INSERT_ID();

-- ---------------------------------------------------------------------
-- R2 / R3 · no double-booking of a trainer or a member
-- ---------------------------------------------------------------------
-- Another member wants Daniel at 09:30, while he is with Minji.
-- expect: R2
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (@tester, 3, @mon + INTERVAL 570 MINUTE, @mon + INTERVAL 630 MINUTE);

-- Minji tries to see Emily at 09:30, while she is with Daniel.
-- expect: R3
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (9, 6, @mon + INTERVAL 570 MINUTE, @mon + INTERVAL 630 MINUTE);

-- ---------------------------------------------------------------------
-- R1 · an active, fully paid, non-frozen subscription is required
-- ---------------------------------------------------------------------
-- Joon-ho's subscription has expired.
-- expect: R1
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (10, 3, @mon + INTERVAL 7 HOUR, @mon + INTERVAL 8 HOUR);

-- Sara's subscription covers tomorrow but is not paid yet.
-- expect: R1
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (11, 3, @tomorrow + INTERVAL 18 HOUR, @tomorrow + INTERVAL 19 HOUR);

-- Ethan's subscription is frozen.
-- expect: R1
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (14, 3, @tomorrow + INTERVAL 18 HOUR, @tomorrow + INTERVAL 19 HOUR);

-- ---------------------------------------------------------------------
-- R5 · monthly personal-training quota
-- ---------------------------------------------------------------------
-- Tae-yang's Basic plan has no personal training at all.
-- expect: R5
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (12, 3, @tomorrow + INTERVAL 18 HOUR, @tomorrow + INTERVAL 19 HOUR);

-- The tester's plan allows 4 sessions a month: four bookings succeed...
-- expect: ok
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at) VALUES
  (@tester, 3, @mon + INTERVAL 7 HOUR,  @mon + INTERVAL 8 HOUR),
  (@tester, 3, @mon + INTERVAL 17 HOUR, @mon + INTERVAL 18 HOUR),
  (@tester, 3, @mon + INTERVAL 18 HOUR, @mon + INTERVAL 19 HOUR),
  (@tester, 3, @mon + INTERVAL 19 HOUR, @mon + INTERVAL 20 HOUR);

-- ...and the fifth in the same month is refused.
-- expect: R5
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (@tester, 6, @mon + INTERVAL 11 HOUR, @mon + INTERVAL 12 HOUR);

-- ---------------------------------------------------------------------
-- CHECK and FOREIGN KEY constraints on bookings
-- ---------------------------------------------------------------------
-- Sessions last 30, 60 or 90 minutes.
-- expect: ck_bookings_length
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (9, 6, @mon + INTERVAL 11 HOUR, @mon + INTERVAL 705 MINUTE);

-- Sessions start on the hour or half hour.
-- expect: ck_bookings_grid
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (9, 6, @mon + INTERVAL 675 MINUTE, @mon + INTERVAL 735 MINUTE);

-- Foreign keys: a payment must belong to an existing subscription.
-- (For bookings the BEFORE trigger runs first and reports the rule instead.)
-- expect: fk_payments_subscription
INSERT INTO payments (subscription_id, amount_krw, method, status) VALUES (999999, 10000, 'cash', 'pending');

-- ---------------------------------------------------------------------
-- R10 · freezes
-- ---------------------------------------------------------------------
-- Minji has a booked session in that week.
-- expect: R10
INSERT INTO subscription_freezes (subscription_id, freeze_start, freeze_end)
VALUES (@minji_sub, @mon, @mon + INTERVAL 6 DAY);

-- Ethan is already frozen today.
-- expect: R10
INSERT INTO subscription_freezes (subscription_id, freeze_start, freeze_end)
VALUES (@ethan_sub, CURDATE(), CURDATE() + INTERVAL 4 DAY);

-- A freeze must start inside the subscription period.
-- expect: R10
INSERT INTO subscription_freezes (subscription_id, freeze_start, freeze_end)
VALUES (@taeyang_sub, CURDATE() + INTERVAL 60 DAY, CURDATE() + INTERVAL 65 DAY);

-- Freezes are history; they are never edited.
-- expect: R10
UPDATE subscription_freezes SET reason = 'changed' WHERE subscription_id = @ethan_sub;

-- A valid 7-day freeze pushes the end date back by 7 days (trigger).
-- expect: ok
SET @end_before = (SELECT end_date FROM subscriptions WHERE subscription_id = @tester_sub);
-- expect: ok
INSERT INTO subscription_freezes (subscription_id, freeze_start, freeze_end, reason)
VALUES (@tester_sub, CURDATE() + INTERVAL 5 DAY, CURDATE() + INTERVAL 11 DAY, 'Rule demo');
-- show
SELECT @end_before AS end_before, end_date AS end_after, DATEDIFF(end_date, @end_before) AS days_added
FROM subscriptions WHERE subscription_id = @tester_sub;

-- ---------------------------------------------------------------------
-- R8 · booking lifecycle: booked → completed | no_show | cancelled
-- ---------------------------------------------------------------------
-- A session cannot be completed before it starts.
-- expect: R8
UPDATE bookings SET status = 'completed' WHERE booking_id = @minji_booking;

-- Cancelling is allowed (cancelled_at is filled in by the trigger).
-- expect: ok
UPDATE bookings SET status = 'cancelled', cancelled_by = 9 WHERE booking_id = @minji_booking;

-- A cancelled session cannot come back.
-- expect: R8
UPDATE bookings SET status = 'booked' WHERE booking_id = @minji_booking;

-- ---------------------------------------------------------------------
-- R6 · a member's subscriptions never overlap
-- ---------------------------------------------------------------------
-- expect: R6
INSERT INTO subscriptions (member_id, plan_id, start_date, end_date, price_krw)
VALUES (9, 1, CURDATE(), CURDATE() + INTERVAL 1 MONTH - INTERVAL 1 DAY, 70000);

-- ---------------------------------------------------------------------
-- R9 · payments never exceed the price; status lifecycle
-- ---------------------------------------------------------------------
-- Minji's subscription is already fully paid.
-- expect: R9
INSERT INTO payments (subscription_id, amount_krw, method, status) VALUES (@minji_sub, 10000, 'cash', 'paid');

-- A paid payment can only become refunded, not pending.
-- expect: R9
UPDATE payments SET status = 'pending', paid_at = NULL WHERE subscription_id = @minji_sub AND status = 'paid';

-- Amounts must be positive.
-- expect: ck_payments_amount
INSERT INTO payments (subscription_id, amount_krw, method, status) VALUES (@tester_sub, 0, 'cash', 'pending');

-- ---------------------------------------------------------------------
-- R11 · a trainer's weekly windows never overlap
-- ---------------------------------------------------------------------
-- Daniel already works Monday 07:00–11:00.
-- expect: R11
INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time) VALUES (3, 1, '10:00', '12:00');

-- ---------------------------------------------------------------------
-- R12 · profiles match roles; inactive accounts cannot book
-- ---------------------------------------------------------------------
-- User 3 is a trainer, so cannot get a member profile.
-- expect: R12
INSERT INTO members (member_id) VALUES (3);

-- A member's role cannot change while the member profile exists.
-- expect: R12
UPDATE users SET role_id = 2 WHERE user_id = 9;

-- expect: ok
UPDATE users SET is_active = FALSE WHERE user_id = @tester;
-- expect: R12
INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at)
VALUES (@tester, 6, @mon + INTERVAL 11 HOUR, @mon + INTERVAL 12 HOUR);
-- expect: ok
UPDATE users SET is_active = TRUE WHERE user_id = @tester;

-- ---------------------------------------------------------------------
-- Cancelling a subscription cancels its future sessions (trigger)
-- and the derived status follows (view)
-- ---------------------------------------------------------------------
-- show
SELECT status, COUNT(*) AS sessions FROM bookings WHERE member_id = @tester GROUP BY status;
-- expect: ok
UPDATE subscriptions SET cancelled_at = NOW() WHERE subscription_id = @tester_sub;
-- show
SELECT status, COUNT(*) AS sessions FROM bookings WHERE member_id = @tester GROUP BY status;
-- show
SELECT subscription_id, plan_name, status FROM v_subscription_status WHERE subscription_id = @tester_sub;

-- Leave the database exactly as it was.
ROLLBACK;
