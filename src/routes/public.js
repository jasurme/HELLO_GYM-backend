const express = require('express');
const { Plan } = require('../models');
const { select } = require('../lib/sql');
const { DAY_NAMES } = require('../services/availability');

const router = express.Router();

// Plans currently on sale (landing page, sign-up, renewal).
router.get('/plans', async (req, res) => {
  const plans = await Plan.findAll({
    where: { isActive: true },
    attributes: ['planId', 'planName', 'description', 'durationMonths', 'priceKrw', 'sessionsPerMonth'],
    order: [['priceKrw', 'ASC']],
  });
  res.json(plans);
});

// Active trainers with their weekly hours.
router.get('/trainers', async (req, res) => {
  const rows = await select(
    `SELECT t.trainer_id, u.first_name, u.last_name, t.specialization, t.bio,
            a.day_of_week, TIME_FORMAT(a.start_time, '%H:%i') AS start_time, TIME_FORMAT(a.end_time, '%H:%i') AS end_time
     FROM trainers t
     JOIN users u ON u.user_id = t.trainer_id AND u.is_active
     LEFT JOIN trainer_availability a ON a.trainer_id = t.trainer_id
     ORDER BY u.first_name, u.last_name, a.day_of_week, a.start_time`,
  );
  const trainers = new Map();
  for (const r of rows) {
    if (!trainers.has(r.trainerId)) {
      trainers.set(r.trainerId, {
        trainerId: r.trainerId,
        name: `${r.firstName} ${r.lastName}`,
        specialization: r.specialization,
        bio: r.bio,
        hours: [],
      });
    }
    if (r.dayOfWeek) {
      trainers.get(r.trainerId).hours.push({
        dayOfWeek: r.dayOfWeek, dayName: DAY_NAMES[r.dayOfWeek], startTime: r.startTime, endTime: r.endTime,
      });
    }
  }
  res.json([...trainers.values()]);
});

module.exports = router;
