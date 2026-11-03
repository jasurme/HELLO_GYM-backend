#!/usr/bin/env node
// Generates db/04_seed.sql: reproducible demo data (fixed random seed) whose
// dates are relative to the day it runs, so dashboards always look current.
// Every row respects the triggers (R1–R12), so loading the file also shows
// that the rules accept a year of realistic gym activity.
//
//   node scripts/generate-seed.js            writes db/04_seed.sql
//   require('./generate-seed').generateSeed() returns { sql, stats }
process.env.TZ = process.env.TZ || 'Asia/Seoul';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { escape } = require('mysql2');

const DEMO_PASSWORD = 'Gym12345!';
const DOMAIN = 'binaryfit.test';
const HISTORY_DAYS = 395;          // how far back the oldest member joined
const BOOKING_HORIZON_DAYS = 21;   // how far ahead members have booked

// ---------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------
const PLANS = [
  { id: 1, name: 'Basic Monthly',     months: 1, price: 70000,   quota: 0, weight: 25, description: 'Gym floor, cardio zone and lockers for one month' },
  { id: 2, name: 'Basic Quarterly',   months: 3, price: 189000,  quota: 0, weight: 20, description: 'Three months of gym access at a lower monthly rate' },
  { id: 3, name: 'PT Monthly',        months: 1, price: 290000,  quota: 4, weight: 25, description: 'Gym access plus 4 personal-training sessions a month' },
  { id: 4, name: 'PT Quarterly',      months: 3, price: 790000,  quota: 4, weight: 20, description: 'Three months of gym access plus 4 PT sessions a month' },
  { id: 5, name: 'Premium Half-Year', months: 6, price: 1590000, quota: 8, weight: 10, description: 'Six months of gym access plus 8 PT sessions a month' },
];

const ADMINS = [
  { first: 'Ji-woo', last: 'Han', email: `admin@${DOMAIN}`, phone: '010-2000-0001' },
  { first: 'Seo-yeon', last: 'Moon', email: `frontdesk@${DOMAIN}`, phone: '010-2000-0002' },
];

// windows: [isoDays, from, to]   (1 = Monday … 7 = Sunday)
const TRAINERS = [
  { first: 'Daniel', last: 'Park', specialization: 'Strength & Conditioning', hiredYearsAgo: 4,
    bio: 'Former national-team powerlifter. Builds safe, progressive strength programs for every level.',
    windows: [[[1, 2, 3, 4, 5], '07:00', '11:00'], [[1, 2, 3, 4, 5], '17:00', '21:00'], [[6], '09:00', '13:00']] },
  { first: 'Soo-ah', last: 'Lee', specialization: 'Yoga & Mobility', hiredYearsAgo: 3,
    bio: 'RYT-500 yoga teacher focused on flexibility, breathing and recovery.',
    windows: [[[1, 3, 5], '08:00', '14:00'], [[2, 4], '15:00', '21:00']] },
  { first: 'Hyun-woo', last: 'Choi', specialization: 'Boxing & HIIT', hiredYearsAgo: 2,
    bio: 'Amateur boxing champion. High-energy conditioning and pad work.',
    windows: [[[2, 3, 4, 5, 6], '12:00', '20:00']] },
  { first: 'Emily', last: 'Jung', specialization: 'Weight Loss & Nutrition', hiredYearsAgo: 2,
    bio: 'Certified nutrition coach combining training plans with sustainable eating habits.',
    windows: [[[1, 2, 3, 4, 5], '09:00', '13:00'], [[1, 2, 3, 4, 5], '18:00', '21:00']] },
  { first: 'Min-jae', last: 'Kang', specialization: 'Rehabilitation & Posture', hiredYearsAgo: 5,
    bio: 'Physical therapist helping members return to training after injury.',
    windows: [[[1, 2, 3, 4], '10:00', '18:00']] },
  { first: 'Ji-hye', last: 'Yoon', specialization: 'Pilates & Core', hiredYearsAgo: 1,
    bio: 'Mat and reformer Pilates instructor with a focus on core stability.',
    windows: [[[3, 4, 5, 6, 7], '09:00', '15:00']] },
];

