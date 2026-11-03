const express = require('express');
const { requireRole } = require('../middleware/auth');
const reports = require('../services/reports');
const time = require('../lib/time');
const v = require('../lib/validate');

// Management reports (admin only); the SQL lives in db/05_reports.sql.
const router = express.Router();
router.use(requireRole('admin'));

router.get('/summary', async (req, res) => {
  res.json(await reports.summary());
});

router.get('/active-memberships', async (req, res) => {
  res.json(await reports.activeMemberships());
});

router.get('/revenue', async (req, res) => {
  res.json(await reports.revenue());
});

router.get('/trainers', async (req, res) => {
  const defaults = { from: time.formatDate(time.addDays(new Date(), -30)), to: time.today() };
  const { from, to } = v.validate(v.z.object({ from: v.date.optional(), to: v.date.optional() }), req.query);
  res.json(await reports.trainerBookings({ from: from || defaults.from, to: to || defaults.to }));
});

router.get('/expiring', async (req, res) => {
  res.json(await reports.expiring());
});

module.exports = router;
