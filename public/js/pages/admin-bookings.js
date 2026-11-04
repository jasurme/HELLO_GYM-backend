import {
  api, initPage, html, render, emptyState, toast, showError, confirmDialog, isoDate, todayIso, $,
} from '../app.js';
import { sessionList } from '../components.js';
import { bookForMemberDialog } from '../admin-common.js';

await initPage({ role: 'admin' });

const trainers = await api('/trainers');
const state = { from: todayIso(), to: isoDate(new Date(Date.now() + 7 * 86400000)), trainerId: '', status: '', search: '' };

render('#page', html`
  <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
    <div><h1 class="page-title h3 mb-1">Bookings</h1><p class="page-subtitle mb-0">All personal-training sessions. The desk can book at short notice.</p></div>
    <button class="btn btn-primary" id="bookBtn"><i class="bi bi-calendar-plus me-1"></i>Book for a member</button>
  </div>
  <div class="card mb-3"><div class="card-body"><form class="row g-2 align-items-end" id="filters">
    <div class="col-sm-6 col-lg-3"><label class="form-label small mb-1">Search</label><input class="form-control form-control-sm" name="search" placeholder="Member or trainer"></div>
    <div class="col-sm-6 col-lg-2"><label class="form-label small mb-1">Trainer</label><select class="form-select form-select-sm" name="trainerId">
      <option value="">All trainers</option>${trainers.map((t) => html`<option value="${t.trainerId}">${t.name}</option>`)}</select></div>
    <div class="col-sm-4 col-lg-2"><label class="form-label small mb-1">Status</label><select class="form-select form-select-sm" name="status">
      <option value="">Any</option><option value="booked">Booked</option><option value="completed">Completed</option><option value="no_show">No-show</option><option value="cancelled">Cancelled</option></select></div>
    <div class="col-sm-4 col-lg-2"><label class="form-label small mb-1">From</label><input type="date" class="form-control form-control-sm" name="from"></div>
    <div class="col-sm-4 col-lg-2"><label class="form-label small mb-1">To</label><input type="date" class="form-control form-control-sm" name="to"></div>
  </form></div></div>
  <div class="card" id="list"></div>`);

const filters = $('#filters');
for (const [k, v] of Object.entries(state)) filters.elements[k].value = v;

async function load() {
  const rows = await api('/admin/bookings', { query: state });
  render('#list', rows.length
    ? html`<div class="card-header small text-secondary">${rows.length} session${rows.length === 1 ? '' : 's'}</div>${sessionList([...rows].reverse(), { viewer: 'admin' })}`
    : emptyState('calendar-x', 'No sessions match.'));
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

$('#list').addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-cancel]');
  if (!btn) return;
  const ok = await confirmDialog({ title: 'Cancel this session?', body: 'The member is refunded automatically (trigger trg_bookings_au).', confirmText: 'Cancel session', variant: 'danger' });
  if (!ok) return;
  try {
    await api(`/admin/bookings/${btn.dataset.cancel}/cancel`, { method: 'POST' });
    toast('Session cancelled');
    await load();
  } catch (err) { showError(err); }
});

$('#bookBtn').addEventListener('click', () => bookForMemberDialog({ onDone: load }));

await load();
