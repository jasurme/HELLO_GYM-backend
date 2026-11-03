# Gym Membership & Training Booking System — Project Plan

Team **Binary Minds** · Database Design course project
Source: `ProjectProposal_DatabaseDesign_Revised.pdf`

## Deliverables

1. **Working web app**: MySQL + Node.js/Express + Sequelize + Bootstrap, with login for members, trainers and admins.
2. **Presentation slides**: problem, ERD, 3NF normalization, business rules (triggers), reports, demo screenshots.

Supporting material in the repo: SQL scripts (`db/`), design notes (`docs/`), and automated tests (`tests/`).

## Decisions (from the Q&A)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Scope | Whole project, end to end |
| 2 | Deliverables | Working web app + presentation slides |
| 3 | Deadline | More than 3 weeks: full scope with polish |
| 4 | Language | English (UI, docs, slides) |
| 5 | Tooling | MySQL installed by the user (MySQL Community Server 26.10, `/usr/local/mysql`). Node.js 24 LTS portable in `~/.local/node` |
| 6 | ERD | The team builds the Workbench `.mwb` by reverse-engineering `db/01_schema.sql`. The repo ships a Mermaid ERD as well |
| 7 | Version control | Local git repo, one commit per step, no remote |
| 8 | Currency | KRW (whole won, no decimals) |
| 9 | Roles | `users` (login) → `roles` lookup FK. `members` and `trainers` are 1:1 profile tables sharing the user's PK |
| 10 | Booking model | Trainers set **weekly working hours**. Members book a **1-on-1 session** (30/60/90 min) at any free start time inside those hours |
| 11 | Plans | Duration (months) + price (KRW) + personal-training (PT) **sessions per month** quota |
| 12 | DB login | User starts MySQL, runs `scripts/setup-mysql.sh`, types the root password. A dedicated `gym_app` user is created |
| 13 | Payments | Admin records desk payments (cash/card). Members can do a **simulated** online checkout. Status: `pending / paid / failed / refunded` |
| 14 | Subscription status | **Derived** from dates + payments (`v_subscription_status`). Stored only: `cancelled_at`, plus a `subscription_freezes` history table |
| 15 | Booking lifecycle | `booked → completed / no_show` (set by the trainer) or `cancelled`. Members cancel ≥ 12 h before. Cancelled sessions don't count toward the quota |
| 16 | Rule enforcement | **Database (triggers + CHECK/FK) and app** (friendly messages, transactions with row locks) |
| 17 | Sign-up | Members self-register. Admins create trainers and admins. One admin is seeded |
| 18 | Reports | Active memberships, collected revenue, trainer bookings, **monthly revenue trend (12 mo)**, **expiring soon (7/30 days)** |
| 19 | DB showcase | **Views** + **Triggers** |
| 20 | Testing / data | Jest + Supertest API tests, a SQL rule-proof script, and medium seed data (~60 members, 6 trainers, 5 plans, 12 months of history) |

## System rules (from the proposal)

- **R1** A member can book only when an **active, fully-paid, non-frozen** subscription covers the session date.
- **R2** No **overlapping** sessions for a trainer. **R3** No overlapping sessions for a member.
- **R4** A session must fall inside the trainer's weekly **availability**.
- **R5** Monthly PT **quota** from the plan (`sessions_per_month`).
- **R6** A member's subscriptions must not overlap in time (renewals start after the current one ends).
- **R7** Role-based access: members see only their own data, trainers see only their own sessions and members, admins see everything.

R1–R6 are enforced by MySQL triggers/constraints **and** checked in the app. R7 is enforced in the Express middleware and query scoping.

## Work plan

1. **Setup**: Node.js, MySQL user/databases, git, project skeleton.
2. **Design**: entities, ERD (Mermaid), data dictionary.
3. **Normalization**: UNF → 1NF → 2NF → 3NF walkthrough (slide material).
4. **DDL**: `db/01_schema.sql` (tables, PK/FK, CHECK, indexes), `02_views.sql`, `03_triggers.sql`.
5. **Seed**: `scripts/generate-seed.js` → `db/04_seed.sql`. Dates are relative to the day of seeding, so the demo always looks current.
6. **Reports**: `db/05_reports.sql` (one query per report, also used by the API).
7. **Backend**: Express 5, Sequelize 6 (schema owned by SQL, no `sync`), sessions in MySQL, bcrypt, zod validation, RBAC middleware.
8. **Frontend**: static HTML + Bootstrap 5 + vanilla JS (`fetch`), Chart.js for trends. Dashboards per role.
9. **Tests**: Jest + Supertest against `gym_test`, plus `db/06_rule_tests.sql` proving each trigger.
10. **Docs & slides**: README (setup + demo accounts) and the presentation deck.

## Repository layout

```
db/        SQL: schema, views, triggers, seed, reports, rule tests
docs/      ERD, data dictionary, normalization notes
scripts/   setup-mysql.sh, db-reset.js, generate-seed.js
src/       Express app (config, models, middleware, routes, services)
public/    HTML/CSS/JS frontend (member/, trainer/, admin/)
tests/     Jest + Supertest
```
