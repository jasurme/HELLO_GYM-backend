const express = require('express');
const { requireRole } = require('../middleware/auth');
const subscriptions = require('../services/subscriptions');
const bookings = require('../services/bookings');
const payments = require('../services/payments');
const { HttpError } = require('../lib/http-error');
const time = require('../lib/time');
const v = require('../lib/validate');

// Every query below is scoped to the logged-in member (R7).
const router = express.Router();
router.use(requireRole('member'));

const me = (req) => req.user.userId;

router.get('/overview', async (req, res) => {
  const memberId = me(req);
  const { current, next } = await subscriptions.memberSubscriptions(memberId);
  const [usage, upcoming, eligibility, unpaid] = await Promise.all([
    current ? subscriptions.monthlyUsage(memberId, current.sessionsPerMonth) : null,
    bookings.listBookings({ memberId, scope: 'upcoming', limit: 5 }),
    bookings.getEligibility(memberId, time.today()),
    subscriptions.listSubscriptions({ memberId, status: 'pending_payment' }),
  ]);
  res.json({ current, next, usage, upcoming, eligibility, unpaid });
});

// ---- Subscriptions & payments ---------------------------------------
router.get('/subscriptions', async (req, res) => {
  res.json(await subscriptions.listSubscriptions({ memberId: me(req) }));
});

router.get('/subscriptions/:id', async (req, res) => {
  res.json(await subscriptions.subscriptionDetail(v.validate(v.id, req.params.id), { memberId: me(req) }));
});

// Buy or renew a plan: creates the subscription with a pending online payment.
router.post('/subscriptions', async (req, res) => {
  const { planId } = v.validate(v.z.object({ planId: v.id }), req.body);
  const sub = await subscriptions.purchaseOnline(me(req), planId);
  res.status(201).json(await subscriptions.subscriptionDetail(sub.subscriptionId));
});

// Simulated online checkout; { simulateFailure: true } demonstrates a decline.
router.post('/subscriptions/:id/checkout', async (req, res) => {
  const subscriptionId = v.validate(v.id, req.params.id);
  const { simulateFailure } = v.validate(v.z.object({ simulateFailure: v.z.boolean().optional() }), req.body);
  const { declined } = await subscriptions.checkout(me(req), subscriptionId, { simulateFailure });
  if (declined) throw new HttpError(402, 'The payment was declined (simulated). No money was taken. Please try again.');
  res.json(await subscriptions.subscriptionDetail(subscriptionId));
});

router.post('/subscriptions/:id/cancel', async (req, res) => {
  const subscriptionId = v.validate(v.id, req.params.id);
  await subscriptions.cancelUnpaid(me(req), subscriptionId);
  res.json(await subscriptions.subscriptionDetail(subscriptionId));
});

router.get('/payments', async (req, res) => {
  res.json(await payments.listPayments({ memberId: me(req) }));
});

// ---- Booking ----------------------------------------------------------
router.get('/eligibility', async (req, res) => {
  const { date } = v.validate(v.z.object({ date: v.date }), req.query);
  res.json(await bookings.getEligibility(me(req), date));
});

router.get('/trainers/:id/slots', async (req, res) => {
  const trainerId = v.validate(v.id, req.params.id);
  const { date, duration } = v.validate(v.z.object({
    date: v.date,
    duration: v.z.coerce.number().int().default(60),
  }), req.query);
  res.json(await bookings.findSlots({ trainerId, date, duration, memberId: me(req) }));
});

router.get('/bookings', async (req, res) => {
  const { scope } = v.validate(v.z.object({ scope: v.z.enum(['upcoming', 'past']).optional() }), req.query);
  res.json(await bookings.listBookings({ memberId: me(req), scope }));
});

const bookingSchema = v.z.object({
  trainerId: v.id,
  startsAt: v.dateTime,
  duration: v.z.coerce.number().int().default(60),
  memberNote: v.optionalText(255),
});

router.post('/bookings', async (req, res) => {
  const data = v.validate(bookingSchema, req.body);
  res.status(201).json(await bookings.createBooking({ ...data, memberId: me(req) }));
});

router.post('/bookings/:id/cancel', async (req, res) => {
  res.json(await bookings.cancelBooking(v.validate(v.id, req.params.id), req.user));
});

module.exports = router;
