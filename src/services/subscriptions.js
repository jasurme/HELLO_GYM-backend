const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize, Plan, Subscription, SubscriptionFreeze, Payment, SubscriptionStatus,
} = require('../models');
const { select, selectOne } = require('../lib/sql');
const time = require('../lib/time');
const { badRequest, conflict, notFound } = require('../lib/http-error');
const { MAX_FREEZE_DAYS, RENEWAL_WINDOW_DAYS } = require('../config/rules');

const LIVE_STATUSES = ['active', 'frozen', 'pending_payment', 'upcoming'];

// A plan bought on `start` for n months ends the day before the same date n months later.
const endDateFor = (startDate, months) => time.formatDate(time.addDays(time.addMonths(time.parseLocal(startDate), months), -1));

// The subscription that covers today (if any) and the next one queued after it.
async function memberSubscriptions(memberId) {
  const live = await SubscriptionStatus.findAll({
    where: { memberId, status: LIVE_STATUSES },
    order: [['startDate', 'ASC']],
    raw: true,
  });
  const today = time.today();
  const current = live.find((s) => s.startDate <= today && s.endDate >= today) || null;
  const next = live.find((s) => s !== current) || null;
  return { current, next };
}

// The day after the member's last non-cancelled subscription ends, or today.
async function nextStartDate(memberId, { transaction } = {}) {
  const row = await selectOne(
    `SELECT MAX(end_date) AS last_end FROM subscriptions
     WHERE member_id = :memberId AND cancelled_at IS NULL AND end_date >= CURDATE()`,
    { memberId }, { transaction },
  );
  return row?.lastEnd ? time.formatDate(time.addDays(time.parseLocal(row.lastEnd), 1)) : time.today();
}

async function createSubscription({ memberId, planId, startDate, priceKrw, createdBy, allowInactivePlan = false }, { transaction }) {
  const plan = await Plan.findByPk(planId, { transaction });
  if (!plan) throw notFound('Plan');
  if (!plan.isActive && !allowInactivePlan) throw conflict(`The ${plan.planName} plan is no longer on sale`);
  const start = startDate || (await nextStartDate(memberId, { transaction }));
  return Subscription.create({
    memberId,
    planId,
    startDate: start,
    endDate: endDateFor(start, plan.durationMonths),
    priceKrw: priceKrw ?? plan.priceKrw,
    createdBy,
  }, { transaction });
}

const onlineReference = () => `PG-${crypto.randomInt(10000000, 99999999)}`;

// Member buys or renews a plan online: subscription + pending online payment.
async function purchaseOnline(memberId, planId) {
  return sequelize.transaction(async (transaction) => {
    const live = await SubscriptionStatus.findAll({ where: { memberId, status: LIVE_STATUSES }, transaction, raw: true });
    const unpaid = live.find((s) => s.status === 'pending_payment');
    if (unpaid) throw conflict(`Please finish paying for your ${unpaid.planName} plan first`);
    const today = time.today();
    if (live.some((s) => s.startDate > today)) throw conflict('You have already renewed your membership');
    const current = live.find((s) => s.startDate <= today && s.endDate >= today);
    if (current) {
      const daysLeft = Math.round((time.parseLocal(current.endDate) - time.parseLocal(today)) / 86400000);
      if (daysLeft > RENEWAL_WINDOW_DAYS) {
        throw conflict(`You can renew within ${RENEWAL_WINDOW_DAYS} days of your end date (${current.endDate})`);
      }
    }

    const sub = await createSubscription({ memberId, planId, createdBy: memberId }, { transaction });
    await Payment.create({
      subscriptionId: sub.subscriptionId, amountKrw: sub.priceKrw, method: 'online', status: 'pending', recordedBy: memberId,
    }, { transaction });
    return sub;
  });
}

// Simulated online checkout (no real money): pays the outstanding balance.
// A simulated decline is committed as a 'failed' payment, so the caller
// reports it after the transaction instead of throwing inside it.
async function checkout(memberId, subscriptionId, { simulateFailure = false } = {}) {
  return sequelize.transaction(async (transaction) => {
    const sub = await SubscriptionStatus.findOne({ where: { subscriptionId, memberId }, transaction, raw: true });
    if (!sub) throw notFound('Subscription');
    if (sub.status === 'cancelled') throw conflict('This subscription was cancelled');
    if (sub.balanceKrw <= 0) throw conflict('This subscription is already paid');

    let payment = await Payment.findOne({ where: { subscriptionId, status: 'pending' }, transaction, lock: transaction.LOCK.UPDATE });
    if (!payment) {
      payment = await Payment.create({
        subscriptionId, amountKrw: sub.balanceKrw, method: 'online', status: 'pending', recordedBy: memberId,
      }, { transaction });
    }
    await payment.update({
      status: simulateFailure ? 'failed' : 'paid',
      method: 'online',
      reference: onlineReference(),
      paidAt: simulateFailure ? null : time.now(),
    }, { transaction });
    return { payment, declined: simulateFailure };
  });
}

