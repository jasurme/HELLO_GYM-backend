import {
  api, initPage, html, render, toast, showError, confirmDialog, emptyState, badge, krw, fmtDate, fmtDateTime,
  busy, modal, queryParam, METHOD_LABELS, $,
} from '../app.js';
import { membershipCard } from '../components.js';

await initPage({ role: 'member' });

const highlightPlan = Number(queryParam('plan')) || null;
let checkoutSub = null;

render('#page', html`
  <h1 class="page-title h3 mb-1">Membership</h1>
  <p class="page-subtitle mb-4">Your plan, payments and renewals.</p>
  <div class="row g-4 mb-4">
    <div class="col-lg-5" id="current"></div>
    <div class="col-lg-7" id="due"></div>
  </div>
  <h2 class="h5 fw-bold mb-3" id="plansTitle">Plans</h2>
  <div class="row g-3 mb-4" id="plans"></div>
  <div class="row g-4">
    <div class="col-xl-6"><div class="card"><div class="card-header">Membership history</div><div class="table-responsive" id="history"></div></div></div>
    <div class="col-xl-6"><div class="card"><div class="card-header">Payments</div><div class="table-responsive" id="payments"></div></div></div>
  </div>

  <div class="modal fade" id="checkoutModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title"><i class="bi bi-shield-lock me-2 text-brand"></i>Online checkout</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="alert alert-info small py-2"><i class="bi bi-info-circle me-1"></i>Demo checkout: no real card is charged.</div>
        <div id="checkoutSummary"></div>
      </div>
      <div class="modal-footer justify-content-between">
        <button class="btn btn-link text-danger px-0" id="declineBtn">Simulate a declined card</button>
        <button class="btn btn-primary" id="payBtn"><i class="bi bi-lock-fill me-1"></i>Pay now</button>
      </div>
    </div></div>
  </div>`);

function openCheckout(sub) {
  checkoutSub = sub;
  render('#checkoutSummary', html`
    <div class="d-flex justify-content-between"><span>${sub.planName}</span><span>${krw(sub.priceKrw)}</span></div>
    <div class="small text-secondary mb-2">${fmtDate(sub.startDate)} → ${fmtDate(sub.endDate)}</div>
    ${sub.paidKrw > 0 ? html`<div class="d-flex justify-content-between small"><span>Already paid</span><span>−${krw(sub.paidKrw)}</span></div>` : ''}
    <hr><div class="d-flex justify-content-between fw-bold fs-5"><span>To pay</span><span>${krw(sub.balanceKrw)}</span></div>`);
  $('#payBtn').innerHTML = `<i class="bi bi-lock-fill me-1"></i>Pay ${krw(sub.balanceKrw)}`;
  modal('#checkoutModal').show();
}

async function pay(simulateFailure, button) {
  await busy(button, async () => {
    try {
      await api(`/member/subscriptions/${checkoutSub.subscriptionId}/checkout`, { method: 'POST', body: { simulateFailure } });
      modal('#checkoutModal').hide();
      toast(`Payment received. Your ${checkoutSub.planName} membership is ready.`);
      await load();
    } catch (err) {
      modal('#checkoutModal').hide();
      showError(err);
      await load();
    }
  });
}
$('#payBtn').addEventListener('click', (e) => pay(false, e.currentTarget));
$('#declineBtn').addEventListener('click', (e) => pay(true, e.currentTarget));

