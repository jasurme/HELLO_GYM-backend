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
  minji: 'minji.kim@binaryfit.test', // active Premium, 8 PT / month
  joonho: 'joonho.lee@binaryfit.test', // expired
  sara: 'sara.ahmed@binaryfit.test',   // unpaid
  taeyang: 'taeyang.seo@binaryfit.test', // Basic, no PT
  ethan: 'ethan.brooks@binaryfit.test',  // frozen
};

async function loginAs(email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login as ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

let counter = 0;
const uniqueEmail = (prefix = 'test') => `${prefix}.${Date.now()}.${++counter}@binaryfit.test`;

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The first given ISO weekday (1 = Mon … 7 = Sun) at least `minDaysAhead` days from today.
function futureWeekday(isoDay, minDaysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + minDaysAhead);
  while (((d.getDay() + 6) % 7) + 1 !== isoDay) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

// A new member with a paid subscription (default PT Quarterly, 4 PT / month),
// created through the admin API. Returns the member's id and a logged-in agent.
async function memberWithPlan(admin, { planId = 4, firstName = 'Test' } = {}) {
  const email = uniqueEmail('member');
  const created = await admin.post('/api/admin/members').send({
    email, password: PASSWORD, firstName, lastName: 'Member',
  });
  if (created.status !== 201) throw new Error(`Create member failed: ${JSON.stringify(created.body)}`);
  const memberId = created.body.userId;
  const plans = await admin.get('/api/admin/plans');
  const plan = plans.body.find((p) => p.planId === planId);
  const sub = await admin.post('/api/admin/subscriptions').send({
    memberId, planId, payment: { amountKrw: plan.priceKrw, method: 'card' },
  });
  if (sub.status !== 201) throw new Error(`Sell plan failed: ${JSON.stringify(sub.body)}`);
  return { memberId, email, subscription: sub.body, agent: await loginAs(email) };
}

afterAll(() => sequelize.close());

module.exports = { app, request, sequelize, SEED, PASSWORD, loginAs, uniqueEmail, futureWeekday, isoDate, memberWithPlan };
