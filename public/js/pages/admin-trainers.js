import {
  api, initPage, html, render, emptyState, formModal, toast, num, $,
} from '../app.js';
import { personCell } from '../components.js';

await initPage({ role: 'admin' });

render('#page', html`
  <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
    <div><h1 class="page-title h3 mb-1">Trainers</h1><p class="page-subtitle mb-0">Lifetime booking figures come from the view v_trainer_booking_stats.</p></div>
    <button class="btn btn-primary" id="newBtn"><i class="bi bi-person-plus me-1"></i>New trainer</button>
  </div>
  <div class="card"><div class="table-responsive" id="table"></div></div>`);

async function load() {
  const rows = await api('/admin/trainers');
  render('#table', rows.length ? html`<table class="table table-hover align-middle mb-0">
    <thead><tr><th>Trainer</th><th>Specialization</th><th class="text-end">Weekly windows</th><th class="text-end">Upcoming</th>
      <th class="text-end">Completed</th><th class="text-end">No-shows</th><th class="text-end">Hours</th><th class="text-end">Members</th></tr></thead>
    <tbody>${rows.map((t) => html`<tr class="clickable ${t.isActive ? '' : 'text-secondary'}" data-href="/admin/trainer.html?id=${t.trainerId}">
      <td>${personCell(t.trainerName, t.trainerId, t.email)}${t.isActive ? '' : html`<span class="badge text-bg-secondary ms-2">deactivated</span>`}</td>
      <td class="small">${t.specialization}</td>
      <td class="text-end">${t.windows}</td><td class="text-end">${t.upcoming}</td><td class="text-end">${num(t.completed)}</td>
      <td class="text-end">${t.noShows}</td><td class="text-end">${t.hoursDelivered}</td><td class="text-end">${t.distinctMembers}</td>
    </tr>`)}</tbody></table>` : emptyState('person-badge', 'No trainers yet.'));
}

$('#table').addEventListener('click', (event) => {
  const row = event.target.closest('[data-href]');
  if (row) window.location.href = row.dataset.href;
});

$('#newBtn').addEventListener('click', () => formModal({
  title: 'New trainer',
  submitText: 'Create trainer',
  body: html`<div class="row g-3">
    <div class="col-sm-6"><label class="form-label">First name</label><input class="form-control" name="firstName"></div>
    <div class="col-sm-6"><label class="form-label">Last name</label><input class="form-control" name="lastName"></div>
    <div class="col-sm-6"><label class="form-label">Email</label><input class="form-control" name="email" type="email"></div>
    <div class="col-sm-6"><label class="form-label">Phone</label><input class="form-control" name="phone" type="tel"></div>
    <div class="col-sm-6"><label class="form-label">Specialization</label><input class="form-control" name="specialization" placeholder="e.g. Strength & Conditioning"></div>
    <div class="col-sm-6"><label class="form-label">Hired on</label><input class="form-control" name="hiredOn" type="date"></div>
    <div class="col-12"><label class="form-label">Bio</label><textarea class="form-control" name="bio" rows="2" maxlength="500"></textarea></div>
    <div class="col-sm-6"><label class="form-label">Temporary password</label><input class="form-control" name="password"></div>
  </div>`,
  onSubmit: async (values) => {
    const t = await api('/admin/trainers', { method: 'POST', body: values });
    toast(`${t.firstName} ${t.lastName} was added. Set their weekly hours next.`);
    window.location.href = `/admin/trainer.html?id=${t.userId}`;
  },
}));

await load();