async function load() {
  const [overview, plans, subs, payments] = await Promise.all([
    api('/member/overview'), api('/plans'), api('/member/subscriptions'), api('/member/payments'),
  ]);

  render('#current', membershipCard(overview, {
    actions: overview.current?.status === 'active' && overview.current.sessionsPerMonth
      ? html`<a class="btn btn-light text-brand fw-semibold" href="/member/book.html">Book a session</a>` : '',
  }));

  render('#due', overview.unpaid.length
    ? html`<div class="card h-100 border border-warning" id="pay"><div class="card-header text-warning-emphasis"><i class="bi bi-exclamation-triangle me-2"></i>Payment due</div>
        <div class="list-group list-group-flush">${overview.unpaid.map((s) => html`
          <div class="list-group-item py-3 d-flex flex-wrap gap-3 align-items-center">
            <div class="flex-grow-1"><div class="fw-semibold">${s.planName}</div>
              <div class="small text-secondary">${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}</div></div>
            <div class="fw-bold fs-5">${krw(s.balanceKrw)}</div>
            <div class="d-flex gap-2">
              <button class="btn btn-warning" data-pay="${s.subscriptionId}">Pay now</button>
              ${s.paidKrw === 0 ? html`<button class="btn btn-outline-secondary" data-drop="${s.subscriptionId}" title="Cancel this order">Cancel</button>` : ''}
            </div>
          </div>`)}</div></div>`
    : html`<div class="card h-100"><div class="card-body d-flex flex-column justify-content-center">
        <h5 class="fw-bold"><i class="bi bi-check-circle text-success me-2"></i>Nothing to pay</h5>
        <p class="text-secondary mb-0">${overview.current
    ? (overview.next ? `Your next membership (${overview.next.planName}) is already arranged.` : `You can renew online within 30 days of your end date (${fmtDate(overview.current.endDate)}).`)
    : 'Choose a plan below to get started.'}</p></div></div>`);

  const canBuy = !overview.unpaid.length && !overview.next && (!overview.current || overview.current.daysLeft <= 30);
  $('#plansTitle').textContent = overview.current ? 'Renew with a plan' : 'Choose a plan';
  render('#plans', plans.map((p) => html`
    <div class="col-md-6 col-xl">
      <div class="card plan-card h-100 ${p.planId === highlightPlan ? 'featured' : ''}"><div class="card-body d-flex flex-column">
        <h6 class="fw-bold mb-1">${p.planName}</h6>
        <div class="fs-4 fw-bold">${krw(p.priceKrw)}</div>
        <div class="small text-secondary mb-2">${p.durationMonths} month${p.durationMonths > 1 ? 's' : ''} ·
          ${p.sessionsPerMonth ? `${p.sessionsPerMonth} PT sessions / month` : 'no PT'}</div>
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
      <thead><tr><th>Date</th><th>Plan</th><th>Method</th><th class="text-end">Amount</th><th>Status</th></tr></thead>
      <tbody>${payments.map((p) => html`<tr>
        <td class="small">${fmtDateTime(p.paidAt || p.createdAt)}</td>
        <td class="small">${p.planName}</td>
        <td class="small">${METHOD_LABELS[p.method]}</td>
        <td class="text-end font-tabular">${krw(p.amountKrw)}</td>
        <td>${badge('payment', p.status)}</td></tr>`)}</tbody></table>`
    : emptyState('receipt', 'No payments yet.'));

  return overview;
}

$('#page').addEventListener('click', async (event) => {
  const payBtn = event.target.closest('[data-pay]');
  if (payBtn) {
    const subs = await api('/member/subscriptions');
    openCheckout(subs.find((s) => s.subscriptionId === Number(payBtn.dataset.pay)));
    return;
  }
  const dropBtn = event.target.closest('[data-drop]');
  if (dropBtn) {
    const ok = await confirmDialog({ title: 'Cancel this order?', body: 'Nothing has been paid, so nothing is charged.', confirmText: 'Cancel order', variant: 'danger' });
    if (!ok) return;
    try {
      await api(`/member/subscriptions/${dropBtn.dataset.drop}/cancel`, { method: 'POST' });
      toast('The order was cancelled');
      await load();
    } catch (err) { showError(err); }
    return;
  }
  const buyBtn = event.target.closest('[data-buy]');
  if (buyBtn) {
    const plans = await api('/plans');
    const plan = plans.find((p) => p.planId === Number(buyBtn.dataset.buy));
    const ok = await confirmDialog({
      title: `Buy ${plan.planName}?`,
      body: `${krw(plan.priceKrw)} for ${plan.durationMonths} month${plan.durationMonths > 1 ? 's' : ''}. It starts today, or the day after your current membership ends. You pay online in the next step.`,
      confirmText: 'Continue to payment',
    });
    if (!ok) return;
    try {
      const sub = await api('/member/subscriptions', { method: 'POST', body: { planId: plan.planId } });
      await load();
      openCheckout(sub);
    } catch (err) { showError(err); }
  }
});

const overview = await load();
if (window.location.hash === '#pay' && overview.unpaid.length) {
  $('#pay')?.scrollIntoView({ behavior: 'smooth' });
}
