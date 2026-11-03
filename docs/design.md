# Database Design: Gym Membership & Training Booking System

Team **Binary Minds**. This document describes the relational design behind the app: entities, the ERD, a data dictionary, the business rules, and how each rule is enforced.
The SQL source of truth is in [`db/`](../db). The normalization walkthrough is in [normalization.md](normalization.md).

## 1. Entities

| Entity | Table | Purpose |
|---|---|---|
| Role | `roles` | Lookup of access levels: admin, trainer, member |
| User | `users` | One login per person (email, bcrypt hash, name, phone, active flag) |
| Member | `members` | Member profile. **Subtype** of User (shared primary key) |
| Trainer | `trainers` | Trainer profile. **Subtype** of User (shared primary key) |
| Membership plan | `membership_plans` | Catalogue: duration, price, monthly personal-training quota |
| Subscription | `subscriptions` | A member enrolled in a plan for a date range at an agreed price |
| Subscription freeze | `subscription_freezes` | A pause in a subscription. Extends its end date |
| Payment | `payments` | Money received (or attempted) for a subscription |
| Trainer availability | `trainer_availability` | Recurring weekly working hours of a trainer |
| Booking | `bookings` | A 1-on-1 training session between a member and a trainer |

## 2. Entity-Relationship Diagram

```mermaid
erDiagram
    roles ||--o{ users : "grants access to"
    users ||--o| members : "is a"
    users ||--o| trainers : "is a"
    members ||--o{ subscriptions : "holds"
    membership_plans ||--o{ subscriptions : "is sold as"
    subscriptions ||--o{ payments : "is paid by"
    subscriptions ||--o{ subscription_freezes : "is paused by"
    trainers ||--o{ trainer_availability : "works during"
    members ||--o{ bookings : "books"
    trainers ||--o{ bookings : "leads"
    users |o--o{ payments : "records"
    users |o--o{ bookings : "cancels"

    roles {
        tinyint role_id PK
        varchar role_name UK
        varchar description
    }
    users {
        int user_id PK
        tinyint role_id FK
        varchar email UK
        char password_hash
        varchar first_name
        varchar last_name
        varchar phone
        bool is_active
        datetime created_at
        datetime updated_at
    }
    members {
        int member_id PK, FK
        date date_of_birth
        varchar emergency_contact_name
        varchar emergency_contact_phone
        date joined_on
    }
    trainers {
        int trainer_id PK, FK
        varchar specialization
        varchar bio
        date hired_on
    }
    membership_plans {
        smallint plan_id PK
        varchar plan_name UK
        varchar description
        tinyint duration_months
        int price_krw
        tinyint sessions_per_month
        bool is_active
    }
    subscriptions {
        int subscription_id PK
        int member_id FK
        smallint plan_id FK
        date start_date
        date end_date
        int price_krw
        datetime cancelled_at
        int created_by FK
    }
    subscription_freezes {
        int freeze_id PK
        int subscription_id FK
        date freeze_start
        date freeze_end
        varchar reason
        int created_by FK
    }
    payments {
        int payment_id PK
        int subscription_id FK
        int amount_krw
        enum method
        enum status
        datetime paid_at
        varchar reference
        int recorded_by FK
    }
    trainer_availability {
        int availability_id PK
        int trainer_id FK
        tinyint day_of_week
        time start_time
        time end_time
    }
    bookings {
        int booking_id PK
        int member_id FK
        int trainer_id FK
        datetime starts_at
        datetime ends_at
        enum status
        varchar member_note
        varchar trainer_note
        datetime cancelled_at
        int cancelled_by FK
    }
```

**MySQL Workbench:** to get the graphical `.mwb` model, use *File → Import → Reverse Engineer MySQL Create Script…*, select `db/01_schema.sql`, then *Arrange → Autolayout*. Alternatively, use *Database → Reverse Engineer* on the live `gym_db` connection.

### Relationships and cardinalities

| Relationship | Cardinality | Notes |
|---|---|---|
| roles → users | 1 : N | Every user has exactly one role |
| users → members / trainers | 1 : 0..1 | Specialization (subtype) via shared PK. Trigger R12 checks the role matches |
| members → subscriptions | 1 : N | History kept. Periods never overlap (R6) |
| membership_plans → subscriptions | 1 : N | `ON DELETE RESTRICT`: a sold plan can be retired (`is_active = 0`) but not deleted |
| subscriptions → payments | 1 : N | Installments, failed attempts and refunds are separate rows |
| subscriptions → subscription_freezes | 1 : N | Each freeze extends `end_date` (trigger) |
| trainers → trainer_availability | 1 : N | Weekly windows. Deleted with the trainer (`CASCADE`) |
| members ↔ trainers via bookings | M : N | `bookings` is the associative entity with its own attributes |

## 3. Data dictionary

Conventions: `INT UNSIGNED` surrogate keys, `utf8mb4`, InnoDB, money in whole **KRW** (`INT UNSIGNED`, no decimals), local time (Asia/Seoul).

