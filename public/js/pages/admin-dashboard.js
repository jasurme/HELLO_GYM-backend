import {
  api, initPage, html, render, krw, num, fmtDate, todayIso, emptyState, $,
} from '../app.js';
import { revenueChart, planDoughnut } from '../charts.js';
import { bookForMemberDialog } from '../admin-common.js';

await initPage({ role: 'admin' });

function kpi(icon, color, value, label, href) {
  return html`<div class="col-6 col-xl"><a class="card kpi h-100 text-decoration-none text-body" href="${href}">
    <div class="d-flex gap-3 align-items-center">
      <div class="kpi-icon bg-${color}-subtle text-${color}-emphasis"><i class="bi bi-${icon}"></i></div>
      <div><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>
    </div></a></div>`;
}

const [summary, active, revenue, trainers, expiring] = await Promise.all([
  api('/admin/reports/summary'),
  api('/admin/reports/active-memberships'),
  api('/admin/reports/revenue'),
  api('/admin/reports/trainers'),
  api('/admin/reports/expiring'),
]);

const notRenewed = expiring.filter((e) => e.renewed === 'no');

render('#page', html`
  <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
    <div><h1 class="page-title h3 mb-1">Front desk dashboard</h1>
      <p class="page-subtitle mb-0">${fmtDate(todayIso())} · live figures from the database views</p></div>
    <div class="d-flex gap-2">
      <button class="btn btn-outline-primary" id="bookBtn"><i class="bi bi-calendar-plus me-1"></i>Book for a member</button>
      <a class="btn btn-primary" href="/admin/members.html?new=1"><i class="bi bi-person-plus me-1"></i>New member</a>
    </div>
  </div>

  <div class="row g-3 mb-4">
    ${kpi('people-fill', 'primary', num(summary.activeMembers), 'active memberships', '/admin/subscriptions.html?status=active')}
    ${kpi('cash-stack', 'success', krw(summary.revenueThisMonthKrw), 'collected this month', '/admin/reports.html#revenue')}
    ${kpi('calendar-week', 'info', num(summary.sessionsThisWeek), 'sessions this week', '/admin/bookings.html')}
    ${kpi('hourglass-split', 'warning', num(summary.expiringIn7Days), 'expire in 7 days, not renewed', '/admin/reports.html#expiring')}
    ${kpi('exclamation-diamond', 'danger', `${summary.pendingPayments} · ${krw(summary.pendingPaymentsKrw)}`, 'awaiting payment', '/admin/subscriptions.html?status=pending_payment')}
  </div>

  <div class="row g-4 mb-4">
    <div class="col-lg-8"><div class="card h-100">
      <div class="card-header d-flex justify-content-between"><span>Revenue, last 12 months</span>
        <span class="small text-secondary">This year: <strong>${krw(revenue.headline.thisYearKrw)}</strong></span></div>
      <div class="card-body"><div class="chart-box"><canvas id="revenueChart"></canvas></div></div>
    </div></div>
    <div class="col-lg-4"><div class="card h-100">
      <div class="card-header">Active memberships by plan</div>
      <div class="card-body"><div class="chart-box"><canvas id="planChart"></canvas></div></div>
    </div></div>
  </div>

  <div class="row g-4">
    <div class="col-lg-6"><div class="card h-100">
      <div class="card-header d-flex justify-content-between"><span><i class="bi bi-hourglass-split me-2 text-warning"></i>Expiring soon, not renewed</span>
        <a class="small" href="/admin/reports.html#expiring">All</a></div>
      ${notRenewed.length ? html`<div class="table-responsive"><table class="table table-hover align-middle mb-0">
        <thead><tr><th>Member</th><th>Plan</th><th>Ends</th><th>Phone</th></tr></thead>
        <tbody>${notRenewed.slice(0, 8).map((e) => html`<tr>
          <td class="fw-semibold">${e.memberName}</td><td class="small">${e.planName}</td>
          <td><span class="badge ${e.daysLeft <= 7 ? 'bg-danger-subtle text-danger-emphasis' : 'bg-warning-subtle text-warning-emphasis'}">${e.daysLeft === 0 ? 'today' : `${e.daysLeft} days`}</span></td>
          <td class="small">${e.memberPhone || '—'}</td></tr>`)}</tbody></table></div>`
    : emptyState('emoji-smile', 'Everyone expiring soon has renewed.')}
    </div></div>
    <div class="col-lg-6"><div class="card h-100">
      <div class="card-header d-flex justify-content-between"><span><i class="bi bi-person-badge me-2 text-brand"></i>Trainer bookings, last 30 days</span>
        <a class="small" href="/admin/reports.html#trainers">Details</a></div>
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>Trainer</th><th class="text-end">Sessions</th><th class="text-end">Hours</th><th class="text-end">No-show %</th><th class="text-end">Members</th></tr></thead>
        <tbody>${trainers.range.map((t) => html`<tr>
          <td><div class="fw-semibold">${t.trainerName}</div><div class="small text-secondary">${t.specialization}</div></td>
          <td class="text-end">${t.sessions}</td><td class="text-end">${t.hours}</td>
          <td class="text-end">${t.noShowPct ?? '—'}</td><td class="text-end">${t.members}</td></tr>`)}</tbody>
      </table></div>
    </div></div>
  </div>`);

revenueChart($('#revenueChart'), revenue.trend);
planDoughnut($('#planChart'), active.byPlan);
$('#bookBtn').addEventListener('click', () => bookForMemberDialog());
