const { sequelize, Payment, Subscription } = require('../models');
const { select } = require('../lib/sql');
const time = require('../lib/time');
const { notFound } = require('../lib/http-error');

// Front-desk payment (cash, card, transfer). R9 is enforced by the triggers;
// locking the subscription row first serializes concurrent payments for it.
async function recordPayment({ subscriptionId, amountKrw, method, status, reference, recordedBy }) {
  return sequelize.transaction(async (transaction) => {
    if (!(await Subscription.findByPk(subscriptionId, { transaction, lock: transaction.LOCK.UPDATE }))) {
      throw notFound('Subscription');
    }
    return Payment.create({
      subscriptionId,
      amountKrw,
      method,
      status,
      reference,
      recordedBy,
      paidAt: status === 'paid' ? time.now() : null,
    }, { transaction });
  });
}

// pending → paid | failed, paid → refunded (other changes rejected by trg_payments_bu)
async function updateStatus(paymentId, status) {
  const payment = await Payment.findByPk(paymentId);
  if (!payment) throw notFound('Payment');
  await payment.update({ status, ...(status === 'paid' && !payment.paidAt ? { paidAt: time.now() } : {}) });
  return payment;
}

// Membership and training-session payments together. `product` is the plan
// name or "Personal training"; `detail` names the trainer and session time.
async function listPayments({ memberId, status, kind, from, to, search } = {}) {
  const where = [];
  const params = {};
  if (memberId) { where.push('COALESCE(s.member_id, b.member_id) = :memberId'); params.memberId = memberId; }
  if (status) { where.push('p.status = :status'); params.status = status; }
  if (kind === 'membership') where.push('p.subscription_id IS NOT NULL');
  if (kind === 'training') where.push('p.booking_id IS NOT NULL');
  if (from) { where.push('COALESCE(p.paid_at, p.created_at) >= :from'); params.from = from; }
  if (to) { where.push('COALESCE(p.paid_at, p.created_at) < :to + INTERVAL 1 DAY'); params.to = to; }
  if (search) {
    where.push("(CONCAT(u.first_name, ' ', u.last_name) LIKE :search OR u.email LIKE :search OR p.reference LIKE :search)");
    params.search = `%${search}%`;
  }
  return select(
    `SELECT p.payment_id, p.subscription_id, p.booking_id, p.amount_krw, p.method, p.status, p.paid_at, p.reference,
            p.created_at, COALESCE(s.member_id, b.member_id) AS member_id,
            CONCAT(u.first_name, ' ', u.last_name) AS member_name, u.email AS member_email,
            COALESCE(mp.plan_name, 'Personal training') AS product,
            CASE WHEN b.booking_id IS NOT NULL
                 THEN CONCAT(tu.first_name, ' ', tu.last_name, ' · ', DATE_FORMAT(b.starts_at, '%Y-%m-%d %H:%i')) END AS detail,
            CONCAT(r.first_name, ' ', r.last_name) AS recorded_by_name
     FROM payments p
     LEFT JOIN subscriptions s     ON s.subscription_id = p.subscription_id
     LEFT JOIN membership_plans mp ON mp.plan_id = s.plan_id
     LEFT JOIN bookings b          ON b.booking_id = p.booking_id
     LEFT JOIN users tu            ON tu.user_id = b.trainer_id
     JOIN users u                  ON u.user_id = COALESCE(s.member_id, b.member_id)
     LEFT JOIN users r             ON r.user_id = p.recorded_by
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.payment_id DESC
     LIMIT 500`,
    params,
  );
}

module.exports = { recordPayment, updateStatus, listPayments };