### roles
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| role_id | TINYINT UNSIGNED | no | PK | 1 admin, 2 trainer, 3 member |
| role_name | VARCHAR(20) | no | UNIQUE | Name used by the app for authorization |
| description | VARCHAR(100) | yes | | Human-readable description |

### users
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| user_id | INT UNSIGNED | no | PK, AUTO_INCREMENT | Surrogate key |
| role_id | TINYINT UNSIGNED | no | FK → roles | Access level |
| email | VARCHAR(255) | no | UNIQUE, CHECK format | Login name |
| password_hash | CHAR(60) | no | | bcrypt hash (never the password) |
| first_name, last_name | VARCHAR(50) | no | CHECK non-blank | Person's name |
| phone | VARCHAR(20) | yes | | Contact number |
| is_active | BOOLEAN | no | TRUE | Deactivated accounts cannot log in or book |
| created_at, updated_at | DATETIME | no | CURRENT_TIMESTAMP | Audit timestamps |

### members
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| member_id | INT UNSIGNED | no | PK, FK → users (CASCADE) | Same value as the user's id |
| date_of_birth | DATE | yes | CHECK < joined_on | |
| emergency_contact_name | VARCHAR(100) | yes | | |
| emergency_contact_phone | VARCHAR(20) | yes | | |
| joined_on | DATE | no | CURRENT_DATE | Membership start (first visit) |

### trainers
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| trainer_id | INT UNSIGNED | no | PK, FK → users (CASCADE) | Same value as the user's id |
| specialization | VARCHAR(100) | no | | e.g. "Strength & Conditioning" |
| bio | VARCHAR(500) | yes | | Shown to members when booking |
| hired_on | DATE | no | CURRENT_DATE | |

### membership_plans
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| plan_id | SMALLINT UNSIGNED | no | PK, AUTO_INCREMENT | |
| plan_name | VARCHAR(50) | no | UNIQUE | |
| description | VARCHAR(255) | yes | | |
| duration_months | TINYINT UNSIGNED | no | CHECK 1–24 | |
| price_krw | INT UNSIGNED | no | CHECK > 0 | **Current** list price |
| sessions_per_month | TINYINT UNSIGNED | no | 0, CHECK ≤ 30 | Personal-training quota (0 = gym only) |
| is_active | BOOLEAN | no | TRUE | Still offered for sale |
| created_at, updated_at | DATETIME | no | CURRENT_TIMESTAMP | |

### subscriptions
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| subscription_id | INT UNSIGNED | no | PK, AUTO_INCREMENT | |
| member_id | INT UNSIGNED | no | FK → members (RESTRICT) | |
| plan_id | SMALLINT UNSIGNED | no | FK → membership_plans (RESTRICT) | |
| start_date | DATE | no | | First day of access |
| end_date | DATE | no | CHECK ≥ start_date | Last day of access. Extended by freezes |
| price_krw | INT UNSIGNED | no | | Price **agreed at sale** (discounts, later price changes) |
| cancelled_at | DATETIME | yes | | Set when cancelled. The only stored status fact |
| created_by | INT UNSIGNED | yes | FK → users (SET NULL) | Admin at the desk, or the member online |
| created_at | DATETIME | no | CURRENT_TIMESTAMP | |

Index `(member_id, start_date, end_date)` serves the overlap check (R6) and the "covering subscription" lookup (R1).

### subscription_freezes
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| freeze_id | INT UNSIGNED | no | PK, AUTO_INCREMENT | |
| subscription_id | INT UNSIGNED | no | FK → subscriptions (CASCADE) | |
| freeze_start, freeze_end | DATE | no | CHECK end ≥ start, < 60 days | Inclusive pause period |
| reason | VARCHAR(255) | yes | | |
| created_by | INT UNSIGNED | yes | FK → users (SET NULL) | |
| created_at | DATETIME | no | CURRENT_TIMESTAMP | |

### payments
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| payment_id | INT UNSIGNED | no | PK, AUTO_INCREMENT | |
| subscription_id | INT UNSIGNED | no | FK → subscriptions (RESTRICT) | |
| amount_krw | INT UNSIGNED | no | CHECK > 0 | |
| method | ENUM | no | cash, card, bank_transfer, online | |
| status | ENUM | no | pending | pending → paid / failed. paid → refunded |
| paid_at | DATETIME | yes | CHECK set ⇔ paid/refunded | When the money arrived |
| reference | VARCHAR(100) | yes | | Receipt or transaction number |
| recorded_by | INT UNSIGNED | yes | FK → users (SET NULL) | |
| created_at, updated_at | DATETIME | no | CURRENT_TIMESTAMP | |

Index `(status, paid_at)` serves the revenue reports.

### trainer_availability
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| availability_id | INT UNSIGNED | no | PK, AUTO_INCREMENT | |
| trainer_id | INT UNSIGNED | no | FK → trainers (CASCADE) | |
| day_of_week | TINYINT UNSIGNED | no | CHECK 1–7 | ISO-8601: 1 = Monday … 7 = Sunday |
| start_time, end_time | TIME | no | CHECK end > start, 30-min grid | |

