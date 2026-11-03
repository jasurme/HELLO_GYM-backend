import {
  api, initPage, html, render, emptyState, fmtDate, todayIso, toast, showError, confirmDialog, $,
} from '../app.js';
import { sessionList, markSession } from '../components.js';

const user = await initPage({ role: 'trainer' });

function kpi(icon, color, value, label) {
  return html`<div class="col-6 col-lg-3"><div class="card kpi h-100"><div class="d-flex gap-3 align-items-center">
    <div class="kpi-icon bg-${color}-subtle text-${color}-emphasis"><i class="bi bi-${icon}"></i></div>
    <div><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div></div></div></div>`;
}

async function load() {
  const { today, toMark, stats, hours } = await api('/trainer/overview');
  const byDay = {};
  for (const h of hours) (byDay[h.dayName] ||= []).push(`${h.startTime}–${h.endTime}`);

  render('#page', html`
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
      <div><h1 class="page-title h3 mb-1">Hello, ${user.firstName}</h1>
        <p class="page-subtitle mb-0">${fmtDate(todayIso())} · here is your day.</p></div>
      <a class="btn btn-outline-primary" href="/trainer/availability.html"><i class="bi bi-clock me-1"></i>Edit my hours</a>
    </div>
    <div class="row g-3 mb-4">
      ${kpi('calendar-event', 'primary', stats.next7Days, 'sessions in the next 7 days')}
      ${kpi('check2-circle', 'success', stats.completedThisMonth, 'completed this month')}
      ${kpi('person-x', 'warning', stats.noShowsThisMonth, 'no-shows this month')}
      ${kpi('people', 'info', stats.activeMembers, 'members (last 90 days)')}
    </div>
    <div class="row g-4">
      <div class="col-lg-7">
        ${toMark.length ? html`<div class="card mb-4 border border-warning">
          <div class="card-header text-warning-emphasis"><i class="bi bi-exclamation-circle me-2"></i>Needs marking (${toMark.length})</div>
          ${sessionList(toMark, { viewer: 'trainer' })}</div>` : ''}
        <div class="card">
          <div class="card-header d-flex justify-content-between"><span><i class="bi bi-calendar-day me-2 text-brand"></i>Today's sessions</span>
            <a class="small" href="/trainer/sessions.html">All sessions</a></div>
          ${today.length ? sessionList(today, { viewer: 'trainer' }) : emptyState('cup-hot', 'No sessions today.')}
        </div>
      </div>
      <div class="col-lg-5">
        <div class="card">
          <div class="card-header"><i class="bi bi-clock me-2 text-brand"></i>My weekly hours</div>
          <ul class="list-group list-group-flush">
            ${Object.keys(byDay).length ? Object.entries(byDay).map(([day, slots]) => html`
              <li class="list-group-item d-flex justify-content-between"><span class="fw-semibold">${day}</span><span class="font-tabular">${slots.join(', ')}</span></li>`)
    : html`<li class="list-group-item">${emptyState('clock', 'No hours set. Members cannot book you yet.')}</li>`}
          </ul>
        </div>
      </div>
    </div>`);
}

$('#page').addEventListener('click', async (event) => {
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
