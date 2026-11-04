const { Transaction } = require('sequelize');
const {
  sequelize, User, Member, Trainer, TrainerAvailability, Booking, Payment, TrainerSchedule,
} = require('../models');
const { select, selectOne } = require('../lib/sql');
const time = require('../lib/time');
const { badRequest, conflict, notFound } = require('../lib/http-error');
const {
  SESSION_LENGTHS, BOOKING_LEAD_MINUTES, BOOKING_MAX_DAYS_AHEAD, MEMBER_CANCEL_NOTICE_HOURS,
} = require('../config/rules');

// Same rule as trg_bookings_bi (R5): hourly rate × length, rounded to 1,000 won.
const sessionPrice = (hourlyRateKrw, minutes) => Math.round((hourlyRateKrw * minutes) / 60 / 1000) * 1000;

// App-side check of R1 for a session date, with a message that tells the
// member what to do. The trigger re-checks on insert.
async function getEligibility(memberId, date, { transaction } = {}) {
  const sub = await selectOne(
    `SELECT s.subscription_id, s.start_date, s.end_date, s.price_krw, mp.plan_name,
            (SELECT COALESCE(SUM(p.amount_krw), 0) FROM payments p
              WHERE p.subscription_id = s.subscription_id AND p.status = 'paid') AS paid_krw,
            (SELECT MIN(f.freeze_start) FROM subscription_freezes f
              WHERE f.subscription_id = s.subscription_id AND :date BETWEEN f.freeze_start AND f.freeze_end) AS freeze_start,
            (SELECT MIN(f.freeze_end) FROM subscription_freezes f
              WHERE f.subscription_id = s.subscription_id AND :date BETWEEN f.freeze_start AND f.freeze_end) AS freeze_end
     FROM subscriptions s
     JOIN membership_plans mp ON mp.plan_id = s.plan_id
     WHERE s.member_id = :memberId AND s.cancelled_at IS NULL
       AND :date BETWEEN s.start_date AND s.end_date
     LIMIT 1`,
    { memberId, date }, { transaction },
  );

  const base = { eligible: false, subscription: sub };
  if (!sub) {
    const last = await selectOne(
      `SELECT MAX(end_date) AS end_date FROM subscriptions
       WHERE member_id = :memberId AND cancelled_at IS NULL AND end_date < :date`,
      { memberId, date }, { transaction },
    );
    const reason = last?.endDate
      ? `Your membership ends on ${last.endDate}. Renew it to book sessions after that date.`
      : 'You need an active membership to book a trainer.';
    return { ...base, rule: 'R1', reason };
  }
  if (sub.paidKrw < sub.priceKrw) {
    return { ...base, rule: 'R1', reason: `Your ${sub.planName} membership is not fully paid yet.` };
  }
  if (sub.freezeStart) {
    return { ...base, rule: 'R1', reason: `Your membership is frozen from ${sub.freezeStart} to ${sub.freezeEnd}.` };
  }
  return { ...base, eligible: true, rule: null, reason: null };
}

