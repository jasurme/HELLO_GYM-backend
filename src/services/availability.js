const { TrainerAvailability } = require('../models');
const { selectOne } = require('../lib/sql');
const { badRequest, notFound } = require('../lib/http-error');

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function checkWindow({ startTime, endTime }) {
  if (!/:(00|30)$/.test(startTime) || !/:(00|30)$/.test(endTime)) throw badRequest('Times must be on the hour or half hour');
  if (endTime <= startTime) throw badRequest('End time must be after start time');
}

const shape = (w) => ({
  availabilityId: w.availabilityId,
  dayOfWeek: w.dayOfWeek,
  dayName: DAY_NAMES[w.dayOfWeek],
  startTime: w.startTime.slice(0, 5),
  endTime: w.endTime.slice(0, 5),
});

async function list(trainerId) {
  const rows = await TrainerAvailability.findAll({
    where: { trainerId }, order: [['dayOfWeek', 'ASC'], ['startTime', 'ASC']], raw: true,
  });
  return rows.map(shape);
}

// R11 (no overlapping windows) is enforced by trg_availability_bi/bu.
async function add(trainerId, window) {
  checkWindow(window);
  const row = await TrainerAvailability.create({ trainerId, ...window });
  return shape(row.get({ plain: true }));
}

async function update(trainerId, availabilityId, window) {
  checkWindow(window);
  const row = await TrainerAvailability.findOne({ where: { trainerId, availabilityId } });
  if (!row) throw notFound('Availability window');
  await row.update(window);
  return shape(row.get({ plain: true }));
}

// Booked sessions are kept when a window is removed; the response says how
// many upcoming ones fell inside it so the trainer can follow up.
async function remove(trainerId, availabilityId) {
  const row = await TrainerAvailability.findOne({ where: { trainerId, availabilityId } });
  if (!row) throw notFound('Availability window');
  const affected = await selectOne(
    `SELECT COUNT(*) AS n FROM bookings
     WHERE trainer_id = :trainerId AND status = 'booked' AND starts_at > NOW()
       AND WEEKDAY(starts_at) + 1 = :day AND TIME(starts_at) >= :start AND TIME(ends_at) <= :end`,
    { trainerId, day: row.dayOfWeek, start: row.startTime, end: row.endTime },
  );
  await row.destroy();
  return { upcomingSessionsInWindow: affected.n };
}

module.exports = { DAY_NAMES, list, add, update, remove };
