import { api, initPage, busy, formValues, showFieldErrors, clearFieldErrors, toast, $, $$ } from '../app.js';

await initPage();

const form = $('#profileForm');

function fill(profile) {
  const values = {
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    dateOfBirth: profile.member?.dateOfBirth,
    joinedOn: profile.member?.joinedOn,
    emergencyContactName: profile.member?.emergencyContactName,
    emergencyContactPhone: profile.member?.emergencyContactPhone,
    bio: profile.trainer?.bio,
  };
  for (const [name, value] of Object.entries(values)) if (form.elements[name]) form.elements[name].value = value ?? '';
  $$('.member-only').forEach((el) => el.classList.toggle('d-none', profile.role !== 'member'));
  $$('.trainer-only').forEach((el) => el.classList.toggle('d-none', profile.role !== 'trainer'));
  $$('.member-only input, .trainer-only textarea').forEach((el) => {
    el.disabled = el.disabled || el.closest('.d-none') !== null;
  });
}

fill(await api('/auth/me'));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(form);
  const values = formValues(form);
  delete values.joinedOn;
  await busy(event.submitter, async () => {
    try {
      fill(await api('/auth/me', { method: 'PATCH', body: values }));
      toast('Your profile was saved');
    } catch (err) {
      showFieldErrors(form, err);
    }
  });
});

$('#passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pwForm = event.target;
  clearFieldErrors(pwForm);
  await busy(event.submitter, async () => {
    try {
      await api('/auth/password', { method: 'POST', body: formValues(pwForm) });
      pwForm.reset();
      toast('Your password was changed');
    } catch (err) {
      showFieldErrors(pwForm, err);
    }
  });
});
