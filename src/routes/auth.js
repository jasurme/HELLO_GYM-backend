const express = require('express');
const rateLimit = require('express-rate-limit');
const users = require('../services/users');
const { requireAuth } = require('../middleware/auth');
const { badRequest, unauthorized, forbidden } = require('../lib/http-error');
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

const registerSchema = v.z.object({
  email: v.email,
  password: v.password,
  firstName: v.name,
  lastName: v.name,
  phone: v.phone,
  dateOfBirth: v.optionalDate,
});

router.post('/register', loginLimiter, async (req, res) => {
  const data = v.validate(registerSchema, req.body);
  const userId = await users.createUser({
    role: 'member', ...data, profile: { dateOfBirth: data.dateOfBirth },
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
  for (const key of ['firstName', 'lastName', 'phone']) if (key in req.body) account[key] = data[key];
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
