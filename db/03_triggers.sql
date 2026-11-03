-- =====================================================================
--  Triggers: business rules enforced by the database itself, so they
--  hold even for direct SQL (Workbench, scripts), not just the web app.
--
--  Every violation raises SQLSTATE '45000' with a message that starts
--  with the rule id, e.g. "[R2] ...". The app turns these into HTTP 409
--  responses. Rules are listed in docs/design.md.
--
--  The two helper procedures are only called from triggers, so the
--  booking and payment checks are written once for INSERT and UPDATE.
-- =====================================================================

DELIMITER $$

-- ---------------------------------------------------------------------
-- assert_booking_rules: R12, R1, R5, R4, R2, R3 for a live session,
-- in that order so the most fundamental problem is reported first
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_booking_rules $$
CREATE PROCEDURE assert_booking_rules(
  IN p_booking_id INT UNSIGNED,   -- NULL for a new booking
  IN p_member_id  INT UNSIGNED,
  IN p_trainer_id INT UNSIGNED,
  IN p_starts_at  DATETIME,
  IN p_ends_at    DATETIME)
BEGIN
  DECLARE v_quota       INT;
  DECLARE v_used        INT;
  DECLARE v_month_start DATETIME;

  -- R12: both accounts must be active
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = p_member_id AND is_active) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R12] The member account is inactive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = p_trainer_id AND is_active) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R12] The trainer account is inactive';
  END IF;

  -- R1: a fully paid, non-cancelled, non-frozen subscription must cover
  -- the session date. Its plan supplies the monthly quota for R5.
  SET v_quota = (
    SELECT p.sessions_per_month
    FROM subscriptions s
    JOIN membership_plans p ON p.plan_id = s.plan_id
    WHERE s.member_id = p_member_id
      AND s.cancelled_at IS NULL
      AND DATE(p_starts_at) BETWEEN s.start_date AND s.end_date
      AND (SELECT COALESCE(SUM(pay.amount_krw), 0)
           FROM payments pay
           WHERE pay.subscription_id = s.subscription_id AND pay.status = 'paid') >= s.price_krw
      AND NOT EXISTS (
           SELECT 1 FROM subscription_freezes f
           WHERE f.subscription_id = s.subscription_id
             AND DATE(p_starts_at) BETWEEN f.freeze_start AND f.freeze_end)
    LIMIT 1);

  IF v_quota IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R1] The member has no active, paid subscription on the session date';
  END IF;

  -- R5: monthly personal-training quota (calendar month of the session)
  IF v_quota = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R5] The member''s plan does not include personal training';
  END IF;

  SET v_month_start = DATE_FORMAT(p_starts_at, '%Y-%m-01');
  SET v_used = (
    SELECT COUNT(*) FROM bookings b
    WHERE b.member_id = p_member_id
      AND b.status <> 'cancelled'
      AND (p_booking_id IS NULL OR b.booking_id <> p_booking_id)
      AND b.starts_at >= v_month_start
      AND b.starts_at <  v_month_start + INTERVAL 1 MONTH);

  IF v_used >= v_quota THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R5] The member has used all personal-training sessions for this month';
  END IF;

  -- R4: the whole session must fit inside one of the trainer's weekly windows
  IF NOT EXISTS (
      SELECT 1 FROM trainer_availability a
      WHERE a.trainer_id  = p_trainer_id
        AND a.day_of_week = WEEKDAY(p_starts_at) + 1
        AND a.start_time <= TIME(p_starts_at)
        AND a.end_time   >= TIME(p_ends_at)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R4] The session is outside the trainer''s working hours';
  END IF;

  -- R2: a trainer cannot be in two sessions at once
  IF EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.trainer_id = p_trainer_id
        AND b.status <> 'cancelled'
        AND (p_booking_id IS NULL OR b.booking_id <> p_booking_id)
        AND b.starts_at < p_ends_at
        AND b.ends_at   > p_starts_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R2] The trainer already has a session at this time';
  END IF;

  -- R3: a member cannot be in two sessions at once
  IF EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.member_id = p_member_id
        AND b.status <> 'cancelled'
        AND (p_booking_id IS NULL OR b.booking_id <> p_booking_id)
        AND b.starts_at < p_ends_at
        AND b.ends_at   > p_starts_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R3] The member already has a session at this time';
  END IF;
