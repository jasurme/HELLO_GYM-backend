-- =====================================================================
--  Gym Membership & Training Booking System: schema
--  Team Binary Minds · MySQL 8.0.16+ (developed on MySQL 26.10)
--
--  Run order: 01_schema → 02_views → 03_triggers → 04_seed
--  Normalized to 3NF. See docs/normalization.md for the walkthrough.
--  Business rules R1–R13 are listed in docs/design.md.
-- =====================================================================

SET NAMES utf8mb4;

-- Re-runnable: drop in reverse dependency order.
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS post_comments;
DROP TABLE IF EXISTS post_likes;
DROP TABLE IF EXISTS post_hashtags;
DROP TABLE IF EXISTS hashtags;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS trainer_availability;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS subscription_freezes;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS membership_plans;
DROP TABLE IF EXISTS trainers;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- roles: lookup table for the three access levels
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  role_id     TINYINT UNSIGNED NOT NULL,
  role_name   VARCHAR(20)      NOT NULL,
  description VARCHAR(100)     NULL,
  CONSTRAINT pk_roles      PRIMARY KEY (role_id),
  CONSTRAINT uq_roles_name UNIQUE (role_name)
) ENGINE = InnoDB;

INSERT INTO roles (role_id, role_name, description) VALUES
  (1, 'admin',   'Front desk / management: full access'),
  (2, 'trainer', 'Personal trainer: own availability and sessions'),
  (3, 'member',  'Gym member: own subscriptions, payments and bookings');

