import {
  api, html, render, busy, formValues, showFieldErrors, clearFieldErrors, krw, fmtDate, isoDate, $, $$, queryParam,
  paymentComplete,
} from '../app.js';
import { wireUsernameCheck, suggestFromName } from '../username-check.js';
import { cardFields, wireCard, readCard } from '../card-form.js';

// Three steps, one request at the end: the account, the membership and its
// payment are created together, so nobody joins without a paid plan.
const state = { details: null, planId: Number(queryParam('plan')) || null, plans: [] };

function show(step) {
  $$('[data-panel]').forEach((el) => { el.hidden = el.dataset.panel !== String(step); });
  $$('#steps li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-back]').forEach((btn) => btn.addEventListener('click', () => show(Number(btn.dataset.back))));

// ---- Step 1: details (checked by the server before moving on) ----------
// Live @username check as you type; a first.last suggestion once the name is in.
const usernameOk = wireUsernameCheck($('#username'), $('#usernameStatus'));
for (const id of ['#firstName', '#lastName']) {
  $(id).addEventListener('blur', () => {
    const input = $('#username');
    const guess = suggestFromName($('#firstName').value, $('#lastName').value);
    if (!input.value && guess.length >= 3) {
      input.value = guess;
      input.dispatchEvent(new Event('input'));
    }
  });
}

$('#detailsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  clearFieldErrors(form);
  const details = formValues(form);
  await busy(event.submitter, async () => {
    if (!(await usernameOk())) {
      $('#username').focus();
      return;
    }
    try {
      await api('/auth/register/check', { method: 'POST', body: details });
      state.details = details;
      show(2);
    } catch (err) {
      showFieldErrors(form, err);
    }
  });
});

// ---- Step 2: membership plan ------------------------------------------
const plural = (n) => (n === 1 ? '1 month' : `${n} months`);
function endDateFor(months) {
  const start = new Date();
  const end = new Date(start.getFullYear(), start.getMonth() + months, 1);
  end.setDate(Math.min(start.getDate(), new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()) - 1);
  return isoDate(end);
}

function drawPlans() {
  render('#planChoices', state.plans.map((p) => html`
    <div class="col-sm-6">
      <label class="card plan-choice h-100 ${p.planId === state.planId ? 'selected' : ''}">
        <input type="radio" class="visually-hidden" name="plan" value="${p.planId}" ${p.planId === state.planId ? 'checked' : ''}>
        <span class="card-body d-block">
          <span class="d-flex justify-content-between align-items-start">
            <span class="fw-bold fs-5">${p.planName}</span>
            ${p.durationMonths === 12 ? html`<span class="badge text-bg-primary">Best value</span>` : ''}
          </span>
          <span class="d-block fs-3 fw-bold">${krw(p.priceKrw)}</span>
          <span class="d-block small text-secondary">${krw(p.priceKrw / p.durationMonths)} a month · ${plural(p.durationMonths)}</span>
        </span>
      </label>
    </div>`));
}

$('#planChoices').addEventListener('change', (event) => {
  state.planId = Number(event.target.value);
  drawPlans();
});

$('#toPayment').addEventListener('click', () => {
  const plan = state.plans.find((p) => p.planId === state.planId);
  if (!plan) {
    drawPlans();
    $('#planChoices').insertAdjacentHTML('beforeend', '<div class="col-12"><div class="alert alert-warning mb-0 py-2">Please choose a membership.</div></div>');
    return;
  }
  render('#summary', html`
    <div class="p-3 rounded bg-brand-soft">
      <div class="d-flex justify-content-between"><span>${plan.planName} membership</span><span>${krw(plan.priceKrw)}</span></div>
      <div class="small text-secondary">Gym access ${fmtDate(isoDate(new Date()))} → ${fmtDate(endDateFor(plan.durationMonths))}</div>
      <div class="small text-secondary">For ${state.details.firstName} ${state.details.lastName} (@${state.details.username}) · ${state.details.email}</div>
      <hr><div class="d-flex justify-content-between fw-bold fs-5"><span>To pay now</span><span>${krw(plan.priceKrw)}</span></div>
    </div>`);
  $('#payBtn').innerHTML = `<i class="bi bi-lock-fill me-1"></i>Pay ${krw(plan.priceKrw)} and join`;
  $('#payError').classList.add('d-none');
  show(3);
});

// ---- Step 3: pay and create the account ---------------------------------
render('#cardBox', cardFields());
wireCard();

async function pay(button) {
  const error = $('#payError');
  error.classList.add('d-none');
  const card = readCard();
  if (!card) return;
  const plan = state.plans.find((p) => p.planId === state.planId);
  await busy(button, async () => {
    try {
      await api('/auth/register', { method: 'POST', body: { ...state.details, planId: state.planId, card } });
      paymentComplete({
        amount: plan.priceKrw,
        lines: [`Welcome to BinaryFit, ${state.details.firstName}!`, `Your ${plan.planName} membership is active.`],
        redirect: '/member/?welcome=1',
      });
    } catch (err) {
      if (err.fields?.email) {
        show(1);
        showFieldErrors($('#detailsForm'), err);
        return;
      }
      error.textContent = `${err.message} Your account has not been created yet.`;
      error.classList.remove('d-none');
    }
  });
}
$('#payBtn').addEventListener('click', (e) => pay(e.currentTarget));

state.plans = await api('/plans');
if (!state.plans.some((p) => p.planId === state.planId)) state.planId = state.plans[0]?.planId ?? null;
drawPlans();

const existing = await api('/auth/me').catch(() => null);
if (existing) window.location.href = `/${existing.role}/`;
