process.env.NODE_ENV = 'test';

const request = require('supertest');
const { createApp } = require('../src/app');
const { sequelize } = require('../src/models');

const app = createApp();
const PASSWORD = 'Gym12345!';

// Seeded accounts (see scripts/generate-seed.js)
const SEED = {
  admin: 'admin@binaryfit.test',
  trainer: 'daniel.park@binaryfit.test',
  trainerId: 3,
  otherTrainerId: 6,               // Emily Jung, Mon–Fri 09–13 & 18–21
  minji: 'minji.kim@binaryfit.test',     // active 6 Months, trains with Daniel
  joonho: 'joonho.lee@binaryfit.test',   // expired
  sara: 'sara.ahmed@binaryfit.test',     // joined and paid today
  taeyang: 'taeyang.seo@binaryfit.test', // active; queued renewal awaiting bank transfer
  ethan: 'ethan.brooks@binaryfit.test',  // frozen
};
// A well-formed card for the demo gateway, which checks the format only.
const CARD = { number: '4242 4242 4242 4242', expiry: `12/${(new Date().getFullYear() + 2) % 100}`, cvc: '123' };
// Gym-access plans (see scripts/generate-seed.js) and trainer rates
const PLANS = { month: 1, quarter: 2, half: 3, year: 4 };
const RATES = { 3: 60000, 6: 50000 };

async function loginAs(email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login as ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

let counter = 0;
const uniqueEmail = (prefix = 'test') => `${prefix}.${Date.now()}.${++counter}@binaryfit.test`;
// A free @username: letters and digits only, at most 30 characters.
const uniqueUsername = (prefix = 'user') => `${prefix}${Date.now().toString(36)}${++counter}`.slice(0, 30);

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The first given ISO weekday (1 = Mon … 7 = Sun) at least `minDaysAhead` days from today.
function futureWeekday(isoDay, minDaysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + minDaysAhead);
  while (((d.getDay() + 6) % 7) + 1 !== isoDay) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

// A new member enrolled at the desk with a paid membership starting today
// (default 3 Months). Returns the member's id, the subscription and a
// logged-in agent.
async function memberWithPlan(admin, { planId = PLANS.quarter, firstName = 'Test' } = {}) {
  const email = uniqueEmail('member');
  const created = await admin.post('/api/admin/members').send({
    email, password: PASSWORD, firstName, lastName: 'Member', planId, payment: { method: 'card' },
  });
  if (created.status !== 201) throw new Error(`Create member failed: ${JSON.stringify(created.body)}`);
  const memberId = created.body.userId;
  const detail = await admin.get(`/api/admin/members/${memberId}`);
  return { memberId, email, subscription: detail.body.subscriptions[0], agent: await loginAs(email) };
}

afterAll(() => sequelize.close());

module.exports = {
  app, request, sequelize, SEED, PLANS, RATES, PASSWORD, CARD, loginAs, uniqueEmail, uniqueUsername, futureWeekday, isoDate, memberWithPlan,
};