`UNIQUE (trainer_id, day_of_week, start_time)`

### bookings
| Column | Type | Null | Key / Default | Description |
|---|---|---|---|---|
| booking_id | INT UNSIGNED | no | PK, AUTO_INCREMENT | |
| member_id | INT UNSIGNED | no | FK → members (RESTRICT) | |
| trainer_id | INT UNSIGNED | no | FK → trainers (RESTRICT) | |
| starts_at, ends_at | DATETIME | no | CHECK: same day, 30/60/90 min, :00/:30 start | |
| status | ENUM | no | booked | booked → completed / no_show / cancelled |
| member_note | VARCHAR(255) | yes | | Request from the member |
| trainer_note | VARCHAR(255) | yes | | Written after the session |
| cancelled_at | DATETIME | yes | CHECK set ⇔ cancelled | |
| cancelled_by | INT UNSIGNED | yes | FK → users (SET NULL) | |
| created_at, updated_at | DATETIME | no | CURRENT_TIMESTAMP | |

Indexes `(trainer_id, starts_at, ends_at)` and `(member_id, starts_at, ends_at)` serve the overlap checks (R2/R3). `(status, starts_at)` serves schedules and reports.

## 4. Business rules and where they are enforced

Database errors raised by triggers use `SQLSTATE 45000` with a message starting `[R#]`. The API returns them as **HTTP 409** with the text. The app also checks the rules first, to give friendlier messages and available-slot lists.

| # | Rule | Database | App |
|---|---|---|---|
| R1 | Booking needs an active, fully-paid, non-frozen subscription on the session date | `assert_booking_rules` ← `trg_bookings_bi/bu` | booking service |
| R2 | A trainer has no overlapping sessions | same procedure + index | slot finder hides taken slots. Booking runs in a transaction with row locks |
| R3 | A member has no overlapping sessions | same procedure + index | same |
| R4 | Sessions fit the trainer's weekly hours | same procedure | slot finder |
| R5 | Monthly personal-training quota from the plan | same procedure | quota shown on dashboard |
| R6 | A member's (non-cancelled) subscriptions never overlap | `trg_subscriptions_bi/bu` | renewal starts after current end |
| R7 | Role-based access (members/trainers see only their own data) | (FKs scope data) | `requireRole` middleware + query scoping |
| R8 | Booking lifecycle: only `booked` changes. Complete/no-show only after start | `trg_bookings_bu` | members cancel ≥ 12 h ahead (app rule) |
| R9 | Live payments ≤ agreed price. Lifecycle pending→paid/failed, paid→refunded | `assert_payment_within_price` ← `trg_payments_bi/bu` | payment forms |
| R10 | Freezes start inside the subscription, never overlap, no booked sessions inside. They extend `end_date` and cannot be edited | `trg_freezes_bi/ai/ad/bu` | admin freeze form |
| R11 | A trainer's weekly windows never overlap | `trg_availability_bi/bu` | availability editor |
| R12 | Profiles match the role. Inactive accounts cannot book. Roles of profiled users are fixed | `trg_members_bi`, `trg_trainers_bi`, `trg_users_bu`, procedure | login refuses inactive users |

Automatic behaviour (triggers):
- A freeze **extends** the subscription's `end_date` by its length. Deleting the freeze gives the days back.
- Cancelling a subscription **cancels** the member's future sessions it covered.
- `paid_at` / `cancelled_at` are stamped when a status changes to paid / cancelled.

All rules are demonstrated in [`db/06_rule_tests.sql`](../db/06_rule_tests.sql). `npm run db:check-rules` runs it and confirms all 25 rejections.

## 5. Views (derived data)

| View | Used for |
|---|---|
| `v_subscription_status` | Derived status (`active`, `expired`, `upcoming`, `frozen`, `pending_payment`, `cancelled`), paid total, balance, days left |
| `v_active_subscriptions` | Active-membership counts, booking eligibility lists |
| `v_expiring_subscriptions` | "Expiring soon" report (≤ 30 days), with whether the member already renewed |
| `v_trainer_schedule` | Trainer and member schedules with names and duration |
| `v_trainer_booking_stats` | Trainer bookings report: completed, no-shows, hours delivered, distinct members |
| `v_monthly_revenue` | Revenue trend (collected and refunded per month) |
| `v_member_monthly_usage` | Personal-training sessions used per member per month (quota display) |

## 6. Concurrency

Triggers check overlaps with `SELECT … EXISTS`, which on its own does not stop two simultaneous requests from both passing the check. The booking service therefore runs each booking in a transaction. It first locks the trainer's and member's profile rows (`SELECT … FOR UPDATE`), always in the same order to avoid deadlocks. Concurrent bookings for the same trainer or member are thus serialized, and the trigger always sees the other booking.
