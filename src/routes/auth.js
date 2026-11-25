const express = require('express');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const users = require('../services/users');
const subscriptions = require('../services/subscriptions');
const usernames = require('../services/usernames');
const { requireAuth } = require('../middleware/auth');
const {
  badRequest, unauthorized, forbidden, conflict,
} = require('../lib/http-error');
const v = require('../lib/validate');
const env = require('../config/env');

const router = express.Router();

// Slow down password guessing: 20 attempts per 15 minutes per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

// Starts a fresh session (new id) for the user, preventing session fixation.
function logIn(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.userId;
      return req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

const detailsSchema = v.z.object({
  email: v.email,
  username: v.z.string().trim().min(1, 'Choose a username').max(40),
  password: v.password,
  firstName: v.name,
  lastName: v.name,
  phone: v.phone,
  dateOfBirth: v.optionalDate,
});

async function checkDetails(body) {
  const details = v.validate(detailsSchema, body);
  if (await User.findOne({ where: { email: details.email } })) {
    throw conflict('An account with this email already exists', { fields: { email: 'This email is already registered' } });
  }
  const handle = await usernames.status(details.username);
  if (!handle.available) throw conflict(handle.reason, { fields: { username: handle.reason } });
  return { ...details, username: handle.username };
}

// Live check while typing a username (sign-up and profile settings).
router.get('/username', async (req, res) => {
  const { username } = v.validate(v.z.object({ username: v.z.string().max(60).default('') }), req.query);
  res.json(await usernames.status(username, { exceptUserId: req.user?.userId }));
});

// Sign-up step 1 (details) is checked before the member picks a plan.
router.post('/register/check', loginLimiter, async (req, res) => {
  await checkDetails(req.body);
  res.status(204).end();
});

// Final step: details + plan + online payment. There are no free accounts:
// the account only exists once the membership is paid (one transaction).
router.post('/register', loginLimiter, async (req, res) => {
  const person = await checkDetails(req.body);
  const { planId, simulateFailure } = v.validate(v.z.object({
    planId: v.id,
    card: v.optionalCard,
    simulateFailure: v.z.boolean().optional(),
  }), req.body);
  const userId = await users.createMemberWithPlan({
    person,
    planId,
    charge: () => subscriptions.chargeOnline({ simulateFailure }),
  });
  await logIn(req, { userId });
  res.status(201).json(await users.profile(userId));
});

const loginSchema = v.z.object({
  email: v.z.string().trim().toLowerCase().min(1, 'Required'),
  password: v.z.string().min(1, 'Required'),
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = v.validate(loginSchema, req.body);
  const user = await users.verifyPassword(email, password);
  if (!user) throw unauthorized('Wrong email or password');
  if (!user.isActive) throw forbidden('This account is deactivated. Please contact the front desk.');
  await logIn(req, user);
  res.json(await users.profile(user.userId));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('gym.sid');
    res.status(204).end();
  });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json(await users.profile(req.user.userId));
});

const profileSchema = v.z.object({
  firstName: v.name.optional(),
  lastName: v.name.optional(),
  username: v.z.string().trim().max(40).optional(),
  socialBio: v.optionalText(160),
  phone: v.phone,
  dateOfBirth: v.optionalDate,
  emergencyContactName: v.optionalText(100),
  emergencyContactPhone: v.phone,
  bio: v.optionalText(500),
});

// Everyone edits their own contact details; role-specific fields are ignored
// for roles they do not apply to.
router.patch('/me', requireAuth, async (req, res) => {
  const data = v.validate(profileSchema, req.body);
  const account = {};
  for (const key of ['firstName', 'lastName', 'phone', 'socialBio']) if (key in req.body) account[key] = data[key];
  if (data.username !== undefined) {
    const handle = await usernames.status(data.username, { exceptUserId: req.user.userId });
    if (!handle.available) throw conflict(handle.reason, { fields: { username: handle.reason } });
    account.username = handle.username;
  }
  const profile = {};
  const profileKeys = req.user.role === 'member'
    ? ['dateOfBirth', 'emergencyContactName', 'emergencyContactPhone']
    : req.user.role === 'trainer' ? ['bio'] : [];
  for (const key of profileKeys) if (key in req.body) profile[key] = data[key];
  await users.updateUser(req.user.userId, { account, profile });
  res.json(await users.profile(req.user.userId));
});

const passwordSchema = v.z.object({
  currentPassword: v.z.string().min(1, 'Required'),
  newPassword: v.password,
});

router.post('/password', requireAuth, loginLimiter, async (req, res) => {
  const { currentPassword, newPassword } = v.validate(passwordSchema, req.body);
  if (!(await users.changePassword(req.user.userId, currentPassword, newPassword))) {
    throw badRequest('Your current password is not correct');
  }
  res.status(204).end();
});

module.exports = router;