// Bookable start times for one trainer on one day, every 30 minutes inside
// their weekly windows (R4), marking slots taken by the trainer (R2) or the
// member (R3), and slots outside the booking-ahead policy.
async function findSlots({ trainerId, date, duration = 60, memberId }) {
  if (!SESSION_LENGTHS.includes(duration)) throw badRequest('Sessions last 30, 60 or 90 minutes');
  const day = time.parseLocal(date);
  if (!day) throw badRequest('Use the format YYYY-MM-DD');

  const trainer = await Trainer.findByPk(trainerId, { include: [{ model: User, attributes: ['firstName', 'lastName', 'isActive'] }] });
  if (!trainer || !trainer.User.isActive) throw notFound('Trainer');

  const [windows, busy] = await Promise.all([
    TrainerAvailability.findAll({ where: { trainerId, dayOfWeek: time.isoWeekday(day) }, order: [['startTime', 'ASC']], raw: true }),
    select(
      `SELECT trainer_id, member_id, TIME_FORMAT(starts_at, '%H:%i') AS start_time, TIME_FORMAT(ends_at, '%H:%i') AS end_time
       FROM bookings
       WHERE status <> 'cancelled' AND starts_at >= :date AND starts_at < :date + INTERVAL 1 DAY
         AND (trainer_id = :trainerId OR member_id = :memberId)`,
      { date, trainerId, memberId: memberId || 0 },
    ),
  ]);

  const earliest = time.addMinutes(new Date(), BOOKING_LEAD_MINUTES);
  const latest = time.addDays(new Date(), BOOKING_MAX_DAYS_AHEAD);
  const overlaps = (rows, from, to) => rows.some((b) => time.toMinutes(b.startTime) < to && time.toMinutes(b.endTime) > from);
  const trainerBusy = busy.filter((b) => b.trainerId === trainerId);
  const memberBusy = busy.filter((b) => b.memberId === memberId);

  const slots = [];
  for (const w of windows) {
    for (let m = time.toMinutes(w.startTime); m + duration <= time.toMinutes(w.endTime); m += 30) {
      const startsAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
      let reason = null;
      if (startsAt < earliest) reason = 'too_soon';
      else if (startsAt > latest) reason = 'too_far';
      else if (overlaps(trainerBusy, m, m + duration)) reason = 'taken';
      else if (memberId && overlaps(memberBusy, m, m + duration)) reason = 'you_are_busy';
      slots.push({ time: time.fromMinutes(m), endTime: time.fromMinutes(m + duration), available: !reason, reason });
    }
  }

  return {
    date,
    duration,
    priceKrw: sessionPrice(trainer.hourlyRateKrw, duration),
    trainer: {
      trainerId,
      name: `${trainer.User.firstName} ${trainer.User.lastName}`,
      specialization: trainer.specialization,
      hourlyRateKrw: trainer.hourlyRateKrw,
    },
    windows: windows.map((w) => ({ startTime: w.startTime.slice(0, 5), endTime: w.endTime.slice(0, 5) })),
    slots,
    eligibility: memberId ? await getEligibility(memberId, date) : null,
  };
}

// Books a session and takes its payment in one transaction. `charge()` runs
// last and returns the payment fields (online gateway or desk); if it throws
// (a declined card), the booking is rolled back too.
async function createBooking({ memberId, trainerId, startsAt, duration, memberNote = null, enforcePolicy = true, charge, recordedBy }) {
  if (!SESSION_LENGTHS.includes(duration)) throw badRequest('Sessions last 30, 60 or 90 minutes');
  const start = time.parseLocal(startsAt);
  if (!start) throw badRequest('Use the format YYYY-MM-DD HH:mm');
  if (start.getMinutes() % 30 !== 0 || start.getSeconds() !== 0) throw badRequest('Sessions start on the hour or half hour');
  const end = time.addMinutes(start, duration);

  if (start <= new Date()) throw conflict('That time has already passed');
  if (enforcePolicy) {
    if (start < time.addMinutes(new Date(), BOOKING_LEAD_MINUTES)) {
      throw conflict(`Sessions must be booked at least ${BOOKING_LEAD_MINUTES} minutes ahead`);
    }
    if (start > time.addDays(new Date(), BOOKING_MAX_DAYS_AHEAD)) {
      throw conflict(`Sessions can be booked up to ${BOOKING_MAX_DAYS_AHEAD} days ahead`);
    }
  }

  // READ COMMITTED so every check sees the latest committed bookings.
  const bookingId = await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
    // Lock the trainer row, then the member row (always in this order, so
    // no deadlocks). Concurrent bookings for the same trainer or member wait
    // here, and the trigger's overlap check (R2/R3) then sees the other one.
    const trainer = await Trainer.findByPk(trainerId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!trainer) throw notFound('Trainer');
    const member = await Member.findByPk(memberId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!member) throw notFound('Member');

    const eligibility = await getEligibility(memberId, time.formatDate(start), { transaction });
    if (!eligibility.eligible) throw conflict(eligibility.reason, { rule: eligibility.rule });

    // No price given: trg_bookings_bi prices it from the trainer's rate (R5).
    const booking = await Booking.create({
      memberId,
      trainerId,
      startsAt: time.formatDateTime(start),
      endsAt: time.formatDateTime(end),
      memberNote,
    }, { transaction });
    await booking.reload({ transaction });
    if (booking.priceKrw > 0) {
      await Payment.create({ bookingId: booking.bookingId, amountKrw: booking.priceKrw, recordedBy, ...charge() }, { transaction });
    }
    return booking.bookingId;
  });

  return TrainerSchedule.findByPk(bookingId, { raw: true });
}

