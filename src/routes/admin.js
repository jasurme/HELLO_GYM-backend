const express = require('express');
const { requireRole } = require('../middleware/auth');
const { sequelize, Plan, Payment, User, Role } = require('../models');
const users = require('../services/users');
const subscriptions = require('../services/subscriptions');
const payments = require('../services/payments');
const bookings = require('../services/bookings');
const availability = require('../services/availability');
const { select, selectOne } = require('../lib/sql');
const { notFound, conflict } = require('../lib/http-error');
const time = require('../lib/time');
const v = require('../lib/validate');

const router = express.Router();
router.use(requireRole('admin'));

const idParam = (req) => v.validate(v.id, req.params.id);

async function requireRoleOf(userId, roleName) {
  const user = await User.findByPk(userId, { include: [Role] });
  if (!user || user.Role.roleName !== roleName) throw notFound(roleName === 'member' ? 'Member' : 'Trainer');
  return user;
}

// =====================================================================
// Members
// =====================================================================
router.get('/members', async (req, res) => {
  const { search, status } = v.validate(v.z.object({
    search: v.z.string().trim().optional(),
    status: v.z.enum(['active', 'frozen', 'pending_payment', 'upcoming', 'expired', 'none', 'inactive']).optional(),
  }), req.query);
  const where = [];
  const params = {};
  if (search) {
    where.push("(CONCAT(u.first_name, ' ', u.last_name) LIKE :search OR u.email LIKE :search OR u.phone LIKE :search)");
    params.search = `%${search}%`;
  }
  if (status === 'none') where.push('cur.subscription_id IS NULL');
  else if (status === 'inactive') where.push('NOT u.is_active');
  else if (status) { where.push('cur.status = :status'); params.status = status; }

  // "Current" membership: the one covering today, otherwise the most recent.
  res.json(await select(
    `SELECT u.user_id AS member_id, u.first_name, u.last_name, u.email, u.phone, u.is_active, m.joined_on,
            cur.subscription_id, cur.plan_name, cur.status AS membership_status, cur.end_date, cur.balance_krw
     FROM members m
     JOIN users u ON u.user_id = m.member_id
     LEFT JOIN v_subscription_status cur ON cur.subscription_id = (
       SELECT s.subscription_id FROM subscriptions s
       WHERE s.member_id = m.member_id AND s.cancelled_at IS NULL
       ORDER BY (CURDATE() BETWEEN s.start_date AND s.end_date) DESC, s.start_date DESC
       LIMIT 1)
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY u.last_name, u.first_name`,
    params,
  ));
});

router.get('/members/:id', async (req, res) => {
  const memberId = idParam(req);
  await requireRoleOf(memberId, 'member');
  const [profile, subs, recentBookings, memberPayments, usage] = await Promise.all([
    users.profile(memberId),
    subscriptions.listSubscriptions({ memberId }),
    bookings.listBookings({ memberId, limit: 30 }),
    payments.listPayments({ memberId }),
    select(
      `SELECT month, sessions_used FROM v_member_monthly_usage
       WHERE member_id = :memberId ORDER BY month DESC LIMIT 6`,
      { memberId },
    ),
  ]);
  const freezes = await select(
    `SELECT f.* FROM subscription_freezes f JOIN subscriptions s ON s.subscription_id = f.subscription_id
     WHERE s.member_id = :memberId ORDER BY f.freeze_start DESC`,
    { memberId },
  );
  res.json({ profile, subscriptions: subs, bookings: recentBookings, payments: memberPayments, freezes, usage });
});

// Money taken at the front desk: always paid on the spot.
const deskPaymentSchema = v.z.object({
  method: v.z.enum(['cash', 'card', 'bank_transfer']),
  reference: v.optionalText(100),
});
const deskCharge = ({ method, reference }) => () => ({ method, reference, status: 'paid', paidAt: time.now() });

const newMemberSchema = v.z.object({
  email: v.email,
  password: v.password,
  firstName: v.name,
  lastName: v.name,
  phone: v.phone,
  dateOfBirth: v.optionalDate,
  emergencyContactName: v.optionalText(100),
  emergencyContactPhone: v.phone,
  planId: v.id,
  payment: deskPaymentSchema,
});