// Fixed members with a known state, used in the README and the demo.
// currentPlan / startDaysAgo define the member's latest subscription.
const DEMO_MEMBERS = [
  { first: 'Minji', last: 'Kim', joinedDaysAgo: 300, currentPlan: 5, startDaysAgo: 40, engagement: 0.75, favorite: 0,
    story: 'Active Premium member with upcoming sessions' },
  { first: 'Joon-ho', last: 'Lee', joinedDaysAgo: 120, currentPlan: 1, startDaysAgo: 50, engagement: 0.5, favorite: 2,
    story: 'Subscription expired about 20 days ago: cannot book (R1)' },
  { first: 'Sara', last: 'Ahmed', joinedDaysAgo: 0, currentPlan: 3, startDaysAgo: 0, payment: 'pending', engagement: 0.8, favorite: 3,
    story: 'New member, PT Monthly awaiting online payment' },
  { first: 'Tae-yang', last: 'Seo', joinedDaysAgo: 75, currentPlan: 1, startDaysAgo: 10, engagement: 0.5, favorite: 0,
    story: 'Active Basic plan without personal training (R5)' },
  { first: 'Yuna', last: 'Choi', joinedDaysAgo: 200, currentPlan: 3, startDaysAgo: 25, engagement: 0.9, favorite: 1,
    story: 'PT Monthly ending within a week: shows in "Expiring soon"' },
  { first: 'Ethan', last: 'Brooks', joinedDaysAgo: 150, currentPlan: 4, startDaysAgo: 30, engagement: 0.7, favorite: 4,
    freeze: { startDaysAgo: 3, days: 14 }, story: 'PT Quarterly currently frozen (travel)' },
];
const RANDOM_MEMBER_COUNT = 54;

const FAMILY = ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim',
  'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Yoo', 'Hong'];
const GIVEN = ['Seo-yeon', 'Ji-woo', 'Ha-eun', 'Soo-bin', 'Ye-jin', 'Da-eun', 'Eun-ji', 'Hye-won',
  'Ji-min', 'Min-seo', 'Do-yoon', 'Seo-jun', 'Ha-jun', 'Ji-hoon', 'Min-jun', 'Woo-jin',
  'Sung-min', 'Tae-hyun', 'Jae-won', 'Dong-hyun', 'Sang-woo', 'Na-rae', 'Bo-ram', 'Chae-won'];
const INTERNATIONAL = [['Aziz', 'Karimov'], ['Nilufar', 'Rashidova'], ['Liam', 'Walker'], ['Sofia', 'Rossi'],
  ['Arjun', 'Mehta'], ['Mai', 'Nguyen'], ['Lucas', 'Martin'], ['Chloe', 'Dubois'], ['Kenji', 'Tanaka'],
  ['Amara', 'Okafor'], ['Dilnoza', 'Yusupova'], ['Noah', 'Fischer']];

const TRAINER_NOTES = ['Good form on squats, add 2.5 kg next time', 'Worked on hip mobility', 'Great energy today',
  'Increase cardio intervals next session', 'Focus on core stability', 'Shoulder felt better, keep the band work',
  'New personal best on deadlift', 'Reviewed meal plan and weekly goals', 'Technique drills, slow tempo', null, null];
const MEMBER_NOTES = ['Lower back is a bit sore', 'Want to focus on legs', 'Preparing for a 10K run',
  'First session after holidays', 'Please include stretching', null, null, null, null];
const FREEZE_REASONS = ['Business trip', 'Travel abroad', 'Minor injury', 'Exam period', 'Family event'];

