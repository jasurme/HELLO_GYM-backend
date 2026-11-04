const { Op } = require('sequelize');
const { User } = require('../models');

// Same rule as ck_users_username: 3–30 lowercase letters, digits, '.' or '_',
// starting and ending with a letter or digit, no '..'.
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;
// Handles that would look official or clash with app paths.
const RESERVED = new Set(['admin', 'administrator', 'binaryfit', 'support', 'help', 'staff', 'trainer',
  'member', 'social', 'explore', 'settings', 'login', 'register', 'api', 'null', 'undefined']);

const normalize = (value) => String(value || '').trim().toLowerCase().replace(/^@/, '');

function problem(username) {
  if (username.length < 3) return 'Use at least 3 characters';
  if (username.length > 30) return 'Use at most 30 characters';
  if (/[^a-z0-9._]/.test(username)) return 'Only letters, numbers, periods and underscores';
  if (!/^[a-z0-9]/.test(username) || !/[a-z0-9]$/.test(username)) return 'Start and end with a letter or number';
  if (username.includes('..')) return 'No two periods in a row';
  if (!USERNAME_RE.test(username)) return 'This username is not allowed';
  return null;
}

// Free candidates near a taken name, the way Instagram offers alternatives.
async function alternatives(base, { transaction } = {}) {
  const stem = base.replace(/[._]+$/, '').slice(0, 24) || 'member';
  const candidates = [...new Set([
    `${stem}_fit`, `${stem}.fit`, `${stem}${new Date().getFullYear() % 100}`,
    ...[1, 2, 3, 7, 11, 21].map((n) => `${stem}${n}`), `the.${stem}`, `${stem}_gym`,
  ])].filter((c) => !problem(c) && !RESERVED.has(c));
  const taken = await User.findAll({ where: { username: { [Op.in]: candidates } }, attributes: ['username'], raw: true, transaction });
  const used = new Set(taken.map((t) => t.username));
  return candidates.filter((c) => !used.has(c)).slice(0, 3);
}

// { username, valid, available, reason, suggestions } for the live check.
async function status(value, { exceptUserId } = {}) {
  const username = normalize(value);
  const reason = problem(username) || (RESERVED.has(username) ? 'This username is reserved' : null);
  if (reason) return { username, valid: false, available: false, reason, suggestions: [] };
  const owner = await User.findOne({ where: { username }, attributes: ['userId'], raw: true });
  if (!owner || owner.userId === exceptUserId) return { username, valid: true, available: true, reason: null, suggestions: [] };
  return { username, valid: true, available: false, reason: 'That username is taken', suggestions: await alternatives(username) };
}

// first.last (+ a number if needed) for accounts the front desk creates.
async function generate(firstName, lastName, { transaction } = {}) {
  const part = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  let base = [part(firstName), part(lastName)].filter(Boolean).join('.').slice(0, 26);
  if (base.length < 3) base = `member.${base}`.replace(/\.$/, '');
  for (let n = 0; n < 1000; n++) {
    const candidate = n ? `${base}${n + 1}` : base;
    if (RESERVED.has(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (!(await User.findOne({ where: { username: candidate }, attributes: ['userId'], transaction }))) return candidate;
  }
  throw new Error('Could not generate a username');
}

module.exports = { USERNAME_RE, normalize, status, generate };
