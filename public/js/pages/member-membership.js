import {
  api, initPage, html, render, showError, emptyState, badge, krw, fmtDate, fmtDateTime,
  busy, modal, queryParam, paymentComplete, METHOD_LABELS, $,
} from '../app.js';
import { membershipCard } from '../components.js';

await initPage({ role: 'member' });

const highlightPlan = Number(queryParam('plan')) || null;
// What the checkout dialog pays for: { plan } (buy/renew) or { sub } (open balance).
let checkout = null;

render('#page', html`
  <h1 class="page-title h3 mb-1">Membership &amp; payments</h1>
  <p class="page-subtitle mb-4">Your gym membership, renewals, and everything you have paid, including training sessions.</p>
  <div class="row g-4 mb-4">
    <div class="col-lg-5" id="current"></div>
    <div class="col-lg-7" id="due"></div>
  </div>
  <h2 class="h5 fw-bold mb-3" id="plansTitle">Plans</h2>
  <div class="row g-3 mb-4" id="plans"></div>
  <div class="row g-4">
    <div class="col-xl-5"><div class="card"><div class="card-header">Membership history</div><div class="table-responsive" id="history"></div></div></div>
    <div class="col-xl-7"><div class="card"><div class="card-header">Payments</div><div class="table-responsive" id="payments"></div></div></div>
  </div>

  <div class="modal fade" id="checkoutModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title"><i class="bi bi-shield-lock me-2 text-brand"></i>Online checkout</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div id="checkoutSummary"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-light" data-bs-dismiss="modal">Back</button>
        <button class="btn btn-primary" id="payBtn"><i class="bi bi-lock-fill me-1"></i>Pay now</button>
      </div>
    </div></div>
  </div>`);

const plural = (n) => (n === 1 ? '1 month' : `${n} months`);

function openCheckout(target) {
  checkout = target;
  const { plan, sub } = target;
  const amount = plan ? plan.priceKrw : sub.balanceKrw;
  render('#checkoutSummary', plan
    ? html`<div class="d-flex justify-content-between"><span>${plan.planName} membership</span><span>${krw(plan.priceKrw)}</span></div>
      <div class="small text-secondary mb-2">${plural(plan.durationMonths)} of gym access, starting today or the day after your current membership ends.</div>
      <hr><div class="d-flex justify-content-between fw-bold fs-5"><span>To pay</span><span>${krw(amount)}</span></div>`
    : html`<div class="d-flex justify-content-between"><span>${sub.planName}</span><span>${krw(sub.priceKrw)}</span></div>
      <div class="small text-secondary mb-2">${fmtDate(sub.startDate)} → ${fmtDate(sub.endDate)}</div>
      ${sub.paidKrw > 0 ? html`<div class="d-flex justify-content-between small"><span>Already paid</span><span>−${krw(sub.paidKrw)}</span></div>` : ''}
      <hr><div class="d-flex justify-content-between fw-bold fs-5"><span>To pay</span><span>${krw(amount)}</span></div>`);
  $('#payBtn').innerHTML = `<i class="bi bi-lock-fill me-1"></i>Pay ${krw(amount)}`;
  modal('#checkoutModal').show();
}

async function pay(button) {
  const { plan, sub } = checkout;
  await busy(button, async () => {
    try {
      if (plan) {
        // Buying is one step: the membership exists only once it is paid.
        await api('/member/subscriptions', { method: 'POST', body: { planId: plan.planId } });
      } else {
        await api(`/member/subscriptions/${sub.subscriptionId}/checkout`, { method: 'POST', body: {} });
      }
      modal('#checkoutModal').hide();
      paymentComplete({
        amount: plan ? plan.priceKrw : sub.balanceKrw,
        lines: [`Your ${(plan || sub).planName} membership is paid.`],
        redirect: '/member/',
      });
    } catch (err) {
      modal('#checkoutModal').hide();
      showError(err);
      await load();
    }
  });
}
$('#payBtn').addEventListener('click', (e) => pay(e.currentTarget));

let plans = [];
let subs = [];