// ---------------------------------------------------------------------
// Helpers: deterministic random numbers and local-time dates
// ---------------------------------------------------------------------
function mulberry32(seed) {
  return function next() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRandom(seed) {
  const rnd = mulberry32(seed);
  const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;
  const weighted = (pairs) => {
    const total = pairs.reduce((sum, [, w]) => sum + w, 0);
    let r = rnd() * total;
    for (const [value, w] of pairs) {
      if ((r -= w) < 0) return value;
    }
    return pairs[pairs.length - 1][0];
  };
  return { rnd, int, pick, chance, weighted };
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dt = (d) => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dateOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
const atMinutes = (day, minutes) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
const daysBetween = (a, b) => Math.round((dateOnly(b) - dateOnly(a)) / 86400000);
const isoDow = (d) => ((d.getDay() + 6) % 7) + 1;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);

// Same rule as MySQL's `date + INTERVAL n MONTH`: clamp to the month's last day.
function addMonths(d, n) {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
}

// A subscription bought on `start` for n months ends the day before the same date n months later.
const planEnd = (start, months) => addDays(addMonths(start, months), -1);

const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

// ---------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------
function generateSeed({ now = new Date(), seed = 20261103 } = {}) {
  const R = makeRandom(seed);
  const today = dateOnly(now);
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const horizon = addDays(today, BOOKING_HORIZON_DAYS);

  // Random time of day between two hours, never later than `now`.
  const timeOn = (day, fromHour = 8, toHour = 21) => {
    const t = atMinutes(day, R.int(fromHour * 60, toHour * 60 - 1));
    t.setSeconds(R.int(0, 59));
    return t > now ? new Date(now.getTime() - R.int(1, 3600) * 1000) : t;
  };

  const users = [];
  const emails = new Set();
  const addUser = (u) => {
    let email = u.email || `${slug(u.first)}.${slug(u.last)}@${DOMAIN}`;
    for (let n = 2; emails.has(email); n++) email = `${slug(u.first)}.${slug(u.last)}${n}@${DOMAIN}`;
    emails.add(email);
    const user = { id: users.length + 1, ...u, email };
    users.push(user);
    return user;
  };
  const randomPhone = () => `010-${R.int(2000, 9999)}-${R.int(1000, 9999)}`;

  // --- staff -----------------------------------------------------------
  const admins = ADMINS.map((a) => addUser({ ...a, role: 1, createdAt: timeOn(addDays(today, -HISTORY_DAYS - 30)) }));
  const trainers = TRAINERS.map((t) => {
    const hired = addMonths(today, -12 * t.hiredYearsAgo - R.int(0, 6));
    const user = addUser({ first: t.first, last: t.last, role: 2, phone: randomPhone(), createdAt: timeOn(hired) });
    const windowsByDay = {};
    for (const [days, from, to] of t.windows) {
      for (const d of days) (windowsByDay[d] ||= []).push({ from: toMinutes(from), to: toMinutes(to), fromText: from, toText: to });
    }
    return { ...user, specialization: t.specialization, bio: t.bio, hiredOn: hired, windowsByDay };
  });

  // --- members ---------------------------------------------------------
  const memberSpecs = [...DEMO_MEMBERS.map((m) => ({ ...m, demo: true }))];
  for (let i = 0; i < RANDOM_MEMBER_COUNT; i++) {
    const [first, last] = R.chance(0.25) ? R.pick(INTERNATIONAL) : [R.pick(GIVEN), R.pick(FAMILY)];
    memberSpecs.push({
      first, last,
      joinedDaysAgo: Math.floor(HISTORY_DAYS * Math.sqrt(R.rnd())),
      engagement: 0.4 + R.rnd() * 0.6,
      favorite: R.int(0, trainers.length - 1),
    });
  }
  const members = memberSpecs.map((spec) => {
    const joined = addDays(today, -spec.joinedDaysAgo);
    const user = addUser({ first: spec.first, last: spec.last, role: 3, phone: randomPhone(), createdAt: timeOn(joined) });
    const hasContact = R.chance(0.6);
    return {
      ...user, spec, joined,
      dateOfBirth: new Date(R.int(1968, 2006), R.int(0, 11), R.int(1, 28)),
      emergencyName: hasContact ? `${R.pick(GIVEN)} ${spec.last}` : null,
      emergencyPhone: hasContact ? randomPhone() : null,
      favorite: trainers[spec.favorite],
      engagement: spec.engagement,
    };
  });

  // --- subscriptions, payments, freezes, bookings -----------------------
  const trainerBusy = new Map();   // "trainerId|yyyy-mm-dd" -> [[from, to], ...] in minutes
  const memberBusy = new Map();
  const monthUsage = new Map();    // "memberId|yyyy-mm" -> live sessions that month
  const subscriptions = [];
  let subId = 0;

  const isBusy = (map, key, from, to) => (map.get(key) || []).some(([a, b]) => a < to && b > from);
  const markBusy = (map, key, from, to) => { if (!map.has(key)) map.set(key, []); map.get(key).push([from, to]); };

  const deskAdmin = () => R.pick(admins).id;

  function makePayments(member, sub, mode) {
    const payments = [];
    if (mode === 'none') return payments;
    if (mode === 'pending') {
      payments.push({ amount: sub.price, method: 'online', status: 'pending', paidAt: null,
        createdAt: sub.createdAt, recordedBy: member.id, reference: null });
      return payments;
    }
    const method = R.weighted([['card', 50], ['online', 22], ['cash', 15], ['bank_transfer', 13]]);
    const recordedBy = method === 'online' ? member.id : deskAdmin();
    const firstPaid = addMinutes(sub.createdAt, R.int(1, 25));
    const ref = () => ({ card: 'CARD-', online: 'PG-', cash: 'RCPT-', bank_transfer: 'TRF-' }[method]) + R.int(10000000, 99999999);

    if (method === 'online' && R.chance(0.12)) {
      payments.push({ amount: sub.price, method: 'online', status: 'failed', paidAt: null,
        createdAt: addMinutes(firstPaid, -3), recordedBy: member.id, reference: `PG-${R.int(10000000, 99999999)}` });
    }
    const secondDue = timeOn(addDays(sub.start, 30));
    if (sub.price >= 700000 && R.chance(0.3) && secondDue < now) {
      const half = Math.round(sub.price / 2000) * 1000;
      payments.push({ amount: half, method, status: 'paid', paidAt: firstPaid, createdAt: firstPaid, recordedBy, reference: ref() });
      payments.push({ amount: sub.price - half, method, status: 'paid', paidAt: secondDue, createdAt: secondDue, recordedBy, reference: ref() });
    } else {
      payments.push({ amount: sub.price, method, status: 'paid', paidAt: firstPaid > now ? now : firstPaid,
        createdAt: firstPaid > now ? now : firstPaid, recordedBy, reference: ref() });
    }
    return payments;
  }

  function makeBookings(member, sub, until) {
    const quotaPlan = sub.plan;
    if (quotaPlan.quota === 0) return [];
    const bookings = [];
    const windowEnd = minDate(until, horizon);
    let monthStart = new Date(sub.start.getFullYear(), sub.start.getMonth(), 1);

    while (monthStart <= windowEnd) {
      const from = maxDate(monthStart, sub.start);
      const to = minDate(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0), windowEnd);
      const span = daysBetween(from, to) + 1;
      const monthDays = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
      const usageKey = `${member.id}|${monthKey(monthStart)}`;
      const used = monthUsage.get(usageKey) || 0;
      let target = Math.round(quotaPlan.quota * member.engagement * (span / monthDays) + (R.rnd() - 0.4));
      target = Math.max(0, Math.min(target, quotaPlan.quota - used));

      for (let attempt = 0; target > 0 && attempt < 80; attempt++) {
        const day = addDays(from, R.int(0, span - 1));
        if (sub.freezes.some((f) => day >= f.start && day <= f.end)) continue;
        const trainer = R.chance(0.75) ? member.favorite : R.pick(trainers);
        const windows = trainer.windowsByDay[isoDow(day)];
        if (!windows) continue;
        const w = R.pick(windows);
        const duration = R.weighted([[60, 80], [90, 10], [30, 10]]);
        const slots = (w.to - w.from - duration) / 30;
        if (slots < 0) continue;
        const startMin = w.from + 30 * R.int(0, slots);
        const startsAt = atMinutes(day, startMin);
        const endsAt = atMinutes(day, startMin + duration);
        if (sub.cancelledAt && startsAt >= sub.cancelledAt) continue;
        if (startsAt <= now && endsAt > now) continue; // skip a session in progress right now
        const tKey = `${trainer.id}|${ymd(day)}`;
        const mKey = `${member.id}|${ymd(day)}`;
        if (isBusy(trainerBusy, tKey, startMin, startMin + duration) || isBusy(memberBusy, mKey, startMin, startMin + duration)) continue;

        let status;
        if (endsAt <= now) {
          const hoursAgo = (now - endsAt) / 3600000;
          status = hoursAgo < 48 && R.chance(0.5) ? 'booked' // trainer has not marked it yet
            : R.weighted([['completed', 88], ['no_show', 6], ['cancelled', 6]]);
        } else {
          status = R.chance(0.08) ? 'cancelled' : 'booked';
        }

        let createdAt = addMinutes(startsAt, -R.int(1, 10) * 1440 - R.int(0, 600));
        if (createdAt < sub.createdAt) createdAt = addMinutes(sub.createdAt, R.int(5, 120));
        if (createdAt > now) createdAt = new Date(now.getTime() - R.int(60, 7200) * 1000);
        if (createdAt >= startsAt) createdAt = addMinutes(startsAt, -60);

        let cancelledAt = null;
        if (status === 'cancelled') {
          const latest = minDate(addMinutes(startsAt, -120), now);
          cancelledAt = new Date(createdAt.getTime() + R.rnd() * Math.max(latest - createdAt, 60000));
        }

        bookings.push({
          trainerId: trainer.id, startsAt, endsAt, status, createdAt, cancelledAt,
          cancelledBy: cancelledAt ? member.id : null,
          memberNote: R.pick(MEMBER_NOTES),
          trainerNote: status === 'completed' ? R.pick(TRAINER_NOTES) : null,
        });
        if (status !== 'cancelled') {
          markBusy(trainerBusy, tKey, startMin, startMin + duration);
          markBusy(memberBusy, mKey, startMin, startMin + duration);
          monthUsage.set(usageKey, (monthUsage.get(usageKey) || 0) + 1);
          target--;
        }
      }
      monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    }
    return bookings.sort((a, b) => a.startsAt - b.startsAt);
  }

  function addSubscription(member, { plan, start, createdAt, paymentMode = 'paid', freeze = null, allowCancel = true, allowRandomFreeze = true }) {
    const discounted = R.chance(0.1);
    const sub = {
      id: ++subId, member, plan, start,
      end: planEnd(start, plan.months),
      price: discounted ? Math.round((plan.price * 0.9) / 1000) * 1000 : plan.price,
      createdAt, cancelledAt: null, refund: false, freezes: [],
    };
    sub.createdBy = R.chance(0.3) ? member.id : deskAdmin();
    sub.payments = makePayments(member, sub, paymentMode);
    sub.effectiveEnd = sub.end;

    const fz = freeze || (allowRandomFreeze && plan.months >= 3 && R.chance(0.15)
      ? { start: addDays(start, R.int(15, daysBetween(start, sub.end) - 20)), days: R.int(7, 21) } : null);
    if (fz && paymentMode === 'paid') {
      const f = { start: fz.start, end: addDays(fz.start, fz.days - 1), reason: R.pick(FREEZE_REASONS), createdBy: deskAdmin() };
      f.createdAt = timeOn(addDays(f.start, -R.int(1, 5)));
      sub.freezes.push(f);
      sub.effectiveEnd = addDays(sub.end, fz.days);
    }

    if (allowCancel && paymentMode === 'paid' && start < addDays(today, -10) && R.chance(0.03)) {
      const lastDay = minDate(sub.effectiveEnd, addDays(today, -1));
      sub.cancelledAt = timeOn(addDays(start, R.int(5, Math.max(5, daysBetween(start, lastDay)))));
      sub.refund = R.chance(0.6);
    }

    sub.bookings = paymentMode === 'paid' ? makeBookings(member, sub, sub.effectiveEnd) : [];
    subscriptions.push(sub);
    return sub;
  }

  const pickPlan = (previous) => (previous && R.chance(0.6) ? previous : R.weighted(PLANS.map((p) => [p, p.weight])));

  // Builds consecutive subscriptions from `from` while they end before `limit`.
  function buildHistory(member, from, limit, { open }) {
    let cursor = from;
    let previous = null;
    let createdAt = member.createdAt;
    while (cursor <= today && cursor < limit) {
      let plan = pickPlan(previous);
      if (!open && planEnd(cursor, plan.months) >= limit) plan = PLANS[0];
      if (!open && planEnd(cursor, plan.months) >= limit) break;

      const current = planEnd(cursor, plan.months) >= today;
      const pending = open && current && cursor >= addDays(today, -7) && R.chance(0.12);
      // A freeze pushes the end date back, which could collide with `limit`.
      const sub = addSubscription(member, { plan, start: cursor, createdAt, paymentMode: pending ? 'pending' : 'paid', allowRandomFreeze: open });
      previous = plan;
      if (pending) break;

      if (sub.cancelledAt) {
        if (!R.chance(0.4)) break;
        cursor = addDays(dateOnly(sub.cancelledAt), R.int(10, 40));
      } else if (sub.effectiveEnd >= today) {
        // Current subscription: some members have already renewed for next term.
        if (open && daysBetween(today, sub.effectiveEnd) <= 20 && R.chance(0.35)) {
          const nextStart = addDays(sub.effectiveEnd, 1);
          addSubscription(member, { plan: pickPlan(plan), start: nextStart, createdAt: timeOn(addDays(today, -R.int(0, 5))), allowCancel: false, allowRandomFreeze: false });
        }
        break;
      } else {
        if (!R.chance(open ? 0.8 : 0.9)) {
          if (!open || !R.chance(0.3)) break;           // churned (some come back later)
          cursor = addDays(sub.effectiveEnd, R.int(30, 90));
        } else {
          cursor = addDays(sub.effectiveEnd, R.chance(0.7) ? 1 : R.int(3, 40));
        }
      }
      createdAt = timeOn(addDays(cursor, -R.int(0, 4)));
    }
  }

  for (const member of members) {
    const spec = member.spec;
    if (!spec.demo) {
      buildHistory(member, member.joined, addDays(today, 1), { open: true });
      continue;
    }
    const currentStart = addDays(today, -spec.startDaysAgo);
    if (daysBetween(member.joined, currentStart) > 0) buildHistory(member, member.joined, currentStart, { open: false });
    addSubscription(member, {
      plan: PLANS.find((p) => p.id === spec.currentPlan),
      start: currentStart,
      createdAt: spec.startDaysAgo === 0 ? new Date(now.getTime() - 20 * 60000) : timeOn(currentStart),
      paymentMode: spec.payment || 'paid',
      freeze: spec.freeze ? { start: addDays(today, -spec.freeze.startDaysAgo), days: spec.freeze.days } : null,
      allowCancel: false,
      allowRandomFreeze: false,
    });
  }

  // Two long-gone members get deactivated (after their history is loaded).
  const deactivated = members.filter((m) => !m.spec.demo
    && subscriptions.filter((s) => s.member === m).every((s) => s.effectiveEnd < addDays(today, -120))).slice(0, 2);

  // ---------------------------------------------------------------------
  // SQL output
  // ---------------------------------------------------------------------
  const v = (value) => {
    if (value === null || value === undefined) return 'NULL';
    if (value instanceof Date) return escape(dt(value));
    return escape(value);
  };
  const d = (value) => (value ? escape(ymd(value)) : 'NULL');
  const rows = (list) => list.map((cols) => `  (${cols.join(', ')})`).join(',\n');
  const out = [];

  out.push(`-- =====================================================================
--  Seed data, generated by scripts/generate-seed.js on ${dt(now)}.
--  Do not edit by hand: run \`npm run db:reset\` to regenerate and reload.
--  All demo accounts use the password: ${DEMO_PASSWORD}
-- =====================================================================
SET NAMES utf8mb4;
`);

  out.push(`INSERT INTO users (user_id, role_id, email, password_hash, first_name, last_name, phone, is_active, created_at, updated_at) VALUES
${rows(users.map((u) => [u.id, u.role, v(u.email), v(passwordHash), v(u.first), v(u.last), v(u.phone), 1, v(u.createdAt), v(u.createdAt)]))};
`);

  out.push(`INSERT INTO trainers (trainer_id, specialization, bio, hired_on) VALUES
${rows(trainers.map((t) => [t.id, v(t.specialization), v(t.bio), d(t.hiredOn)]))};
`);

  out.push(`INSERT INTO members (member_id, date_of_birth, emergency_contact_name, emergency_contact_phone, joined_on) VALUES
${rows(members.map((m) => [m.id, d(m.dateOfBirth), v(m.emergencyName), v(m.emergencyPhone), d(m.joined)]))};
`);

  out.push(`INSERT INTO membership_plans (plan_id, plan_name, description, duration_months, price_krw, sessions_per_month, is_active, created_at) VALUES
${rows(PLANS.map((p) => [p.id, v(p.name), v(p.description), p.months, p.price, p.quota, 1, v(addDays(today, -HISTORY_DAYS - 30))]))};
`);

  const availability = [];
  for (const t of trainers) {
    for (const [day, windows] of Object.entries(t.windowsByDay)) {
      for (const w of windows) availability.push([t.id, Number(day), v(`${w.fromText}:00`), v(`${w.toText}:00`)]);
    }
  }
  out.push(`INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time) VALUES
${rows(availability)};
`);

  // Per member, in time order: subscription → payments → freezes → bookings,
  // then cancellations and refunds, which is the order the triggers need.
  let paymentCount = 0;
  let bookingCount = 0;
  for (const member of members) {
    const subs = subscriptions.filter((s) => s.member === member).sort((a, b) => a.start - b.start);
    if (!subs.length) continue;
    out.push(`-- ${member.first} ${member.last} <${member.email}>${member.spec.story ? `: ${member.spec.story}` : ''}`);
    for (const s of subs) {
      out.push(`INSERT INTO subscriptions (subscription_id, member_id, plan_id, start_date, end_date, price_krw, created_by, created_at) VALUES (${[s.id, member.id, s.plan.id, d(s.start), d(s.end), s.price, s.createdBy, v(s.createdAt)].join(', ')});`);
      if (s.payments.length) {
        paymentCount += s.payments.length;
        out.push(`INSERT INTO payments (subscription_id, amount_krw, method, status, paid_at, reference, recorded_by, created_at) VALUES
${rows(s.payments.map((p) => [s.id, p.amount, v(p.method), v(p.status), v(p.paidAt), v(p.reference), p.recordedBy, v(p.createdAt)]))};`);
      }
      for (const f of s.freezes) {
        out.push(`INSERT INTO subscription_freezes (subscription_id, freeze_start, freeze_end, reason, created_by, created_at) VALUES (${[s.id, d(f.start), d(f.end), v(f.reason), f.createdBy, v(f.createdAt)].join(', ')});`);
      }
      if (s.bookings.length) {
        bookingCount += s.bookings.length;
        out.push(`INSERT INTO bookings (member_id, trainer_id, starts_at, ends_at, status, member_note, trainer_note, cancelled_at, cancelled_by, created_at) VALUES
${rows(s.bookings.map((b) => [member.id, b.trainerId, v(b.startsAt), v(b.endsAt), v(b.status), v(b.memberNote), v(b.trainerNote), v(b.cancelledAt), b.cancelledBy ?? 'NULL', v(b.createdAt)]))};`);
      }
      if (s.cancelledAt) {
        out.push(`UPDATE subscriptions SET cancelled_at = ${v(s.cancelledAt)} WHERE subscription_id = ${s.id};`);
        if (s.refund) {
          out.push(`UPDATE payments SET status = 'refunded' WHERE subscription_id = ${s.id} AND status = 'paid' ORDER BY paid_at DESC LIMIT 1;`);
        }
      }
    }
    out.push('');
  }

  if (deactivated.length) {
    out.push(`-- Members who left more than four months ago: accounts deactivated
UPDATE users SET is_active = FALSE WHERE user_id IN (${deactivated.map((m) => m.id).join(', ')});
`);
  }

  const stats = {
    users: users.length,
    admins: admins.length,
    trainers: trainers.length,
    members: members.length,
    plans: PLANS.length,
    availabilityWindows: availability.length,
    subscriptions: subscriptions.length,
    payments: paymentCount,
    freezes: subscriptions.reduce((n, s) => n + s.freezes.length, 0),
    bookings: bookingCount,
  };
  return {
    sql: out.join('\n'),
    stats,
    demoAccounts: {
      password: DEMO_PASSWORD,
      admin: admins[0].email,
      trainer: trainers[0].email,
      members: members.filter((m) => m.spec.demo).map((m) => ({ email: m.email, story: m.spec.story })),
    },
  };
}

if (require.main === module) {
  const { sql, stats } = generateSeed();
  const file = path.join(__dirname, '..', 'db', '04_seed.sql');
  fs.writeFileSync(file, sql);
  console.log(`Wrote ${path.relative(process.cwd(), file)}`, stats);
}

module.exports = { generateSeed, DEMO_PASSWORD, PLANS };
