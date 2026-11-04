import { api, busy, $, queryParam } from '../app.js';

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
