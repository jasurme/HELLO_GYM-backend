import {
  api, initPage, html, render, emptyState, formModal, toast, showError, confirmDialog, fmtDate, queryParam, DAY_NAMES, $,
} from '../app.js';
import { sessionList, personCell } from '../components.js';

await initPage({ role: 'admin' });

const trainerId = Number(queryParam('id'));
let data;

const TIMES = [];
for (let m = 5 * 60; m <= 23 * 60; m += 30) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`);

async function load() {
  data = await api(`/admin/trainers/${trainerId}`);
  const p = data.profile;
  const s = data.stats;
  const name = `${p.firstName} ${p.lastName}`;
  document.title = `${name} · BinaryFit`;

  render('#page', html`
    <a href="/admin/trainers.html" class="small text-decoration-none"><i class="bi bi-arrow-left me-1"></i>All trainers</a>
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 my-3">
      ${personCell(name, p.userId, html`${p.trainer.specialization} · ${p.email}`)}
      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary" data-action="edit"><i class="bi bi-pencil me-1"></i>Edit</button>
        <button class="btn ${p.isActive ? 'btn-outline-danger' : 'btn-outline-success'}" data-action="toggle">${p.isActive ? 'Deactivate' : 'Reactivate'}</button>
      </div>
    </div>
    ${p.isActive ? '' : html`<div class="alert alert-secondary">Deactivated: hidden from members, cannot log in or be booked.</div>`}
    <div class="row g-3 mb-4">
      ${[['Upcoming', s.upcoming], ['Completed', s.completed], ['No-shows', s.noShows], ['Hours delivered', s.hoursDelivered], ['Members', s.distinctMembers]].map(([l, v]) => html`
        <div class="col"><div class="card kpi"><div class="kpi-value">${v}</div><div class="kpi-label">${l}</div></div></div>`)}
    </div>
    <div class="row g-4">
      <div class="col-lg-5">
        <div class="card mb-4"><div class="card-header">Weekly hours</div>
          <ul class="list-group list-group-flush">${data.hours.length ? data.hours.map((h) => html`
            <li class="list-group-item d-flex justify-content-between align-items-center">
              <span><span class="fw-semibold">${h.dayName}</span> <span class="font-tabular ms-2">${h.startTime}–${h.endTime}</span></span>
              <button class="btn btn-sm btn-link text-danger" data-remove="${h.availabilityId}"><i class="bi bi-x-circle"></i></button></li>`)
    : html`<li class="list-group-item">${emptyState('clock', 'No hours yet: members cannot book this trainer.')}</li>`}
          </ul>
          <div class="card-body border-top">
            <form id="addForm" class="row g-2 align-items-end">
              <div class="col-12 col-sm-4"><select class="form-select form-select-sm" name="dayOfWeek">${DAY_NAMES.slice(1).map((d, i) => html`<option value="${i + 1}">${d}</option>`)}</select></div>
              <div class="col-5 col-sm-3"><select class="form-select form-select-sm" name="startTime">${TIMES.map((t) => html`<option ${t === '09:00' ? 'selected' : ''}>${t}</option>`)}</select></div>
              <div class="col-5 col-sm-3"><select class="form-select form-select-sm" name="endTime">${TIMES.map((t) => html`<option ${t === '13:00' ? 'selected' : ''}>${t}</option>`)}</select></div>
              <div class="col-2"><button class="btn btn-sm btn-primary w-100"><i class="bi bi-plus-lg"></i></button></div>
            </form>
          </div>
        </div>
        <div class="card"><div class="card-header">Profile</div><div class="card-body small">
          <p class="mb-2">${p.trainer.bio || html`<span class="text-secondary">No bio</span>`}</p>
          <div class="text-secondary">Hired ${fmtDate(p.trainer.hiredOn)} · ${p.phone || 'no phone'}</div></div></div>
      </div>
      <div class="col-lg-7"><div class="card"><div class="card-header">Upcoming sessions</div>
        ${data.upcoming.length ? sessionList(data.upcoming, { viewer: 'trainer', actions: false }) : emptyState('calendar-x', 'Nothing booked.')}</div></div>
    </div>`);

  $('#addForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = event.target;
    try {
      await api(`/admin/trainers/${trainerId}/availability`, {
        method: 'POST',
        body: { dayOfWeek: Number(f.dayOfWeek.value), startTime: f.startTime.value, endTime: f.endTime.value },
      });
      toast('Window added');
      await load();
    } catch (err) { showError(err); }
  });
}

$('#page').addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const remove = event.target.closest('[data-remove]');
  try {
    if (remove) {
      const ok = await confirmDialog({ title: 'Remove this window?', body: 'Already booked sessions are kept.', confirmText: 'Remove', variant: 'danger' });
      if (!ok) return;
      await api(`/admin/trainers/${trainerId}/availability/${remove.dataset.remove}`, { method: 'DELETE' });
      toast('Window removed');
      await load();
    } else if (action === 'toggle') {
      const activate = !data.profile.isActive;
      const ok = await confirmDialog({
        title: activate ? 'Reactivate trainer?' : 'Deactivate trainer?',
        body: activate ? 'Members can book this trainer again.' : 'Members can no longer book this trainer. Existing sessions are kept.',
        confirmText: activate ? 'Reactivate' : 'Deactivate',
        variant: activate ? 'success' : 'danger',
      });
      if (!ok) return;
      await api(`/admin/trainers/${trainerId}`, { method: 'PATCH', body: { isActive: activate } });
      await load();
    } else if (action === 'edit') {
      const p = data.profile;
      formModal({
        title: 'Edit trainer',
        body: html`<div class="row g-3">
          <div class="col-sm-6"><label class="form-label">First name</label><input class="form-control" name="firstName" value="${p.firstName}"></div>
          <div class="col-sm-6"><label class="form-label">Last name</label><input class="form-control" name="lastName" value="${p.lastName}"></div>
          <div class="col-sm-6"><label class="form-label">Email</label><input class="form-control" name="email" value="${p.email}"></div>
          <div class="col-sm-6"><label class="form-label">Phone</label><input class="form-control" name="phone" value="${p.phone || ''}"></div>
          <div class="col-sm-6"><label class="form-label">Specialization</label><input class="form-control" name="specialization" value="${p.trainer.specialization}"></div>
          <div class="col-sm-6"><label class="form-label">Hired on</label><input class="form-control" type="date" name="hiredOn" value="${p.trainer.hiredOn}"></div>
          <div class="col-12"><label class="form-label">Bio</label><textarea class="form-control" name="bio" rows="3" maxlength="500">${p.trainer.bio || ''}</textarea></div>
        </div>`,
        onSubmit: async (values) => {
          await api(`/admin/trainers/${trainerId}`, { method: 'PATCH', body: values });
          toast('Trainer updated');
          await load();
        },
      });
    }
  } catch (err) { showError(err); }
});

await load();
