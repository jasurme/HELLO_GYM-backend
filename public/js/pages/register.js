import { api, busy, formValues, showFieldErrors, clearFieldErrors, $, queryParam } from '../app.js';

const plan = queryParam('plan');

$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  clearFieldErrors(form);
  await busy(event.submitter, async () => {
    try {
      await api('/auth/register', { method: 'POST', body: formValues(form) });
      window.location.href = `/member/membership.html${plan ? `?plan=${encodeURIComponent(plan)}` : ''}`;
    } catch (err) {
      showFieldErrors(form, err);
    }
  });
});