// actor = { userId, role }. Members and trainers may only touch their own sessions.
async function findOwnBooking(bookingId, actor) {
  const booking = await Booking.findByPk(bookingId);
  const owns = booking && (actor.role === 'admin'
    || (actor.role === 'member' && booking.memberId === actor.userId)
    || (actor.role === 'trainer' && booking.trainerId === actor.userId));
  if (!owns) throw notFound('Session');
  return booking;
}

async function cancelBooking(bookingId, actor) {
  const booking = await findOwnBooking(bookingId, actor);
  if (booking.status !== 'booked') throw conflict('Only booked sessions can be cancelled', { rule: 'R8' });
  const start = time.parseLocal(booking.startsAt);
  if (start <= new Date()) throw conflict('This session has already started', { rule: 'R8' });
  if (actor.role === 'member' && start - new Date() < MEMBER_CANCEL_NOTICE_HOURS * 3600000) {
    throw conflict(`Sessions can be cancelled online up to ${MEMBER_CANCEL_NOTICE_HOURS} hours before they start. Please call the front desk.`, { rule: 'R8' });
  }
  // Triggers stamp cancelled_at and refund the session's payment (R5).
  await booking.update({ status: 'cancelled', cancelledBy: actor.userId });
  return TrainerSchedule.findByPk(bookingId, { raw: true });
}

// Trainer marks a session completed / no-show and/or writes a note.
async function updateSession(bookingId, actor, { status, trainerNote }) {
  const booking = await findOwnBooking(bookingId, actor);
  const changes = {};
  if (status && status !== booking.status) changes.status = status; // R8 checked by trg_bookings_bu
  if (trainerNote !== undefined) changes.trainerNote = trainerNote;
  if (Object.keys(changes).length) await booking.update(changes);
  return TrainerSchedule.findByPk(bookingId, { raw: true });
}

async function listBookings({ memberId, trainerId, status, from, to, scope, search, limit = 500 } = {}) {
  const where = [];
  const params = {};
  if (memberId) { where.push('member_id = :memberId'); params.memberId = memberId; }
  if (trainerId) { where.push('trainer_id = :trainerId'); params.trainerId = trainerId; }
  if (status) { where.push('status = :status'); params.status = status; }
  if (from) { where.push('starts_at >= :from'); params.from = from; }
  if (to) { where.push('starts_at < :to + INTERVAL 1 DAY'); params.to = to; }
  if (scope === 'upcoming') where.push("starts_at >= NOW() AND status = 'booked'");
  if (scope === 'past') where.push("(starts_at < NOW() OR status <> 'booked')");
  if (scope === 'to_mark') where.push("starts_at < NOW() AND status = 'booked'");
  if (search) {
    where.push('(member_name LIKE :search OR trainer_name LIKE :search OR member_email LIKE :search)');
    params.search = `%${search}%`;
  }
  const order = scope === 'upcoming' || scope === 'to_mark' ? 'ASC' : 'DESC';
  return select(
    `SELECT * FROM v_trainer_schedule ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY starts_at ${order} LIMIT ${Number(limit)}`,
    params,
  );
}

module.exports = { sessionPrice, getEligibility, findSlots, createBooking, cancelBooking, updateSession, listBookings };
