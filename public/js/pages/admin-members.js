import {
  api, initPage, html, render, badge, fmtDate, krw, emptyState, formModal, toast, queryParam, $,
} from '../app.js';
import { personCell } from '../components.js';

await initPage({ role: 'admin' });

const state = { search: '', status: queryParam('status') || '' };

render('#page', html`
  <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
    <div><h1 class="page-title h3 mb-1">Members</h1><p class="page-subtitle mb-0">Everyone with a member account and their current membership.</p></div>
    <button class="btn btn-primary" id="newBtn"><i class="bi bi-person-plus me-1"></i>New member</button>
  </div>
  <div class="card">
    <div class="card-header d-flex flex-wrap gap-2 align-items-center">
      <div class="input-group input-group-sm" style="max-width:320px"><span class="input-group-text"><i class="bi bi-search"></i></span>
        <input class="form-control" id="search" placeholder="Name, email or phone"></div>
      <select class="form-select form-select-sm w-auto" id="status">
        <option value="">All members</option>
        <option value="active">Active</option><option value="frozen">Frozen</option><option value="pending_payment">Awaiting payment</option>
        <option value="upcoming">Starting soon</option><option value="expired">Expired</option><option value="none">No membership</option>
        <option value="inactive">Deactivated accounts</option>
      </select>
      <span class="small text-secondary ms-auto" id="count"></span>
    </div>
    <div class="table-responsive" id="table"></div>
  </div>`);

$('#status').value = state.status;

async function load() {
  const rows = await api('/admin/members', { query: state });
  $('#count').textContent = `${rows.length} member${rows.length === 1 ? '' : 's'}`;
  render('#table', rows.length ? html`<table class="table table-hover align-middle mb-0">
    <thead><tr><th>Member</th><th>Phone</th><th>Joined</th><th>Plan</th><th>Status</th><th>Ends</th><th class="text-end">Balance</th></tr></thead>
    <tbody>${rows.map((m) => html`<tr class="clickable ${m.isActive ? '' : 'text-secondary'}" data-href="/admin/member.html?id=${m.memberId}">
      <td>${personCell(`${m.firstName} ${m.lastName}`, m.memberId, m.email)}${m.isActive ? '' : html`<span class="badge text-bg-secondary ms-2">deactivated</span>`}</td>
      <td class="small">${m.phone || '—'}</td>
      <td class="small">${fmtDate(m.joinedOn)}</td>
      <td class="small">${m.planName || '—'}</td>
      <td>${badge('membership', m.membershipStatus)}</td>
      <td class="small">${m.endDate ? fmtDate(m.endDate) : '—'}</td>
      <td class="text-end font-tabular">${m.balanceKrw > 0 ? html`<span class="text-danger fw-semibold">${krw(m.balanceKrw)}</span>` : '—'}</td>
    </tr>`)}</tbody></table>` : emptyState('people', 'No members match.'));
}

let timer;
$('#search').addEventListener('input', (event) => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.search = event.target.value.trim(); load(); }, 250);
});
$('#status').addEventListener('change', (event) => { state.status = event.target.value; load(); });
$('#table').addEventListener('click', (event) => {
  const row = event.target.closest('[data-href]');
  if (row) window.location.href = row.dataset.href;
});

function newMember() {
  formModal({
    title: 'New member',
    submitText: 'Create member',
    body: html`<div class="row g-3">
      <div class="col-sm-6"><label class="form-label">First name</label><input class="form-control" name="firstName" required></div>
      <div class="col-sm-6"><label class="form-label">Last name</label><input class="form-control" name="lastName" required></div>
      <div class="col-sm-6"><label class="form-label">Email</label><input class="form-control" name="email" type="email" required></div>
      <div class="col-sm-6"><label class="form-label">Phone</label><input class="form-control" name="phone" type="tel" placeholder="010-1234-5678"></div>
      <div class="col-sm-6"><label class="form-label">Date of birth</label><input class="form-control" name="dateOfBirth" type="date"></div>
      <div class="col-sm-6"><label class="form-label">Temporary password</label><input class="form-control" name="password" required>
        <div class="form-text">The member can change it after logging in.</div></div>
      <div class="col-sm-6"><label class="form-label">Emergency contact</label><input class="form-control" name="emergencyContactName"></div>
      <div class="col-sm-6"><label class="form-label">Emergency phone</label><input class="form-control" name="emergencyContactPhone" type="tel"></div>
    </div>`,
    onSubmit: async (values) => {
      const member = await api('/admin/members', { method: 'POST', body: values });
      toast(`${member.firstName} ${member.lastName} was added`);
      window.location.href = `/admin/member.html?id=${member.userId}`;
    },
  });
}
$('#newBtn').addEventListener('click', newMember);
if (queryParam('new')) newMember();

await load();