END $$

-- ---------------------------------------------------------------------
-- assert_payment_within_price: R9, live payments never exceed the price
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_payment_within_price $$
CREATE PROCEDURE assert_payment_within_price(
  IN p_payment_id      INT UNSIGNED,   -- NULL for a new payment
  IN p_subscription_id INT UNSIGNED,
  IN p_amount_krw      INT UNSIGNED,
  IN p_status          VARCHAR(10))
BEGIN
  DECLARE v_price INT UNSIGNED;
  DECLARE v_other BIGINT;

  IF p_status IN ('pending', 'paid') THEN
    SET v_price = (SELECT price_krw FROM subscriptions WHERE subscription_id = p_subscription_id);
    SET v_other = (
      SELECT COALESCE(SUM(amount_krw), 0) FROM payments
      WHERE subscription_id = p_subscription_id
        AND status IN ('pending', 'paid')
        AND (p_payment_id IS NULL OR payment_id <> p_payment_id));
    IF v_price IS NOT NULL AND v_other + p_amount_krw > v_price THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R9] Payments would exceed the subscription price';
    END IF;
  END IF;
END $$

-- =====================================================================
-- members / trainers / users: R12 profile rows must match the user's role
-- =====================================================================
DROP TRIGGER IF EXISTS trg_members_bi $$
CREATE TRIGGER trg_members_bi BEFORE INSERT ON members FOR EACH ROW
BEGIN
  IF (SELECT r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = NEW.member_id) <> 'member' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R12] A member profile needs a user with the member role';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_trainers_bi $$
CREATE TRIGGER trg_trainers_bi BEFORE INSERT ON trainers FOR EACH ROW
BEGIN
  IF (SELECT r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = NEW.trainer_id) <> 'trainer' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R12] A trainer profile needs a user with the trainer role';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_users_bu $$
CREATE TRIGGER trg_users_bu BEFORE UPDATE ON users FOR EACH ROW
BEGIN
  IF NEW.role_id <> OLD.role_id
     AND (EXISTS (SELECT 1 FROM members  WHERE member_id  = OLD.user_id)
       OR EXISTS (SELECT 1 FROM trainers WHERE trainer_id = OLD.user_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R12] Cannot change the role of a user who has a member or trainer profile';
  END IF;
END $$

-- =====================================================================
-- subscriptions: R6 no overlapping periods; cancelling frees the future
-- =====================================================================
DROP TRIGGER IF EXISTS trg_subscriptions_bi $$
CREATE TRIGGER trg_subscriptions_bi BEFORE INSERT ON subscriptions FOR EACH ROW
BEGIN
  IF NEW.cancelled_at IS NULL AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.member_id = NEW.member_id
        AND s.cancelled_at IS NULL
        AND s.start_date <= NEW.end_date
        AND s.end_date   >= NEW.start_date) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R6] The member already has a subscription in this period';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_subscriptions_bu $$
CREATE TRIGGER trg_subscriptions_bu BEFORE UPDATE ON subscriptions FOR EACH ROW
BEGIN
  IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R6] A cancelled subscription cannot be reactivated';
  END IF;

  IF NEW.cancelled_at IS NULL
     AND (NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date OR NEW.member_id <> OLD.member_id)
     AND EXISTS (
       SELECT 1 FROM subscriptions s
       WHERE s.member_id = NEW.member_id
         AND s.subscription_id <> OLD.subscription_id
         AND s.cancelled_at IS NULL
         AND s.start_date <= NEW.end_date
         AND s.end_date   >= NEW.start_date) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R6] The member already has a subscription in this period';
  END IF;