// No free members: the desk enrolls a person together with a paid plan.
router.post('/members', async (req, res) => {
  const { planId, payment, ...person } = v.validate(newMemberSchema, req.body);
  const userId = await users.createMemberWithPlan({
    person, planId, charge: deskCharge(payment), createdBy: req.user.userId,
  });
  res.status(201).json(await users.profile(userId));
});

const editPersonSchema = v.z.object({
  firstName: v.name.optional(),
  lastName: v.name.optional(),
  email: v.email.optional(),
  phone: v.phone,
  isActive: v.z.boolean().optional(),
  dateOfBirth: v.optionalDate,
  emergencyContactName: v.optionalText(100),
  emergencyContactPhone: v.phone,
  specialization: v.z.string().trim().min(1).max(100).optional(),
  bio: v.optionalText(500),
  hourlyRateKrw: v.money.optional(),
  hiredOn: v.date.optional(),
});

// Applies only the fields present in the request body.
function pick(data, body, keys) {
  const out = {};
  for (const key of keys) if (key in body) out[key] = data[key];
  return out;
}

router.patch('/members/:id', async (req, res) => {
  const memberId = idParam(req);
  await requireRoleOf(memberId, 'member');
  const data = v.validate(editPersonSchema, req.body);
  await users.updateUser(memberId, {
    account: pick(data, req.body, ['firstName', 'lastName', 'email', 'phone', 'isActive']),
    profile: pick(data, req.body, ['dateOfBirth', 'emergencyContactName', 'emergencyContactPhone']),
  });
  res.json(await users.profile(memberId));
});

// =====================================================================
// Trainers
// =====================================================================
router.get('/trainers', async (req, res) => {
  res.json(await select(
    `SELECT s.*, u.email, u.phone, u.is_active, t.hired_on, t.hourly_rate_krw,
            (SELECT COUNT(*) FROM trainer_availability a WHERE a.trainer_id = t.trainer_id) AS windows
     FROM v_trainer_booking_stats s
     JOIN trainers t ON t.trainer_id = s.trainer_id
     JOIN users u    ON u.user_id = s.trainer_id
     ORDER BY u.is_active DESC, s.trainer_name`,
  ));
});

router.get('/trainers/:id', async (req, res) => {
  const trainerId = idParam(req);
  await requireRoleOf(trainerId, 'trainer');
  const [profile, hours, upcoming, stats] = await Promise.all([
    users.profile(trainerId),
    availability.list(trainerId),
    bookings.listBookings({ trainerId, scope: 'upcoming', limit: 50 }),
    selectOne('SELECT * FROM v_trainer_booking_stats WHERE trainer_id = :trainerId', { trainerId }),
  ]);
  res.json({ profile, hours, upcoming, stats });
});

const newTrainerSchema = v.z.object({
  email: v.email,
  password: v.password,
  firstName: v.name,
  lastName: v.name,
  phone: v.phone,
  specialization: v.z.string().trim().min(1, 'Required').max(100),
  bio: v.optionalText(500),
  hourlyRateKrw: v.money.optional(),
  hiredOn: v.optionalDate,
});

router.post('/trainers', async (req, res) => {
  const data = v.validate(newTrainerSchema, req.body);
  const userId = await users.createUser({ role: 'trainer', ...data, profile: data });
  res.status(201).json(await users.profile(userId));
});

router.patch('/trainers/:id', async (req, res) => {
  const trainerId = idParam(req);
  await requireRoleOf(trainerId, 'trainer');
  const data = v.validate(editPersonSchema, req.body);
  await users.updateUser(trainerId, {
    account: pick(data, req.body, ['firstName', 'lastName', 'email', 'phone', 'isActive']),
    profile: pick(data, req.body, ['specialization', 'bio', 'hourlyRateKrw', 'hiredOn']),
  });
  res.json(await users.profile(trainerId));
});