// A member may drop a subscription they have not paid anything for.
async function cancelUnpaid(memberId, subscriptionId) {
  return sequelize.transaction(async (transaction) => {
    const sub = await SubscriptionStatus.findOne({ where: { subscriptionId, memberId }, transaction, raw: true });
    if (!sub) throw notFound('Subscription');
    if (sub.status === 'cancelled') throw conflict('This subscription is already cancelled');
    if (sub.paidKrw > 0) throw conflict('Paid subscriptions can only be cancelled at the front desk');
    await Payment.update({ status: 'failed' }, { where: { subscriptionId, status: 'pending' }, transaction });
    await Subscription.update({ cancelledAt: time.now() }, { where: { subscriptionId }, transaction });
  });
}

// Admin cancels a subscription. The trigger cancels its future sessions.
async function cancelSubscription(subscriptionId, { refund = false } = {}) {
  return sequelize.transaction(async (transaction) => {
    const sub = await Subscription.findByPk(subscriptionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!sub) throw notFound('Subscription');
    if (sub.cancelledAt) throw conflict('This subscription is already cancelled');

    const before = await selectOne(
      `SELECT COUNT(*) AS n FROM bookings WHERE member_id = :memberId AND status = 'booked'
       AND starts_at > NOW() AND DATE(starts_at) BETWEEN :start AND :end`,
      { memberId: sub.memberId, start: sub.startDate, end: sub.endDate }, { transaction },
    );
    await Payment.update({ status: 'failed' }, { where: { subscriptionId, status: 'pending' }, transaction });
    await sub.update({ cancelledAt: time.now() }, { transaction });
    let refundedKrw = 0;
    if (refund) {
      const paid = await Payment.findAll({ where: { subscriptionId, status: 'paid' }, transaction });
      for (const p of paid) {
        await p.update({ status: 'refunded' }, { transaction });
        refundedKrw += p.amountKrw;
      }
    }
    return { cancelledSessions: before.n, refundedKrw };
  });
}

async function addFreeze(subscriptionId, { freezeStart, days, reason, createdBy }) {
  if (days < 1 || days > MAX_FREEZE_DAYS) throw badRequest(`A freeze lasts 1–${MAX_FREEZE_DAYS} days`);
  if (freezeStart < time.today()) throw badRequest('A freeze cannot start in the past');
  return sequelize.transaction(async (transaction) => {
    const sub = await Subscription.findByPk(subscriptionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!sub) throw notFound('Subscription');
    const newEnd = time.formatDate(time.addDays(time.parseLocal(sub.endDate), days));
    const blocking = await Subscription.findOne({
      where: {
        memberId: sub.memberId,
        subscriptionId: { [Op.ne]: subscriptionId },
        cancelledAt: null,
        startDate: { [Op.gt]: sub.endDate, [Op.lte]: newEnd },
      },
      transaction,
    });
    if (blocking) {
      throw conflict(`The member's next subscription starts on ${blocking.startDate}; this freeze would push the end date past it`);
    }
    const freezeEnd = time.formatDate(time.addDays(time.parseLocal(freezeStart), days - 1));
    // Triggers check R10 and extend end_date by `days`.
    return SubscriptionFreeze.create({ subscriptionId, freezeStart, freezeEnd, reason, createdBy }, { transaction });
  });
}

async function removeFreeze(freezeId) {
  const freeze = await SubscriptionFreeze.findByPk(freezeId);
  if (!freeze) throw notFound('Freeze');
  if (freeze.freezeStart <= time.today()) throw conflict('Only freezes that have not started yet can be removed');
  await freeze.destroy(); // trigger gives the days back
}

// Everything about one subscription: derived status, payments, freezes.
async function subscriptionDetail(subscriptionId, { memberId } = {}) {
  const where = memberId ? { subscriptionId, memberId } : { subscriptionId };
  const sub = await SubscriptionStatus.findOne({ where, raw: true });
  if (!sub) throw notFound('Subscription');
  const [payments, freezes] = await Promise.all([
    Payment.findAll({ where: { subscriptionId }, order: [['createdAt', 'ASC']], raw: true }),
    SubscriptionFreeze.findAll({ where: { subscriptionId }, order: [['freezeStart', 'ASC']], raw: true }),
  ]);
  return { ...sub, payments, freezes };
}

// Sessions used this month vs. the plan quota (for dashboards).
async function monthlyUsage(memberId, quota) {
  const row = await selectOne(
    `SELECT COALESCE(sessions_used, 0) AS used FROM v_member_monthly_usage
     WHERE member_id = :memberId AND month = DATE_FORMAT(CURDATE(), '%Y-%m')`,
    { memberId },
  );
  const used = row?.used || 0;
  return { quota, used, remaining: Math.max(quota - used, 0) };
}

async function listSubscriptions({ status, search, memberId } = {}) {
  const where = [];
  const params = {};
  if (status) { where.push('status = :status'); params.status = status; }
  if (memberId) { where.push('member_id = :memberId'); params.memberId = memberId; }
  if (search) {
    where.push('(member_name LIKE :search OR member_email LIKE :search OR plan_name LIKE :search)');
    params.search = `%${search}%`;
  }
  return select(
    `SELECT * FROM v_subscription_status ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY start_date DESC, subscription_id DESC LIMIT 500`,
    params,
  );
}

module.exports = {
  LIVE_STATUSES,
  endDateFor,
  memberSubscriptions,
  nextStartDate,
  createSubscription,
  purchaseOnline,
  checkout,
  cancelUnpaid,
  cancelSubscription,
  addFreeze,
  removeFreeze,
  subscriptionDetail,
  monthlyUsage,
  listSubscriptions,
};