END $$

-- Cancelling a subscription cancels the member's future sessions it covers.
DROP TRIGGER IF EXISTS trg_subscriptions_au $$
CREATE TRIGGER trg_subscriptions_au AFTER UPDATE ON subscriptions FOR EACH ROW
BEGIN
  IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
    UPDATE bookings
    SET status = 'cancelled', cancelled_at = NEW.cancelled_at
    WHERE member_id = NEW.member_id
      AND status = 'booked'
      AND starts_at > NEW.cancelled_at
      AND DATE(starts_at) BETWEEN NEW.start_date AND NEW.end_date;
  END IF;
END $$

-- =====================================================================
-- subscription_freezes: R10
-- =====================================================================
DROP TRIGGER IF EXISTS trg_freezes_bi $$
CREATE TRIGGER trg_freezes_bi BEFORE INSERT ON subscription_freezes FOR EACH ROW
BEGIN
  DECLARE v_member    INT UNSIGNED;
  DECLARE v_start     DATE;
  DECLARE v_end       DATE;
  DECLARE v_cancelled DATETIME;

  SELECT member_id, start_date, end_date, cancelled_at
    INTO v_member, v_start, v_end, v_cancelled
  FROM subscriptions WHERE subscription_id = NEW.subscription_id;

  IF v_cancelled IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R10] A cancelled subscription cannot be frozen';
  END IF;
  IF NEW.freeze_start < v_start OR NEW.freeze_start > v_end THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R10] A freeze must start inside the subscription period';
  END IF;
  IF EXISTS (
      SELECT 1 FROM subscription_freezes f
      WHERE f.subscription_id = NEW.subscription_id
        AND f.freeze_start <= NEW.freeze_end
        AND f.freeze_end   >= NEW.freeze_start) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R10] The freeze overlaps an existing freeze';
  END IF;
  IF EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.member_id = v_member
        AND b.status = 'booked'
        AND DATE(b.starts_at) BETWEEN NEW.freeze_start AND NEW.freeze_end) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R10] Cancel the sessions booked during the freeze first';
  END IF;
END $$

-- A freeze pushes the end date back by its length (inclusive days)...
DROP TRIGGER IF EXISTS trg_freezes_ai $$
CREATE TRIGGER trg_freezes_ai AFTER INSERT ON subscription_freezes FOR EACH ROW
BEGIN
  UPDATE subscriptions
  SET end_date = end_date + INTERVAL (DATEDIFF(NEW.freeze_end, NEW.freeze_start) + 1) DAY
  WHERE subscription_id = NEW.subscription_id;
END $$

-- ...and removing it gives those days back.
DROP TRIGGER IF EXISTS trg_freezes_ad $$
CREATE TRIGGER trg_freezes_ad AFTER DELETE ON subscription_freezes FOR EACH ROW
BEGIN
  UPDATE subscriptions
  SET end_date = end_date - INTERVAL (DATEDIFF(OLD.freeze_end, OLD.freeze_start) + 1) DAY
  WHERE subscription_id = OLD.subscription_id;
END $$

DROP TRIGGER IF EXISTS trg_freezes_bu $$
CREATE TRIGGER trg_freezes_bu BEFORE UPDATE ON subscription_freezes FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R10] Freezes cannot be edited; delete it and create a new one';
END $$

-- =====================================================================
-- payments: R9 amount cap and status lifecycle
--   pending → paid | failed,  paid → refunded
-- =====================================================================
DROP TRIGGER IF EXISTS trg_payments_bi $$
CREATE TRIGGER trg_payments_bi BEFORE INSERT ON payments FOR EACH ROW
BEGIN
  IF NEW.status IN ('paid', 'refunded') AND NEW.paid_at IS NULL THEN
    SET NEW.paid_at = NOW();
  END IF;
  CALL assert_payment_within_price(NULL, NEW.subscription_id, NEW.amount_krw, NEW.status);
