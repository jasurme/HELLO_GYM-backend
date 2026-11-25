import {
  api, initPage, html, render, emptyState, toast, showError, confirmDialog, $, $$,
} from '../app.js';
import { sessionList, markSession } from '../components.js';

await initPage({ role: 'trainer' });

const state = { scope: 'upcoming', from: '', to: '' };

render('#page', html`
  <h1 class="page-title h3 mb-1">Sessions</h1>
  <p class="page-subtitle mb-4">Mark past sessions as completed or no-show.</p>
  <div class="card mb-3"><div class="card-body d-flex flex-wrap gap-3 align-items-end">
    <ul class="nav nav-pills me-auto" id="tabs">
      <li class="nav-item"><button class="nav-link active" data-scope="upcoming">Upcoming</button></li>
      <li class="nav-item"><button class="nav-link" data-scope="to_mark">To mark</button></li>
      <li class="nav-item"><button class="nav-link" data-scope="past">Past &amp; cancelled</button></li>
    </ul>
    <div><label class="form-label small mb-1">From</label><input type="date" class="form-control form-control-sm" id="from"></div>
    <div><label class="form-label small mb-1">To</label><input type="date" class="form-control form-control-sm" id="to"></div>
  </div></div>
  <div class="card" id="list"></div>`);

async function load() {
  const sessions = await api('/trainer/sessions', { query: { scope: state.scope, from: state.from, to: state.to } });
  render('#list', sessions.length
    ? html`<div class="card-header small text-secondary">${sessions.length} session${sessions.length === 1 ? '' : 's'}</div>${sessionList(sessions, { viewer: 'trainer' })}`
    : emptyState('calendar-x', 'No sessions match.'));
}

$('#tabs').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-scope]');
  if (!btn) return;
  state.scope = btn.dataset.scope;
  $$('#tabs .nav-link').forEach((el) => el.classList.toggle('active', el === btn));
  load();
});
for (const id of ['from', 'to']) {
  $(`#${id}`).addEventListener('change', (event) => { state[id] = event.target.value; load(); });
}

$('#list').addEventListener('click', async (event) => {
  const mark = event.target.closest('[data-mark]');
  if (mark) {
    await markSession(mark.dataset.id, mark.dataset.mark, { onDone: load });
    return;
  }
  const cancel = event.target.closest('[data-cancel]');
  if (cancel) {
    const ok = await confirmDialog({ title: 'Cancel this session?', body: 'The member will see it as cancelled.', confirmText: 'Cancel session', variant: 'danger' });
    if (!ok) return;
    try {
      await api(`/trainer/sessions/${cancel.dataset.cancel}/cancel`, { method: 'POST' });
      toast('Session cancelled');
      await load();
    } catch (err) { showError(err); }
  }
});

await load();
