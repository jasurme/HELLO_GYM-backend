import { api, html, render, busy, $, queryParam } from '../app.js';

const DEMO = [
  ['admin@binaryfit.test', 'admin', 'Front desk: reports, members, payments'],
  ['daniel.park@binaryfit.test', 'trainer', 'Daniel Park: schedule and availability'],
  ['minji.kim@binaryfit.test', 'member', '6-month member, trains with Daniel weekly'],
  ['sara.ahmed@binaryfit.test', 'member', 'Joined and paid online today'],
  ['taeyang.seo@binaryfit.test', 'member', 'Gym only; renewal awaiting bank transfer'],
  ['joonho.lee@binaryfit.test', 'member', 'Expired membership: cannot book'],
  ['ethan.brooks@binaryfit.test', 'member', 'Membership frozen right now'],
];
const ROLE_COLORS = { admin: 'danger', trainer: 'success', member: 'primary' };

render('#demoAccounts', DEMO.map(([email, role, note]) => html`
  <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center px-1" data-email="${email}">
    <span><span class="fw-semibold">${email}</span><br><span class="text-secondary">${note}</span></span>
    <span class="badge bg-${ROLE_COLORS[role]}-subtle text-${ROLE_COLORS[role]}-emphasis">${role}</span>
  </button>`));

document.querySelectorAll('[data-email]').forEach((btn) => btn.addEventListener('click', () => {
  $('#email').value = btn.dataset.email;
  $('#password').value = 'Gym12345!';
  $('#password').focus();
}));

// Only follow same-site paths after login.
const next = queryParam('next');
const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

const existing = await api('/auth/me').catch(() => null);
if (existing) window.location.href = safeNext || `/${existing.role}/`;

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#loginError');
  error.classList.add('d-none');
  await busy(event.submitter, async () => {
    try {
      const user = await api('/auth/login', {
        method: 'POST',
        body: { email: $('#email').value, password: $('#password').value },
      });
      const allowed = safeNext && safeNext.startsWith(`/${user.role}/`) ? safeNext : null;
      window.location.href = allowed || (safeNext === '/profile.html' ? safeNext : `/${user.role}/`);
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('d-none');
    }
  });
});