END $$

DROP TRIGGER IF EXISTS trg_payments_bu $$
CREATE TRIGGER trg_payments_bu BEFORE UPDATE ON payments FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(128);

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'pending' AND NEW.status IN ('paid', 'failed'))
         OR (OLD.status = 'paid'    AND NEW.status = 'refunded')) THEN
      SET v_msg = CONCAT('[R9] A payment cannot go from ', OLD.status, ' to ', NEW.status);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
    IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
      SET NEW.paid_at = NOW();
    END IF;
  END IF;

  IF NEW.amount_krw <> OLD.amount_krw OR NEW.subscription_id <> OLD.subscription_id OR NEW.status <> OLD.status THEN
    CALL assert_payment_within_price(OLD.payment_id, NEW.subscription_id, NEW.amount_krw, NEW.status);
  END IF;
END $$

-- =====================================================================
-- trainer_availability: R11 no overlapping windows on the same day
-- =====================================================================
DROP TRIGGER IF EXISTS trg_availability_bi $$
CREATE TRIGGER trg_availability_bi BEFORE INSERT ON trainer_availability FOR EACH ROW
BEGIN
  IF EXISTS (
      SELECT 1 FROM trainer_availability a
      WHERE a.trainer_id  = NEW.trainer_id
        AND a.day_of_week = NEW.day_of_week
        AND a.start_time  < NEW.end_time
        AND a.end_time    > NEW.start_time) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R11] This window overlaps another window on the same day';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_availability_bu $$
CREATE TRIGGER trg_availability_bu BEFORE UPDATE ON trainer_availability FOR EACH ROW
BEGIN
  IF EXISTS (
      SELECT 1 FROM trainer_availability a
      WHERE a.trainer_id  = NEW.trainer_id
        AND a.day_of_week = NEW.day_of_week
        AND a.availability_id <> OLD.availability_id
        AND a.start_time  < NEW.end_time
        AND a.end_time    > NEW.start_time) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R11] This window overlaps another window on the same day';
  END IF;
END $$

-- =====================================================================
-- bookings: R1–R5 via assert_booking_rules, R8 lifecycle
-- =====================================================================
DROP TRIGGER IF EXISTS trg_bookings_bi $$
CREATE TRIGGER trg_bookings_bi BEFORE INSERT ON bookings FOR EACH ROW
BEGIN
  IF NEW.status = 'cancelled' THEN
    IF NEW.cancelled_at IS NULL THEN
      SET NEW.cancelled_at = NOW();
    END IF;
  ELSE
    CALL assert_booking_rules(NULL, NEW.member_id, NEW.trainer_id, NEW.starts_at, NEW.ends_at);
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_bookings_bu $$
CREATE TRIGGER trg_bookings_bu BEFORE UPDATE ON bookings FOR EACH ROW
BEGIN
  -- R8: only a booked session changes status, and it cannot be
  -- completed or marked no-show before it has started.
  IF NEW.status <> OLD.status THEN
    IF OLD.status <> 'booked' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R8] Only a booked session can change status';
    END IF;
    IF NEW.status IN ('completed', 'no_show') AND NEW.starts_at > NOW() THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '[R8] A session can be completed or marked no-show only after it starts';
    END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
      SET NEW.cancelled_at = NOW();
    END IF;
  END IF;

  -- Rescheduling or reassigning a live session re-checks every rule.
  IF NEW.status = 'booked'
     AND (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at
       OR NEW.trainer_id <> OLD.trainer_id OR NEW.member_id <> OLD.member_id) THEN
    CALL assert_booking_rules(OLD.booking_id, NEW.member_id, NEW.trainer_id, NEW.starts_at, NEW.ends_at);
  END IF;
END $$

DELIMITER ;
