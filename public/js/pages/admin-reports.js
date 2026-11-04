import {
  api, initPage, html, render, krw, num, fmtDate, isoDate, todayIso, badge, METHOD_LABELS, emptyState, monthLabel, $,
} from '../app.js';
import { revenueChart, trainerBars } from '../charts.js';

await initPage({ role: 'admin' });

const source = (...names) => html`<span class="small text-secondary fw-normal"><i class="bi bi-filetype-sql me-1"></i>db/05_reports.sql · ${names.join(', ')}</span>`;
const section = (id, number, title, names, body) => html`
  <section class="card mb-4" id="${id}">
    <div class="card-header d-flex flex-wrap justify-content-between gap-2"><span>${number}. ${title}</span>${source(...names)}</div>
    <div class="card-body">${body}</div>
  </section>`;

const [active, revenue, expiring] = await Promise.all([
  api('/admin/reports/active-memberships'),
  api('/admin/reports/revenue'),
  api('/admin/reports/expiring'),
]);

const statusTotal = active.byStatus.reduce((s, r) => s + r.subscriptions, 0);

render('#page', html`
  <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
    <div><h1 class="page-title h3 mb-1">Management reports</h1>
      <p class="page-subtitle mb-0">Every figure is a SQL query over the database views, as of ${fmtDate(todayIso())}.</p></div>
    <button class="btn btn-outline-secondary d-print-none" id="printBtn"><i class="bi bi-printer me-1"></i>Print</button>
  </div>

  ${section('active', 1, 'Active membership counts', ['active_by_status', 'active_by_plan'], html`
    <div class="row g-4">
      <div class="col-lg-4">
        <ul class="list-group">${active.byStatus.map((r) => html`<li class="list-group-item d-flex justify-content-between align-items-center">
          ${badge('membership', r.status)}<span class="fw-bold fs-5">${r.subscriptions}</span></li>`)}
          <li class="list-group-item d-flex justify-content-between"><span class="text-secondary">Total live</span><span class="fw-bold">${statusTotal}</span></li></ul>
      </div>
      <div class="col-lg-8"><div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>Plan</th><th class="text-end">Months</th><th class="text-end">Price</th><th class="text-end">Active</th><th style="width:35%">Share</th></tr></thead>
        <tbody>${active.byPlan.map((p) => html`<tr><td class="fw-semibold">${p.planName}</td><td class="text-end">${p.durationMonths}</td>
          <td class="text-end font-tabular">${krw(p.priceKrw)}</td><td class="text-end">${p.activeMembers}</td>
          <td><div class="d-flex align-items-center gap-2"><div class="progress flex-grow-1" style="height:.5rem"><div class="progress-bar" style="width:${p.pctOfActive || 0}%"></div></div>
            <span class="small text-secondary">${p.pctOfActive ?? 0}%</span></div></td></tr>`)}</tbody></table></div></div>
    </div>`)}

  ${section('revenue', 2, 'Collected revenue: memberships and personal training', ['revenue_headline', 'revenue_trend', 'revenue_by_product_method', 'outstanding_balances'], html`
    <div class="row g-3 mb-4">
      ${[['This month', revenue.headline.thisMonthKrw], ['This year', revenue.headline.thisYearKrw],
    ['This year · memberships', revenue.headline.thisYearMembershipKrw], ['This year · training', revenue.headline.thisYearTrainingKrw],
    ['All time', revenue.headline.allTimeKrw]].map(([label, v]) => html`
        <div class="col-md"><div class="p-3 rounded bg-brand-soft"><div class="small text-secondary">${label}</div><div class="fs-4 fw-bold">${krw(v)}</div></div></div>`)}
    </div>
    <div class="row g-4">
      <div class="col-lg-7"><div class="chart-box"><canvas id="revenueChart"></canvas></div></div>
      <div class="col-lg-5"><div class="table-responsive" style="max-height:280px"><table class="table table-sm align-middle mb-0">
        <thead><tr><th>Month</th><th class="text-end">Memberships</th><th class="text-end">Training</th><th class="text-end">Total</th><th class="text-end">Refunded</th></tr></thead>
        <tbody>${[...revenue.trend].reverse().map((r) => html`<tr><td>${monthLabel(r.month)}</td>
          <td class="text-end font-tabular">${krw(r.membershipKrw)}</td><td class="text-end font-tabular">${krw(r.trainingKrw)}</td>
          <td class="text-end font-tabular fw-semibold">${krw(r.revenueKrw)}</td><td class="text-end font-tabular text-danger">${r.refundedKrw ? krw(r.refundedKrw) : '—'}</td></tr>`)}</tbody></table></div></div>
    </div>
    <h6 class="fw-bold mt-4">By product and payment method, last 12 months <span class="small text-secondary fw-normal">(GROUP BY … WITH ROLLUP)</span></h6>
    <div class="table-responsive"><table class="table table-sm align-middle">
      <thead><tr><th>Product</th><th>Method</th><th class="text-end">Payments</th><th class="text-end">Revenue</th></tr></thead>
      <tbody>${revenue.byProductMethod.map((r) => {
    const subtotal = r.method === null;
    const total = r.product === null;
    return html`<tr class="${total ? 'table-primary fw-bold' : subtotal ? 'table-light fw-semibold' : ''}">
          <td>${total ? 'Everything' : subtotal ? `${r.product} total` : r.product}</td>
          <td>${subtotal ? '' : METHOD_LABELS[r.method]}</td>
          <td class="text-end">${r.payments}</td><td class="text-end font-tabular">${krw(r.revenueKrw)}</td></tr>`;
  })}</tbody></table></div>
    <h6 class="fw-bold mt-3">Outstanding balances</h6>
    ${revenue.outstanding.length ? html`<div class="table-responsive"><table class="table table-sm align-middle mb-0">
      <thead><tr><th>Member</th><th>Plan</th><th>Starts</th><th class="text-end">Price</th><th class="text-end">Paid</th><th class="text-end">Balance</th></tr></thead>
      <tbody>${revenue.outstanding.map((o) => html`<tr><td>${o.memberName}</td><td>${o.planName}</td><td>${fmtDate(o.startDate)}</td>
        <td class="text-end">${krw(o.priceKrw)}</td><td class="text-end">${krw(o.paidKrw)}</td><td class="text-end fw-bold text-danger">${krw(o.balanceKrw)}</td></tr>`)}</tbody></table></div>`
    : emptyState('check2-circle', 'No outstanding balances.')}`)}

  ${section('trainers', 3, 'Trainer bookings', ['trainer_lifetime', 'trainer range query'], html`
    <form class="row g-2 align-items-end mb-3" id="rangeForm">
      <div class="col-auto"><label class="form-label small mb-1">From</label><input type="date" class="form-control form-control-sm" name="from"></div>
      <div class="col-auto"><label class="form-label small mb-1">To</label><input type="date" class="form-control form-control-sm" name="to"></div>
      <div class="col-auto"><button class="btn btn-sm btn-primary">Update</button></div>
    </form>
    <div class="row g-4">
      <div class="col-lg-5"><div class="chart-box"><canvas id="trainerChart"></canvas></div></div>
      <div class="col-lg-7 table-responsive" id="trainerTable"></div>
    </div>
    <h6 class="fw-bold mt-4">Lifetime totals <span class="small text-secondary fw-normal">(view v_trainer_booking_stats)</span></h6>
    <div class="table-responsive" id="lifetimeTable"></div>`)}

  ${section('expiring', 5, 'Subscriptions expiring in the next 30 days', ['expiring_soon'], expiring.length ? html`
    <div class="table-responsive"><table class="table table-hover align-middle mb-0">
      <thead><tr><th>Member</th><th>Contact</th><th>Plan</th><th>Ends</th><th>Window</th><th>Renewed?</th></tr></thead>
      <tbody>${expiring.map((e) => html`<tr>
        <td class="fw-semibold">${e.memberName}</td><td class="small">${e.memberEmail}<br>${e.memberPhone || ''}</td>
        <td>${e.planName}</td><td>${fmtDate(e.endDate)} <span class="small text-secondary">(${e.daysLeft} d)</span></td>
        <td><span class="badge ${e.windowLabel === 'within 7 days' ? 'bg-danger-subtle text-danger-emphasis' : 'bg-warning-subtle text-warning-emphasis'}">${e.windowLabel}</span></td>
        <td>${e.renewed === 'yes' ? html`<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>yes</span>` : html`<span class="text-secondary">no</span>`}</td></tr>`)}</tbody></table></div>`
    : emptyState('calendar-check', 'Nothing expires in the next 30 days.'))}
  <p class="small text-secondary">Report 4 (monthly revenue trend) is the chart in section 2.</p>`);

