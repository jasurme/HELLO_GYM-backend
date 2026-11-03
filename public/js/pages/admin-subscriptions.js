import {
  api, initPage, html, render, badge, krw, fmtDate, emptyState, queryParam, $,
} from '../app.js';

await initPage({ role: 'admin' });

const state = { status: queryParam('status') || '', search: '' };

render('#page', html`
  <h1 class="page-title h3 mb-1">Subscriptions</h1>
  <p class="page-subtitle mb-4">Status is derived from dates, payments and freezes by the view v_subscription_status. It is never stored.</p>
  <div class="card">
    <div class="card-header d-flex flex-wrap gap-2 align-items-center">
      <div class="input-group input-group-sm" style="max-width:320px"><span class="input-group-text"><i class="bi bi-search"></i></span>
        <input class="form-control" id="search" placeholder="Member or plan"></div>
      <div class="btn-group btn-group-sm flex-wrap" id="statusFilter">
        ${[['', 'All'], ['active', 'Active'], ['frozen', 'Frozen'], ['pending_payment', 'Awaiting payment'], ['upcoming', 'Upcoming'], ['expired', 'Expired'], ['cancelled', 'Cancelled']]
    .map(([v, l]) => html`<button class="btn btn-outline-primary" data-status="${v}">${l}</button>`)}
      </div>
      <span class="small text-secondary ms-auto" id="summary"></span>
    </div>
    <div class="table-responsive" id="table"></div>
  </div>`);

async function load() {
  document.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('active', b.dataset.status === state.status));
  const rows = await api('/admin/subscriptions', { query: state });
  const total = rows.reduce((s, r) => s + r.priceKrw, 0);
  $('#summary').textContent = `${rows.length} subscriptions · ${krw(total)} sold${rows.length === 500 ? ' (first 500)' : ''}`;
  render('#table', rows.length ? html`<table class="table table-hover align-middle mb-0">
    <thead><tr><th>#</th><th>Member</th><th>Plan</th><th>Start</th><th>End</th><th class="text-end">Days left</th><th class="text-end">Price</th><th class="text-end">Balance</th><th>Status</th></tr></thead>
    <tbody>${rows.map((s) => html`<tr class="clickable" data-href="/admin/member.html?id=${s.memberId}">
      <td class="small text-secondary">${s.subscriptionId}</td>
      <td><div class="fw-semibold">${s.memberName}</div><div class="small text-secondary">${s.memberEmail}</div></td>
      <td class="small">${s.planName}</td><td class="small">${fmtDate(s.startDate)}</td><td class="small">${fmtDate(s.endDate)}</td>
      <td class="text-end">${['active', 'frozen'].includes(s.status) ? s.daysLeft : '—'}</td>
      <td class="text-end font-tabular">${krw(s.priceKrw)}</td>
      <td class="text-end font-tabular">${s.balanceKrw > 0 && s.status !== 'cancelled' ? html`<span class="text-danger">${krw(s.balanceKrw)}</span>` : '—'}</td>
      <td>${badge('membership', s.status)}</td></tr>`)}</tbody></table>` : emptyState('journal', 'No subscriptions match.'));
}

$('#statusFilter').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-status]');
  if (!btn) return;
  state.status = btn.dataset.status;
  load();
});
let timer;
$('#search').addEventListener('input', (event) => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.search = event.target.value.trim(); load(); }, 250);
});
$('#table').addEventListener('click', (event) => {
  const row = event.target.closest('[data-href]');
  if (row) window.location.href = row.dataset.href;
});

await load();
