import { api, initPage, html, render, emptyState, fmtDateTime, $ } from '../app.js';
import { personCell } from '../components.js';

await initPage({ role: 'trainer' });

const members = await api('/trainer/members');

render('#page', html`
  <h1 class="page-title h3 mb-1">My members</h1>
  <p class="page-subtitle mb-4">Everyone you have trained or will train, with their next session first.</p>
  <div class="card">
    <div class="card-header d-flex gap-2 align-items-center">
      <input class="form-control form-control-sm w-auto" id="filter" placeholder="Search by name…">
      <span class="small text-secondary ms-auto" id="count"></span>
    </div>
    <div class="table-responsive" id="table"></div>
  </div>`);

function draw(filter = '') {
  const rows = members.filter((m) => m.memberName.toLowerCase().includes(filter.toLowerCase()));
  $('#count').textContent = `${rows.length} member${rows.length === 1 ? '' : 's'}`;
  render('#table', rows.length ? html`<table class="table table-hover align-middle mb-0">
    <thead><tr><th>Member</th><th>Membership</th><th class="text-end">Sessions</th><th class="text-end">No-shows</th><th>Last session</th><th>Next session</th></tr></thead>
    <tbody>${rows.map((m) => html`<tr>
      <td>${personCell(m.memberName, m.memberId, m.phone || m.email)}</td>
      <td class="small">${m.membership || html`<span class="text-secondary">No active plan</span>`}</td>
      <td class="text-end">${m.completed} / ${m.sessions}</td>
      <td class="text-end">${m.noShows}</td>
      <td class="small">${m.lastSession ? fmtDateTime(m.lastSession) : '—'}</td>
      <td class="small">${m.nextSession ? html`<span class="badge bg-primary-subtle text-primary-emphasis">${fmtDateTime(m.nextSession)}</span>` : '—'}</td>
    </tr>`)}</tbody></table>` : emptyState('people', 'No members yet.'));
}

$('#filter').addEventListener('input', (event) => draw(event.target.value));
draw();