async function load() {
  let overview;
  let payments;
  [overview, plans, subs, payments] = await Promise.all([
    api('/member/overview'), api('/plans'), api('/member/subscriptions'), api('/member/payments'),
  ]);

  render('#current', membershipCard(overview, {
    actions: overview.current?.status === 'active'
      ? html`<a class="btn btn-light text-brand fw-semibold" href="/member/book.html">Book a trainer</a>` : '',
  }));

  // Only memberships sold at the desk can be left awaiting payment.
  render('#due', overview.unpaid.length
    ? html`<div class="card h-100 border border-warning" id="pay"><div class="card-header text-warning-emphasis"><i class="bi bi-exclamation-triangle me-2"></i>Payment due</div>
        <div class="list-group list-group-flush">${overview.unpaid.map((s) => html`
          <div class="list-group-item py-3 d-flex flex-wrap gap-3 align-items-center">
            <div class="flex-grow-1"><div class="fw-semibold">${s.planName}</div>
              <div class="small text-secondary">${fmtDate(s.startDate)} → ${fmtDate(s.endDate)} · arranged at the front desk</div></div>
            <div class="fw-bold fs-5">${krw(s.balanceKrw)}</div>
            <button class="btn btn-warning" data-pay="${s.subscriptionId}">Pay online now</button>
          </div>`)}</div></div>`
    : html`<div class="card h-100"><div class="card-body d-flex flex-column justify-content-center">
        <h5 class="fw-bold"><i class="bi bi-check-circle text-success me-2"></i>Nothing to pay</h5>
        <p class="text-secondary mb-0">${overview.current
    ? (overview.next ? `Your next membership (${overview.next.planName}) is already arranged.` : `You can renew online within 30 days of your end date (${fmtDate(overview.current.endDate)}).`)
    : 'Choose a plan below to use the gym again.'}</p></div></div>`);

  const canBuy = !overview.unpaid.length && !overview.next && (!overview.current || overview.current.daysLeft <= 30);
  $('#plansTitle').textContent = overview.current ? 'Renew your membership' : 'Choose a membership';
  render('#plans', plans.map((p) => html`
    <div class="col-md-6 col-xl-3">
      <div class="card plan-card h-100 ${p.planId === highlightPlan ? 'featured' : ''}"><div class="card-body d-flex flex-column">
        <h6 class="fw-bold mb-1">${p.planName}</h6>
        <div class="fs-4 fw-bold">${krw(p.priceKrw)}</div>
        <div class="small text-secondary mb-2">${krw(p.priceKrw / p.durationMonths)} a month · gym access</div>
        <p class="small flex-grow-1">${p.description}</p>
        <button class="btn ${p.planId === highlightPlan ? 'btn-primary' : 'btn-outline-primary'}" data-buy="${p.planId}" ${canBuy ? '' : 'disabled'}>
          ${overview.current ? 'Renew with this plan' : 'Choose this plan'}</button>
      </div></div>
    </div>`));

  render('#history', subs.length ? html`<table class="table table-hover align-middle mb-0">
      <thead><tr><th>Plan</th><th>Period</th><th class="text-end">Price</th><th>Status</th></tr></thead>
      <tbody>${subs.map((s) => html`<tr>
        <td class="fw-semibold">${s.planName}</td>
        <td class="small">${fmtDate(s.startDate)}<br>${fmtDate(s.endDate)}</td>
        <td class="text-end font-tabular">${krw(s.priceKrw)}${s.balanceKrw > 0 && s.status !== 'cancelled' ? html`<div class="small text-warning-emphasis">${krw(s.balanceKrw)} due</div>` : ''}</td>
        <td>${badge('membership', s.status)}</td></tr>`)}</tbody></table>`
    : emptyState('journal', 'No memberships yet.'));

  render('#payments', payments.length ? html`<table class="table align-middle mb-0">
      <thead><tr><th>Date</th><th>For</th><th>Method</th><th class="text-end">Amount</th><th>Status</th></tr></thead>
      <tbody>${payments.map((p) => html`<tr>
        <td class="small">${fmtDateTime(p.paidAt || p.createdAt)}</td>
        <td class="small"><div class="fw-semibold">${p.product}</div>${p.detail ? html`<div class="text-secondary">${p.detail}</div>` : ''}</td>
        <td class="small">${METHOD_LABELS[p.method]}</td>
        <td class="text-end font-tabular">${krw(p.amountKrw)}</td>
        <td>${badge('payment', p.status)}</td></tr>`)}</tbody></table>`
    : emptyState('receipt', 'No payments yet.'));

  return overview;
}

$('#page').addEventListener('click', (event) => {
  const payBtn = event.target.closest('[data-pay]');
  if (payBtn) openCheckout({ sub: subs.find((s) => s.subscriptionId === Number(payBtn.dataset.pay)) });
  const buyBtn = event.target.closest('[data-buy]');
  if (buyBtn) openCheckout({ plan: plans.find((p) => p.planId === Number(buyBtn.dataset.buy)) });
});

const overview = await load();
if (window.location.hash === '#pay' && overview.unpaid.length) {
  $('#pay')?.scrollIntoView({ behavior: 'smooth' });
}