const windowSchema = v.z.object({
  dayOfWeek: v.z.coerce.number().int().min(1).max(7),
  startTime: v.time,
  endTime: v.time,
});

router.post('/trainers/:id/availability', async (req, res) => {
  const trainerId = idParam(req);
  await requireRoleOf(trainerId, 'trainer');
  res.status(201).json(await availability.add(trainerId, v.validate(windowSchema, req.body)));
});

router.delete('/trainers/:id/availability/:windowId', async (req, res) => {
  res.json(await availability.remove(idParam(req), v.validate(v.id, req.params.windowId)));
});

// =====================================================================
// Plans
// =====================================================================
router.get('/plans', async (req, res) => {
  res.json(await select(
    `SELECT p.*,
            (SELECT COUNT(*) FROM v_subscription_status v WHERE v.plan_id = p.plan_id AND v.status IN ('active', 'frozen')) AS active_members,
            (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.plan_id) AS times_sold
     FROM membership_plans p
     ORDER BY p.is_active DESC, p.duration_months`,
  ));
});

const planSchema = v.z.object({
  planName: v.z.string().trim().min(1, 'Required').max(50),
  description: v.optionalText(255),
  durationMonths: v.z.coerce.number().int().min(1).max(24),
  priceKrw: v.money,
  isActive: v.z.boolean().optional(),
});

router.post('/plans', async (req, res) => {
  res.status(201).json(await Plan.create(v.validate(planSchema, req.body)));
});

// Price changes only affect new sales: subscriptions keep their agreed price.
router.patch('/plans/:id', async (req, res) => {
  const plan = await Plan.findByPk(idParam(req));
  if (!plan) throw notFound('Plan');
  const data = v.validate(planSchema.partial(), req.body);
  await plan.update(pick(data, req.body, Object.keys(planSchema.shape)));
  res.json(plan);
});

// Only never-sold plans can be deleted (FK RESTRICT); others are retired.
router.delete('/plans/:id', async (req, res) => {
  const plan = await Plan.findByPk(idParam(req));
  if (!plan) throw notFound('Plan');
  try {
    await plan.destroy();
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      throw conflict('This plan has been sold, so it cannot be deleted. Mark it as not for sale instead.');
    }
    throw err;
  }
  res.status(204).end();
});

// =====================================================================
// Subscriptions & freezes
// =====================================================================
router.get('/subscriptions', async (req, res) => {
  const query = v.validate(v.z.object({
    status: v.z.enum(['active', 'frozen', 'pending_payment', 'upcoming', 'expired', 'cancelled']).optional(),
    search: v.z.string().trim().optional(),
  }), req.query);
  res.json(await subscriptions.listSubscriptions(query));
});

router.get('/subscriptions/:id', async (req, res) => {
  res.json(await subscriptions.subscriptionDetail(idParam(req)));
});

const newSubscriptionSchema = v.z.object({
  memberId: v.id,
  planId: v.id,
  startDate: v.optionalDate,
  priceKrw: v.money.optional(),
  payment: v.z.object({
    amountKrw: v.money,
    method: v.z.enum(['cash', 'card', 'bank_transfer']),
    reference: v.optionalText(100),
  }).optional().nullable(),
});

// Sell a plan at the desk, optionally taking payment at the same time.
router.post('/subscriptions', async (req, res) => {
  const data = v.validate(newSubscriptionSchema, req.body);
  await requireRoleOf(data.memberId, 'member');
  const subscriptionId = await sequelize.transaction(async (transaction) => {
    const sub = await subscriptions.createSubscription({
      memberId: data.memberId,
      planId: data.planId,
      startDate: data.startDate,
      priceKrw: data.priceKrw,
      createdBy: req.user.userId,
    }, { transaction });
    if (data.payment) {
      await Payment.create({
        subscriptionId: sub.subscriptionId,
        ...data.payment,
        status: 'paid',
        paidAt: time.now(),
        recordedBy: req.user.userId,
      }, { transaction });
    }
    return sub.subscriptionId;
  });
  res.status(201).json(await subscriptions.subscriptionDetail(subscriptionId));
});

