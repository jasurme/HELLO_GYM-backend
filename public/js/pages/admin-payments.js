import {
  api, initPage, html, render, badge, krw, fmtDateTime, emptyState, toast, showError, confirmDialog, METHOD_LABELS,
  isoDate, todayIso, $,
} from '../app.js';

await initPage({ role: 'admin' });

const now = new Date();
const state = { kind: '', status: '', from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayIso(), search: '' };

render('#page', html`
  <h1 class="page-title h3 mb-1">Payments</h1>
  <p class="page-subtitle mb-4">Membership and training-session payments, at the desk or online. Allowed status changes: pending → paid / failed, and paid → refunded.</p>
  <div class="card">
    <div class="card-header"><form class="row g-2 align-items-end" id="filters">
      <div class="col-sm-3"><label class="form-label small mb-1">Search</label><input class="form-control form-control-sm" name="search" placeholder="Member or reference"></div>
      <div class="col-sm-2"><label class="form-label small mb-1">For</label><select class="form-select form-select-sm" name="kind">
        <option value="">Everything</option><option value="membership">Memberships</option><option value="training">Training sessions</option></select></div>
      <div class="col-sm-1"><label class="form-label small mb-1">Status</label><select class="form-select form-select-sm" name="status">
        <option value="">All</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="refunded">Refunded</option></select></div>
      <div class="col-sm-2"><label class="form-label small mb-1">From</label><input type="date" class="form-control form-control-sm" name="from"></div>
      <div class="col-sm-2"><label class="form-label small mb-1">To</label><input type="date" class="form-control form-control-sm" name="to"></div>
      <div class="col-sm-2 text-sm-end small text-secondary" id="totals"></div>
    </form></div>
    <div class="table-responsive" id="table"></div>
  </div>`);

const filters = $('#filters');
for (const [k, v] of Object.entries(state)) filters.elements[k].value = v;

async function load() {
  const rows = await api('/admin/payments', { query: state });
  const paid = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amountKrw, 0);
  render('#totals', html`${rows.length} payments<br><strong class="text-body">${krw(paid)}</strong> collected`);
  render('#table', rows.length ? html`<table class="table align-middle mb-0">
    <thead><tr><th>When</th><th>Member</th><th>For</th><th>Method</th><th>Reference</th><th>Recorded by</th><th class="text-end">Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((p) => html`<tr>
      <td class="small">${fmtDateTime(p.paidAt || p.createdAt)}</td>
      <td><a href="/admin/member.html?id=${p.memberId}" class="fw-semibold text-decoration-none">${p.memberName}</a></td>
      <td class="small"><div>${p.product}</div>${p.detail ? html`<div class="text-secondary">${p.detail}</div>` : ''}</td><td class="small">${METHOD_LABELS[p.method]}</td>
      <td class="small text-secondary">${p.reference || '—'}</td><td class="small">${p.recordedByName || '—'}</td>
      <td class="text-end font-tabular">${krw(p.amountKrw)}</td><td>${badge('payment', p.status)}</td>
      <td class="text-end text-nowrap">
        ${p.status === 'pending' ? html`<button class="btn btn-sm btn-success" data-status="paid" data-id="${p.paymentId}">Paid</button>
          <button class="btn btn-sm btn-outline-danger" data-status="failed" data-id="${p.paymentId}">Failed</button>` : ''}
        ${p.status === 'paid' ? html`<button class="btn btn-sm btn-outline-secondary" data-status="refunded" data-id="${p.paymentId}">Refund</button>` : ''}
      </td></tr>`)}</tbody></table>` : emptyState('receipt', 'No payments match.'));
}

let timer;
filters.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const k of Object.keys(state)) state[k] = filters.elements[k].value.trim();
    load();
  }, 250);
});
filters.addEventListener('submit', (e) => e.preventDefault());

$('#table').addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-status]');
  if (!btn) return;
  const status = btn.dataset.status;
  const ok = await confirmDialog({
    title: { paid: 'Mark as received?', failed: 'Mark as failed?', refunded: 'Refund this payment?' }[status],
    body: 'The database checks that the change is allowed (trigger trg_payments_bu).',
    confirmText: 'Confirm',
    variant: status === 'paid' ? 'success' : 'danger',
  });
  if (!ok) return;
  try {
    await api(`/admin/payments/${btn.dataset.id}`, { method: 'PATCH', body: { status } });
    toast('Payment updated');
    await load();
  } catch (err) { showError(err); }
});

await load();