-- ---------------------------------------------------------------------
-- users: one login per person, whatever the role
-- ---------------------------------------------------------------------
CREATE TABLE users (
  user_id       INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  role_id       TINYINT UNSIGNED NOT NULL,
  email         VARCHAR(255)     NOT NULL,
  password_hash CHAR(60)         NOT NULL,              -- bcrypt
  first_name    VARCHAR(50)      NOT NULL,
  last_name     VARCHAR(50)      NOT NULL,
  username      VARCHAR(30)      NOT NULL,              -- public @handle in the social area
  social_bio    VARCHAR(160)     NULL,                  -- one-line bio on the social profile
  phone         VARCHAR(20)      NULL,
  is_active     BOOLEAN          NOT NULL DEFAULT TRUE,  -- accounts are deactivated, never deleted
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_users       PRIMARY KEY (user_id),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_username UNIQUE (username),        -- case-insensitive (utf8mb4_0900_ai_ci)
  CONSTRAINT fk_users_role  FOREIGN KEY (role_id) REFERENCES roles (role_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT ck_users_email CHECK (email LIKE '%_@_%._%'),
  CONSTRAINT ck_users_names CHECK (CHAR_LENGTH(TRIM(first_name)) > 0 AND CHAR_LENGTH(TRIM(last_name)) > 0),
  -- Instagram-style handle: 3–30 lowercase letters, digits, '.' or '_',
  -- starting and ending with a letter or digit, no '..'
  CONSTRAINT ck_users_username CHECK (REGEXP_LIKE(username, '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$', 'c')
                                      AND username NOT LIKE '%..%')
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- members: member profile, 1:1 with users (shared primary key)
-- ---------------------------------------------------------------------
CREATE TABLE members (
  member_id               INT UNSIGNED NOT NULL,
  date_of_birth           DATE         NULL,
  emergency_contact_name  VARCHAR(100) NULL,
  emergency_contact_phone VARCHAR(20)  NULL,
  joined_on               DATE         NOT NULL DEFAULT (CURRENT_DATE),
  CONSTRAINT pk_members      PRIMARY KEY (member_id),
  CONSTRAINT fk_members_user FOREIGN KEY (member_id) REFERENCES users (user_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT ck_members_dob  CHECK (date_of_birth IS NULL OR date_of_birth < joined_on)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- trainers: trainer profile, 1:1 with users (shared primary key)
-- ---------------------------------------------------------------------
CREATE TABLE trainers (
  trainer_id      INT UNSIGNED NOT NULL,
  specialization  VARCHAR(100) NOT NULL,
  bio             VARCHAR(500) NULL,
  hourly_rate_krw INT UNSIGNED NOT NULL DEFAULT 50000,  -- personal-training price per hour
  hired_on        DATE         NOT NULL DEFAULT (CURRENT_DATE),
  CONSTRAINT pk_trainers      PRIMARY KEY (trainer_id),
  CONSTRAINT fk_trainers_user FOREIGN KEY (trainer_id) REFERENCES users (user_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT ck_trainers_rate CHECK (hourly_rate_krw > 0)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- membership_plans: the catalogue of gym-access plans. Personal training
-- is not part of a plan; each session is booked and paid separately.
-- ---------------------------------------------------------------------
CREATE TABLE membership_plans (
  plan_id            SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_name          VARCHAR(50)       NOT NULL,
  description        VARCHAR(255)      NULL,
  duration_months    TINYINT UNSIGNED  NOT NULL,
  price_krw          INT UNSIGNED      NOT NULL,             -- current list price
  is_active          BOOLEAN           NOT NULL DEFAULT TRUE, -- still offered for sale
  created_at         DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_membership_plans PRIMARY KEY (plan_id),
  CONSTRAINT uq_plans_name       UNIQUE (plan_name),
  CONSTRAINT ck_plans_duration   CHECK (duration_months BETWEEN 1 AND 24),
  CONSTRAINT ck_plans_price      CHECK (price_krw > 0)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- subscriptions: a member's enrollment in a plan for a date range
--   Status (active / expired / upcoming / frozen / pending_payment) is
--   NOT stored. It is derived in v_subscription_status from the dates,
--   payments and freezes. Only the cancellation fact is stored.
-- ---------------------------------------------------------------------
CREATE TABLE subscriptions (
  subscription_id INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  member_id       INT UNSIGNED      NOT NULL,
  plan_id         SMALLINT UNSIGNED NOT NULL,
  start_date      DATE              NOT NULL,
  end_date        DATE              NOT NULL,   -- contractual end, extended by freezes
  price_krw       INT UNSIGNED      NOT NULL,   -- price agreed at sale time (plans can change price)
  cancelled_at    DATETIME          NULL,
  created_by      INT UNSIGNED      NULL,       -- admin, or the member for online purchases
  created_at      DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_subscriptions        PRIMARY KEY (subscription_id),
  CONSTRAINT fk_subscriptions_member FOREIGN KEY (member_id) REFERENCES members (member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_subscriptions_plan   FOREIGN KEY (plan_id) REFERENCES membership_plans (plan_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_subscriptions_by     FOREIGN KEY (created_by) REFERENCES users (user_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT ck_subscriptions_dates  CHECK (end_date >= start_date),
  INDEX ix_subscriptions_member_dates (member_id, start_date, end_date),
  INDEX ix_subscriptions_end_date (end_date)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- subscription_freezes: pauses (e.g. travel, injury). Each freeze
-- extends the subscription's end_date by its length (trigger).
-- ---------------------------------------------------------------------
CREATE TABLE subscription_freezes (
  freeze_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id INT UNSIGNED NOT NULL,
  freeze_start    DATE         NOT NULL,
  freeze_end      DATE         NOT NULL,
  reason          VARCHAR(255) NULL,
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_subscription_freezes PRIMARY KEY (freeze_id),
  CONSTRAINT fk_freezes_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (subscription_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_freezes_by           FOREIGN KEY (created_by) REFERENCES users (user_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT ck_freezes_dates        CHECK (freeze_end >= freeze_start),
  CONSTRAINT ck_freezes_length       CHECK (DATEDIFF(freeze_end, freeze_start) < 60)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- trainer_availability: recurring weekly working hours
--   day_of_week follows ISO-8601: 1 = Monday … 7 = Sunday
--   Times sit on a 30-minute grid so sessions line up.
-- ---------------------------------------------------------------------
CREATE TABLE trainer_availability (
  availability_id INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  trainer_id      INT UNSIGNED     NOT NULL,
  day_of_week     TINYINT UNSIGNED NOT NULL,
  start_time      TIME             NOT NULL,
  end_time        TIME             NOT NULL,
  CONSTRAINT pk_trainer_availability PRIMARY KEY (availability_id),
  CONSTRAINT fk_availability_trainer FOREIGN KEY (trainer_id) REFERENCES trainers (trainer_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT uq_availability_slot    UNIQUE (trainer_id, day_of_week, start_time),
  CONSTRAINT ck_availability_day     CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT ck_availability_times   CHECK (end_time > start_time),
  CONSTRAINT ck_availability_grid    CHECK (MINUTE(start_time) IN (0, 30) AND SECOND(start_time) = 0
                                        AND MINUTE(end_time)   IN (0, 30) AND SECOND(end_time)   = 0)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- bookings: 1-on-1 personal-training sessions, paid per session
--   Lifecycle: booked → completed | no_show | cancelled
-- ---------------------------------------------------------------------
CREATE TABLE bookings (
  booking_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id    INT UNSIGNED NOT NULL,
  trainer_id   INT UNSIGNED NOT NULL,
  starts_at    DATETIME     NOT NULL,
  ends_at      DATETIME     NOT NULL,
  status       ENUM('booked', 'completed', 'no_show', 'cancelled') NOT NULL DEFAULT 'booked',
  price_krw    INT UNSIGNED NOT NULL,   -- price agreed at booking; filled from the trainer's rate when omitted
  member_note  VARCHAR(255) NULL,   -- e.g. "focus on lower back"
  trainer_note VARCHAR(255) NULL,   -- written after the session
  cancelled_at DATETIME     NULL,
  cancelled_by INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_bookings              PRIMARY KEY (booking_id),
  CONSTRAINT fk_bookings_member       FOREIGN KEY (member_id) REFERENCES members (member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_trainer      FOREIGN KEY (trainer_id) REFERENCES trainers (trainer_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (user_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT ck_bookings_order        CHECK (ends_at > starts_at),
  CONSTRAINT ck_bookings_same_day     CHECK (DATE(ends_at) = DATE(starts_at)),
  CONSTRAINT ck_bookings_length       CHECK (TIMESTAMPDIFF(MINUTE, starts_at, ends_at) IN (30, 60, 90)),
  CONSTRAINT ck_bookings_grid         CHECK (MINUTE(starts_at) IN (0, 30) AND SECOND(starts_at) = 0),
  CONSTRAINT ck_bookings_cancelled    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  INDEX ix_bookings_trainer_time (trainer_id, starts_at, ends_at),
  INDEX ix_bookings_member_time  (member_id, starts_at, ends_at),
  INDEX ix_bookings_status_time  (status, starts_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- payments: money received (or attempted) for EITHER a subscription OR a
-- personal-training session (exactly one of the two references is set).
-- FK actions are RESTRICT because MySQL allows no cascading action on a
-- column that a CHECK constraint uses.
-- ---------------------------------------------------------------------
CREATE TABLE payments (
  payment_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id INT UNSIGNED NULL,           -- a membership payment...
  booking_id      INT UNSIGNED NULL,           -- ...or a training-session payment
  amount_krw      INT UNSIGNED NOT NULL,
  method          ENUM('cash', 'card', 'bank_transfer', 'online')   NOT NULL,
  status          ENUM('pending', 'paid', 'failed', 'refunded')     NOT NULL DEFAULT 'pending',
  paid_at         DATETIME     NULL,
  reference       VARCHAR(100) NULL,           -- receipt / transaction number
  recorded_by     INT UNSIGNED NULL,           -- admin at the desk, or the member online
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_payments              PRIMARY KEY (payment_id),
  CONSTRAINT fk_payments_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (subscription_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_payments_booking      FOREIGN KEY (booking_id) REFERENCES bookings (booking_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_payments_recorded_by  FOREIGN KEY (recorded_by) REFERENCES users (user_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT ck_payments_target       CHECK ((subscription_id IS NULL) <> (booking_id IS NULL)),
  CONSTRAINT ck_payments_amount       CHECK (amount_krw > 0),
  CONSTRAINT ck_payments_paid_at      CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL)),
  INDEX ix_payments_status_paid_at (status, paid_at)
) ENGINE = InnoDB;

-- =====================================================================
--  Social area: follows, posts, hashtags, likes and comments.
--  Users are deactivated, never deleted, so the user FKs RESTRICT
--  (MySQL also forbids cascading actions on columns a CHECK uses).
-- =====================================================================

-- ---------------------------------------------------------------------
-- follows: who follows whom (Instagram-style, one direction)
-- ---------------------------------------------------------------------
CREATE TABLE follows (
  follower_id INT UNSIGNED NOT NULL,
  followee_id INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_follows          PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users (user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follows_followee FOREIGN KEY (followee_id) REFERENCES users (user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_follows_not_self CHECK (follower_id <> followee_id),
  INDEX ix_follows_followee (followee_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- posts: short text posts (Twitter-style, 280 characters)
-- ---------------------------------------------------------------------
CREATE TABLE posts (
  post_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  author_id  INT UNSIGNED NOT NULL,
  body       VARCHAR(280) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_posts        PRIMARY KEY (post_id),
  CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users (user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_posts_body   CHECK (CHAR_LENGTH(TRIM(body)) > 0),
  INDEX ix_posts_author_time (author_id, created_at),
  INDEX ix_posts_time (created_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- hashtags / post_hashtags: #tags parsed from post bodies (M:N). They
-- drive the interest profile behind the "Suggested for you" feed.
-- ---------------------------------------------------------------------
CREATE TABLE hashtags (
  tag_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name   VARCHAR(30)       NOT NULL,               -- stored without '#', lowercase
  CONSTRAINT pk_hashtags      PRIMARY KEY (tag_id),
  CONSTRAINT uq_hashtags_name UNIQUE (name),
  CONSTRAINT ck_hashtags_name CHECK (REGEXP_LIKE(name, '^[a-z0-9_]{1,30}$', 'c'))
) ENGINE = InnoDB;

CREATE TABLE post_hashtags (
  post_id INT UNSIGNED      NOT NULL,
  tag_id  SMALLINT UNSIGNED NOT NULL,
  CONSTRAINT pk_post_hashtags PRIMARY KEY (post_id, tag_id),
  CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES posts (post_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_post_tags_tag  FOREIGN KEY (tag_id) REFERENCES hashtags (tag_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  INDEX ix_post_hashtags_tag (tag_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- post_likes: one like per user per post
-- ---------------------------------------------------------------------
CREATE TABLE post_likes (
  user_id    INT UNSIGNED NOT NULL,
  post_id    INT UNSIGNED NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_post_likes      PRIMARY KEY (user_id, post_id),
  CONSTRAINT fk_post_likes_user FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_post_likes_post FOREIGN KEY (post_id) REFERENCES posts (post_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  INDEX ix_post_likes_post (post_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- post_comments: replies under a post
-- ---------------------------------------------------------------------
CREATE TABLE post_comments (
  comment_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id    INT UNSIGNED NOT NULL,
  author_id  INT UNSIGNED NOT NULL,
  body       VARCHAR(280) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_post_comments        PRIMARY KEY (comment_id),
  CONSTRAINT fk_post_comments_post   FOREIGN KEY (post_id) REFERENCES posts (post_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_post_comments_author FOREIGN KEY (author_id) REFERENCES users (user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_post_comments_body   CHECK (CHAR_LENGTH(TRIM(body)) > 0),
  INDEX ix_post_comments_post_time (post_id, created_at),
  INDEX ix_post_comments_author (author_id)
) ENGINE = InnoDB;