revenueChart($('#revenueChart'), revenue.trend);
$('#printBtn').addEventListener('click', () => window.print());

const rangeForm = $('#rangeForm');
rangeForm.elements.from.value = isoDate(new Date(Date.now() - 30 * 86400000));
rangeForm.elements.to.value = todayIso();

async function loadTrainers() {
  const data = await api('/admin/reports/trainers', { query: { from: rangeForm.elements.from.value, to: rangeForm.elements.to.value } });
  trainerBars($('#trainerChart'), data.range);
  render('#trainerTable', html`<table class="table table-sm align-middle mb-0">
    <thead><tr><th>Trainer</th><th class="text-end">Sessions</th><th class="text-end">Done</th><th class="text-end">No-show</th><th class="text-end">%</th><th class="text-end">Hours</th><th class="text-end">Members</th><th class="text-end">Revenue</th></tr></thead>
    <tbody>${data.range.map((t) => html`<tr><td class="fw-semibold">${t.trainerName}</td><td class="text-end">${t.sessions}</td><td class="text-end">${t.completed}</td>
      <td class="text-end">${t.noShows}</td><td class="text-end">${t.noShowPct ?? '—'}</td><td class="text-end">${t.hours}</td><td class="text-end">${t.members}</td><td class="text-end font-tabular">${krw(t.revenueKrw)}</td></tr>`)}</tbody></table>`);
  render('#lifetimeTable', html`<table class="table table-sm align-middle mb-0">
    <thead><tr><th>Trainer</th><th>Specialization</th><th class="text-end">Total</th><th class="text-end">Upcoming</th><th class="text-end">Completed</th><th class="text-end">No-shows</th><th class="text-end">Cancelled</th><th class="text-end">Hours</th><th class="text-end">Members</th><th class="text-end">Revenue</th></tr></thead>
    <tbody>${data.lifetime.map((t) => html`<tr><td class="fw-semibold">${t.trainerName}</td><td class="small">${t.specialization}</td>
      <td class="text-end">${num(t.totalBookings)}</td><td class="text-end">${t.upcoming}</td><td class="text-end">${t.completed}</td>
      <td class="text-end">${t.noShows}</td><td class="text-end">${t.cancelled}</td><td class="text-end">${t.hoursDelivered}</td><td class="text-end">${t.distinctMembers}</td><td class="text-end font-tabular">${krw(t.revenueKrw)}</td></tr>`)}</tbody></table>`);
}

rangeForm.addEventListener('submit', (event) => { event.preventDefault(); loadTrainers(); });
await loadTrainers();
if (window.location.hash) $(window.location.hash)?.scrollIntoView();
