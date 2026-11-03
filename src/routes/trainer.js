const express = require('express');
const { requireRole } = require('../middleware/auth');
const availability = require('../services/availability');
const bookings = require('../services/bookings');
const { select, selectOne } = require('../lib/sql');
const v = require('../lib/validate');

// Every query below is scoped to the logged-in trainer (R7).
const router = express.Router();
router.use(requireRole('trainer'));

const me = (req) => req.user.userId;

router.get('/overview', async (req, res) => {
  const trainerId = me(req);
  const [today, toMark, stats, hours] = await Promise.all([
    select(
      `SELECT * FROM v_trainer_schedule
       WHERE trainer_id = :trainerId AND status <> 'cancelled'
         AND starts_at >= CURDATE() AND starts_at < CURDATE() + INTERVAL 1 DAY
       ORDER BY starts_at`,
      { trainerId },
    ),
    bookings.listBookings({ trainerId, scope: 'to_mark' }),
    selectOne(
      `SELECT
         COALESCE(SUM(status = 'booked' AND starts_at >= NOW() AND starts_at < CURDATE() + INTERVAL 7 DAY), 0) AS next_7_days,
         COALESCE(SUM(status = 'completed' AND starts_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0)            AS completed_this_month,
         COALESCE(SUM(status = 'no_show'   AND starts_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0)            AS no_shows_this_month,
         COUNT(DISTINCT CASE WHEN status <> 'cancelled' AND starts_at >= CURDATE() - INTERVAL 90 DAY THEN member_id END) AS active_members
       FROM bookings WHERE trainer_id = :trainerId`,
      { trainerId },
    ),
    availability.list(trainerId),
  ]);
  res.json({ today, toMark, stats, hours });
});

// ---- Weekly availability (R11 enforced by triggers) -------------------
const windowSchema = v.z.object({
  dayOfWeek: v.z.coerce.number().int().min(1).max(7),
  startTime: v.time,
  endTime: v.time,
});

router.get('/availability', async (req, res) => {
  res.json(await availability.list(me(req)));
});

router.post('/availability', async (req, res) => {
  res.status(201).json(await availability.add(me(req), v.validate(windowSchema, req.body)));
});

router.put('/availability/:id', async (req, res) => {
  res.json(await availability.update(me(req), v.validate(v.id, req.params.id), v.validate(windowSchema, req.body)));
});

router.delete('/availability/:id', async (req, res) => {
  res.json(await availability.remove(me(req), v.validate(v.id, req.params.id)));
});

// ---- Sessions -----------------------------------------------------------
router.get('/sessions', async (req, res) => {
  const query = v.validate(v.z.object({
    scope: v.z.enum(['upcoming', 'past', 'to_mark']).optional(),
    status: v.z.enum(['booked', 'completed', 'no_show', 'cancelled']).optional(),
    from: v.date.optional(),
    to: v.date.optional(),
  }), req.query);
  res.json(await bookings.listBookings({ ...query, trainerId: me(req) }));
});

const sessionSchema = v.z.object({
  status: v.z.enum(['completed', 'no_show']).optional(),
  trainerNote: v.optionalText(255),
});

router.patch('/sessions/:id', async (req, res) => {
  const data = v.validate(sessionSchema, req.body);
  if (!('trainerNote' in req.body)) delete data.trainerNote;
  res.json(await bookings.updateSession(v.validate(v.id, req.params.id), req.user, data));
});

router.post('/sessions/:id/cancel', async (req, res) => {
  res.json(await bookings.cancelBooking(v.validate(v.id, req.params.id), req.user));
});

// Members this trainer has worked with, with their current membership.
router.get('/members', async (req, res) => {
  res.json(await select(
    `SELECT b.member_id,
            CONCAT(u.first_name, ' ', u.last_name) AS member_name, u.email, u.phone,
            COUNT(*)                                              AS sessions,
            SUM(b.status = 'completed')                           AS completed,
            SUM(b.status = 'no_show')                             AS no_shows,
            MAX(CASE WHEN b.starts_at < NOW() THEN b.starts_at END) AS last_session,
            MIN(CASE WHEN b.starts_at >= NOW() AND b.status = 'booked' THEN b.starts_at END) AS next_session,
            (SELECT CONCAT(v.plan_name, ' (', v.status, ')') FROM v_subscription_status v
              WHERE v.member_id = b.member_id AND v.status IN ('active', 'frozen')
              LIMIT 1)                                            AS membership
     FROM bookings b
     JOIN users u ON u.user_id = b.member_id
     WHERE b.trainer_id = :trainerId AND b.status <> 'cancelled'
     GROUP BY b.member_id, u.first_name, u.last_name, u.email, u.phone
     ORDER BY next_session IS NULL, next_session, last_session DESC`,
    { trainerId: me(req) },
  ));
});

module.exports = router;
