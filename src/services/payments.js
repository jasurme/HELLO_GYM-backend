const { Payment } = require('../models');
const { select } = require('../lib/sql');
const time = require('../lib/time');
const { notFound } = require('../lib/http-error');

// Front-desk payment (cash, card, transfer). R9 is enforced by the triggers.
async function recordPayment({ subscriptionId, amountKrw, method, status, reference, recordedBy }) {
  return Payment.create({
    subscriptionId,
    amountKrw,
    method,
    status,
    reference,
    recordedBy,
    paidAt: status === 'paid' ? time.now() : null,
  });
}

// pending → paid | failed, paid → refunded (other changes rejected by trg_payments_bu)
async function updateStatus(paymentId, status) {
  const payment = await Payment.findByPk(paymentId);
  if (!payment) throw notFound('Payment');
  await payment.update({ status, ...(status === 'paid' && !payment.paidAt ? { paidAt: time.now() } : {}) });
  return payment;
}

async function listPayments({ memberId, status, from, to, search } = {}) {
  const where = [];
  const params = {};
  if (memberId) { where.push('s.member_id = :memberId'); params.memberId = memberId; }
  if (status) { where.push('p.status = :status'); params.status = status; }
  if (from) { where.push('COALESCE(p.paid_at, p.created_at) >= :from'); params.from = from; }
  if (to) { where.push('COALESCE(p.paid_at, p.created_at) < :to + INTERVAL 1 DAY'); params.to = to; }
  if (search) {
    where.push("(CONCAT(u.first_name, ' ', u.last_name) LIKE :search OR u.email LIKE :search OR p.reference LIKE :search)");
    params.search = `%${search}%`;
  }
  return select(
    `SELECT p.payment_id, p.subscription_id, p.amount_krw, p.method, p.status, p.paid_at, p.reference,
            p.created_at, s.member_id, CONCAT(u.first_name, ' ', u.last_name) AS member_name, u.email AS member_email,
            mp.plan_name, CONCAT(r.first_name, ' ', r.last_name) AS recorded_by_name
     FROM payments p
     JOIN subscriptions s     ON s.subscription_id = p.subscription_id
     JOIN users u             ON u.user_id = s.member_id
     JOIN membership_plans mp ON mp.plan_id = s.plan_id
     LEFT JOIN users r        ON r.user_id = p.recorded_by
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.payment_id DESC
     LIMIT 500`,
    params,
  );
}

module.exports = { recordPayment, updateStatus, listPayments };