router.post('/subscriptions/:id/cancel', async (req, res) => {
  const { refund } = v.validate(v.z.object({ refund: v.z.boolean().optional() }), req.body);
  const subscriptionId = idParam(req);
  const result = await subscriptions.cancelSubscription(subscriptionId, { refund });
  res.json({ ...result, subscription: await subscriptions.subscriptionDetail(subscriptionId) });
});

const freezeSchema = v.z.object({
  freezeStart: v.date,
  days: v.z.coerce.number().int().min(1).max(60),
  reason: v.optionalText(255),
});

router.post('/subscriptions/:id/freezes', async (req, res) => {
  const subscriptionId = idParam(req);
  const data = v.validate(freezeSchema, req.body);
  await subscriptions.addFreeze(subscriptionId, { ...data, createdBy: req.user.userId });
  res.status(201).json(await subscriptions.subscriptionDetail(subscriptionId));
});

router.delete('/freezes/:id', async (req, res) => {
  await subscriptions.removeFreeze(idParam(req));
  res.status(204).end();
});

// =====================================================================
// Payments
// =====================================================================
router.get('/payments', async (req, res) => {
  const query = v.validate(v.z.object({
    status: v.z.enum(['pending', 'paid', 'failed', 'refunded']).optional(),
    kind: v.z.enum(['membership', 'training']).optional(),
    from: v.date.optional(),
    to: v.date.optional(),
    search: v.z.string().trim().optional(),
  }), req.query);
  res.json(await payments.listPayments(query));
});

// A desk payment towards a membership (session payments come with the booking).
const paymentSchema = v.z.object({
  subscriptionId: v.id,
  amountKrw: v.money,
  method: v.z.enum(['cash', 'card', 'bank_transfer', 'online']),
  status: v.z.enum(['paid', 'pending']).default('paid'),
  reference: v.optionalText(100),
});

router.post('/payments', async (req, res) => {
  const data = v.validate(paymentSchema, req.body);
  const payment = await payments.recordPayment({ ...data, recordedBy: req.user.userId });
  res.status(201).json(payment);
});

router.patch('/payments/:id', async (req, res) => {
  const { status } = v.validate(v.z.object({ status: v.z.enum(['paid', 'failed', 'refunded']) }), req.body);
  res.json(await payments.updateStatus(idParam(req), status));
});

// =====================================================================
// Bookings (front desk can book on a member's behalf)
// =====================================================================
router.get('/bookings', async (req, res) => {
  const query = v.validate(v.z.object({
    from: v.date.optional(),
    to: v.date.optional(),
    trainerId: v.id.optional(),
    memberId: v.id.optional(),
    status: v.z.enum(['booked', 'completed', 'no_show', 'cancelled']).optional(),
    scope: v.z.enum(['upcoming', 'past', 'to_mark']).optional(),
    search: v.z.string().trim().optional(),
  }), req.query);
  res.json(await bookings.listBookings(query));
});

router.get('/slots', async (req, res) => {
  const query = v.validate(v.z.object({
    trainerId: v.id,
    memberId: v.id.optional(),
    date: v.date,
    duration: v.z.coerce.number().int().default(60),
  }), req.query);
  res.json(await bookings.findSlots(query));
});

const adminBookingSchema = v.z.object({
  memberId: v.id,
  trainerId: v.id,
  startsAt: v.dateTime,
  duration: v.z.coerce.number().int().default(60),
  memberNote: v.optionalText(255),
  payment: deskPaymentSchema,
});

// The desk may book at short notice (no lead-time policy), never in the past,
// and takes the session's payment at the same time.
router.post('/bookings', async (req, res) => {
  const { payment, ...data } = v.validate(adminBookingSchema, req.body);
  res.status(201).json(await bookings.createBooking({
    ...data, enforcePolicy: false, charge: deskCharge(payment), recordedBy: req.user.userId,
  }));
});

router.post('/bookings/:id/cancel', async (req, res) => {
  res.json(await bookings.cancelBooking(idParam(req), req.user));
});

module.exports = router;
