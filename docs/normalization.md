# Normalization: from a gym spreadsheet to 3NF

The problem statement says gyms keep membership, scheduling and payment data in scattered places, which leads to duplicates and inconsistencies. This walkthrough starts from the single sheet a front desk might keep and normalizes it step by step to **Third Normal Form**. It also shows that the final schema is in BCNF.

## Step 0: Unnormalized form (UNF)

One row per member, with **repeating groups** for payments and sessions:

| member_email | member_name | phone | plan | plan_price | months | pt_quota | sub_start | sub_end | sub_price | payments | sessions |
|---|---|---|---|---|---|---|---|---|---|---|---|
| minji.kim@… | Minji Kim | 010-… | Premium Half-Year | 1,590,000 | 6 | 8 | 2026-09-24 | 2027-03-23 | 1,590,000 | `card 1,590,000 2026-09-24 paid` | `11-07 11:30 Daniel Park (Strength), booked; 11-12 16:30 Hyun-woo Choi (Boxing), booked; …` |

Problems:
- **Repeating groups / non-atomic cells** (`payments`, `sessions`), so you can't query "sessions with Daniel next week".
- **Update anomaly**: the plan price is repeated in every member row. A price change must touch many rows, and some will be missed.
- **Insert anomaly**: a new trainer cannot be recorded until someone books them.
- **Delete anomaly**: deleting a member's last row loses the only record of that plan's price or that trainer's specialization.

## Step 1: First Normal Form (1NF)

Rule: atomic values, no repeating groups, and every relation has a key.

Split the repeating groups into their own relations. Each row now holds one fact:

```
SUBSCRIPTION_1NF (member_email, sub_start, member_name, phone, plan, plan_price, months, pt_quota, sub_end, sub_price)
PAYMENT_1NF      (payment_ref, member_email, sub_start, amount, paid_at, method, status)
SESSION_1NF      (member_email, session_start, session_end, member_name, trainer_email, trainer_name, specialization, status)
```

Functional dependencies (FDs) we can now see:

| FD | Meaning |
|---|---|
| member_email → member_name, phone | a person's details |
| plan → plan_price, months, pt_quota | catalogue data |
| trainer_email → trainer_name, specialization | trainer details |
| (member_email, sub_start) → plan, sub_end, sub_price | one subscription |
| (member_email, session_start) → session_end, trainer_email, status | one session |

## Step 2: Second Normal Form (2NF)

Rule: 1NF, and no non-key attribute depends on **part** of a composite key.

In `SUBSCRIPTION_1NF` the key is `(member_email, sub_start)`, but `member_name` and `phone` depend on `member_email` alone. That is a **partial dependency**. `SESSION_1NF` has the same problem with `member_name`.

Move those attributes out:

```
MEMBER        (member_email, member_name, phone)
SUBSCRIPTION  (member_email, sub_start, plan, plan_price, months, pt_quota, sub_end, sub_price)
PAYMENT       (payment_ref, member_email, sub_start, amount, paid_at, method, status)
SESSION       (member_email, session_start, session_end, trainer_email, trainer_name, specialization, status)
```

## Step 3: Third Normal Form (3NF)

Rule: 2NF, and no non-key attribute depends on another non-key attribute (**transitive dependency**).

- `SUBSCRIPTION`: key → `plan` → `plan_price, months, pt_quota`. Plan details move to **PLAN**.
- `SESSION`: key → `trainer_email` → `trainer_name, specialization`. Trainer details move to **TRAINER**.

```
MEMBER        (member_email, member_name, phone)
TRAINER       (trainer_email, trainer_name, specialization)
PLAN          (plan, plan_price, months, pt_quota)
SUBSCRIPTION  (member_email, sub_start, plan → PLAN, sub_end, sub_price)
PAYMENT       (payment_ref, (member_email, sub_start) → SUBSCRIPTION, amount, paid_at, method, status)
SESSION       (member_email, session_start, trainer_email → TRAINER, session_end, status)
AVAILABILITY  (trainer_email, day_of_week, start_time, end_time)
```

## Step 4: From 3NF to the physical schema

These refinements keep 3NF and make the design practical:

1. **Surrogate keys.** Emails and names change, so every table gets an integer id (`user_id`, `plan_id`, `subscription_id`, …). The natural keys stay as `UNIQUE` constraints (`users.email`, `membership_plans.plan_name`).
2. **Generalization of people.** MEMBER and TRAINER both have email, name, phone and a password, as do admins. Those attributes move to a supertype **`users`** with a `role_id → roles` lookup. `members` and `trainers` keep only role-specific attributes and share the user's primary key (1 : 0..1). No person's name or email is stored twice.
3. **Bookings as an associative entity** resolve the M : N between members and trainers, with their own attributes (time, status, notes).
4. **Freezes** become their own relation (`subscription_freezes`), because a subscription can be paused several times.

## Design decisions that look like redundancy but are not

| Column | Why it is not a 3NF violation |
|---|---|
| `subscriptions.price_krw` alongside `membership_plans.price_krw` | The plan holds the **current** list price. The subscription holds the price **agreed at the time of sale**, including discounts. They are different facts: when the plan price changes, old subscriptions must keep their price. `subscription → price` holds, but `plan → subscription price` does not. |
| `subscriptions.end_date` | It is not determined by `start_date + plan.duration`: freezes extend it and admins may adjust it. It is the contractual end date, a fact of the sale. Each extension is recorded in `subscription_freezes`. |
| `bookings.ends_at` | Sessions last 30, 60 or 90 minutes, so the end time is not derivable from the start time. |
| No `subscription_id` on `bookings` | It *would* be redundant: R6 guarantees subscriptions never overlap, so `(member_id, DATE(starts_at))` already determines the covering subscription. Storing it would add a transitive dependency. |
| No `status` column on `subscriptions` | Active / expired / upcoming / frozen / pending-payment all follow from the dates, the payments, the freezes and today's date. A stored status would go stale every midnight (an update anomaly). It is computed in the view `v_subscription_status`. Only `cancelled_at`, a real event, is stored. |
| Names shown with bookings | They are joined from `users` in views (`v_trainer_schedule`), never copied. |

## BCNF check

A relation is in BCNF when every determinant is a candidate key.

| Table | Determinants | Candidate keys | BCNF? |
|---|---|---|---|
| roles | role_id, role_name | role_id, role_name | yes |
| users | user_id, email | user_id, email | yes |
| members, trainers | member_id / trainer_id | same | yes |
| membership_plans | plan_id, plan_name | plan_id, plan_name | yes |
| subscriptions | subscription_id | subscription_id | yes |
| subscription_freezes | freeze_id | freeze_id | yes |
| payments | payment_id | payment_id | yes |
| trainer_availability | availability_id, (trainer_id, day_of_week, start_time) | both | yes |
| bookings | booking_id | booking_id | yes |

The schema is therefore in **3NF and also in BCNF**.

## Anomalies revisited

| Anomaly in the spreadsheet | In the final schema |
|---|---|
| Change a plan's price in many rows | One `UPDATE membership_plans` row. Existing subscriptions keep their agreed price |
| Can't add a trainer without a booking | Insert into `users` + `trainers`. Availability is separate |
| Deleting a member loses plan/trainer data | Plans and trainers are independent. Members are deactivated (`is_active = 0`), and FKs use `RESTRICT` to protect financial history |
| Two sessions for one trainer at the same time | Prevented by trigger R2 (plus the transaction lock in the app) |
