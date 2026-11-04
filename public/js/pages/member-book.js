import {
  api, initPage, html, render, toast, showError, avatar, emptyState, fmtDate, fmtRange, isoDate, todayIso,
  busy, modal, queryParam, krw, $, $$,
} from '../app.js';

await initPage({ role: 'member' });

const MAX_DAYS_AHEAD = 60;
const REASONS = {
  taken: 'Booked',
  you_are_busy: 'You have a session then',
  too_soon: 'Too soon',
  too_far: 'Too far ahead',
};

const trainers = await api('/trainers');
const state = {
  trainerId: Number(queryParam('trainer')) || trainers[0]?.trainerId,
  date: isoDate(new Date(Date.now() + 86400000)),
  duration: 60,
  slot: null,
  price: null,
};

render('#page', html`
  <h1 class="page-title h3 mb-1">Book a personal-training session</h1>
  <p class="page-subtitle mb-4">Choose a trainer, a day and a length, then pick a free time. Each session is paid when you book it.</p>
  <div class="row g-4">
    <div class="col-lg-4">
      <div class="card">
        <div class="card-header">1. Trainer</div>
        <div class="list-group list-group-flush" id="trainerPick">
          ${trainers.map((t) => html`
            <button type="button" class="list-group-item list-group-item-action d-flex gap-3 align-items-center py-3 trainer-option" data-trainer="${t.trainerId}">
              ${avatar(t.name, t.trainerId)}
              <span class="lh-sm text-start"><span class="fw-semibold d-block">${t.name}</span>
                <span class="small text-brand">${t.specialization}</span><br>
                <span class="small text-secondary">${krw(t.hourlyRateKrw)}/hour · ${[...new Set(t.hours.map((h) => h.dayName.slice(0, 3)))].join(' · ')}</span></span>
            </button>`)}
        </div>
      </div>
    </div>
    <div class="col-lg-8">
      <div class="card mb-4">
        <div class="card-header">2. Day and length</div>
        <div class="card-body">
          <div class="row g-3 align-items-end">
            <div class="col-sm-5">
              <label class="form-label" for="date">Day</label>
              <input type="date" class="form-control" id="date" min="${todayIso()}" max="${isoDate(new Date(Date.now() + MAX_DAYS_AHEAD * 86400000))}">
            </div>
            <div class="col-sm-4">
              <label class="form-label" for="duration">Length</label>
              <select class="form-select" id="duration">
                <option value="30">30 minutes</option>
                <option value="60" selected>60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
            </div>
            <div class="col-sm-3 d-flex gap-1">
              <button class="btn btn-light flex-fill" id="prevDay" title="Previous day"><i class="bi bi-chevron-left"></i></button>
              <button class="btn btn-light flex-fill" id="nextDay" title="Next day"><i class="bi bi-chevron-right"></i></button>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span>3. Time</span><span class="small fw-semibold text-brand" id="priceInfo"></span>
        </div>
        <div class="card-body" id="slots"></div>
      </div>
    </div>
  </div>

  <div class="modal fade" id="confirmModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title"><i class="bi bi-shield-lock me-2 text-brand"></i>Pay and book</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div id="confirmSummary" class="mb-3"></div>
        <label class="form-label" for="memberNote">Note for the trainer <span class="text-secondary small">(optional)</span></label>
        <textarea class="form-control" id="memberNote" rows="2" maxlength="255" placeholder="e.g. focus on lower back"></textarea>
        <div class="form-text">Cancel online up to 12 hours before and you get a full refund.</div>
        <div class="alert alert-info small py-2 mt-3 mb-0"><i class="bi bi-info-circle me-1"></i>Demo checkout: no real card is charged.</div>
      </div>
      <div class="modal-footer justify-content-between">
        <button class="btn btn-link text-danger px-0" id="declineBtn">Simulate a declined card</button>
        <button class="btn btn-primary" id="bookBtn"><i class="bi bi-lock-fill me-1"></i>Pay and book</button>
      </div>
    </div></div>
  </div>`);

$('#date').value = state.date;

function selectTrainer() {
  $$('.trainer-option').forEach((el) => el.classList.toggle('selected', Number(el.dataset.trainer) === state.trainerId));
}

async function loadSlots() {
  selectTrainer();
  render('#slots', html`<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>`);
  try {
    const data = await api(`/member/trainers/${state.trainerId}/slots`, { query: { date: state.date, duration: state.duration } });
    const e = data.eligibility;
    state.price = data.priceKrw;
    $('#priceInfo').textContent = `${krw(data.priceKrw)} per ${data.duration}-minute session`;

    if (!e.eligible) {
      render('#slots', html`<div class="alert alert-warning mb-0 d-flex gap-2 align-items-center">
        <i class="bi bi-exclamation-triangle-fill"></i><div class="flex-grow-1">${e.reason}</div>
        <a class="btn btn-sm btn-outline-primary" href="/member/membership.html">Membership</a></div>`);
      return;
    }
    if (!data.windows.length) {
      render('#slots', emptyState('moon-stars', `${data.trainer.name} does not work on ${fmtDate(state.date)}. Try another day.`));
      return;
    }
    const free = data.slots.filter((s) => s.available).length;
    render('#slots', html`
      <p class="small text-secondary mb-3">${data.trainer.name} works ${data.windows.map((w) => `${w.startTime}–${w.endTime}`).join(' and ')}
        on ${fmtDate(state.date)} · <strong>${free}</strong> free start time${free === 1 ? '' : 's'}</p>
      <div class="slot-grid">
        ${data.slots.map((s) => (s.available
    ? html`<button class="btn btn-outline-primary" data-slot="${s.time}" data-end="${s.endTime}">${s.time}</button>`
    : html`<button class="btn btn-light text-secondary unavailable" disabled title="${REASONS[s.reason]}">${s.time}</button>`))}
      </div>
      ${free ? '' : html`<div class="mt-3">${emptyState('calendar-x', 'No free times on this day. Try another day or a shorter session.')}</div>`}`);
  } catch (err) {
    render('#slots', html`<div class="alert alert-danger mb-0">${err.message}</div>`);
  }
}

$('#trainerPick').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-trainer]');
  if (!btn) return;
  state.trainerId = Number(btn.dataset.trainer);
  loadSlots();
});

$('#date').addEventListener('change', (event) => {
  if (!event.target.value) return;
  state.date = event.target.value;
  loadSlots();
});
$('#duration').addEventListener('change', (event) => {
  state.duration = Number(event.target.value);
  loadSlots();
});
for (const [id, delta] of [['#prevDay', -1], ['#nextDay', 1]]) {
  $(id).addEventListener('click', () => {
    const [y, m, d] = state.date.split('-').map(Number);
    const next = isoDate(new Date(y, m - 1, d + delta));
    if (next < todayIso()) return;
    state.date = next;
    $('#date').value = next;
    loadSlots();
  });
}

$('#slots').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-slot]');
  if (!btn) return;
  const trainer = trainers.find((t) => t.trainerId === state.trainerId);
  state.slot = btn.dataset.slot;
  render('#confirmSummary', html`<div class="d-flex gap-3 align-items-center p-3 rounded bg-brand-soft">
    ${avatar(trainer.name, trainer.trainerId)}
    <div class="flex-grow-1"><div class="fw-semibold">${fmtRange(`${state.date} ${state.slot}`, `${state.date} ${btn.dataset.end}`)}</div>
      <div class="small">${state.duration} minutes with ${trainer.name} · ${trainer.specialization}</div></div>
    <div class="fs-5 fw-bold">${krw(state.price)}</div></div>`);
  $('#bookBtn').innerHTML = `<i class="bi bi-lock-fill me-1"></i>Pay ${krw(state.price)} and book`;
  $('#memberNote').value = '';
  modal('#confirmModal').show();
});

async function book(simulateFailure, button) {
  await busy(button, async () => {
    try {
      const s = await api('/member/bookings', {
        method: 'POST',
        body: {
          trainerId: state.trainerId,
          startsAt: `${state.date} ${state.slot}`,
          duration: state.duration,
          memberNote: $('#memberNote').value.trim() || null,
          simulateFailure,
        },
      });
      modal('#confirmModal').hide();
      toast(`Paid ${krw(s.priceKrw)} and booked ${fmtRange(s.startsAt, s.endsAt)} with ${s.trainerName}`);
      await loadSlots();
    } catch (err) {
      modal('#confirmModal').hide();
      showError(err);
      await loadSlots();
    }
  });
}
$('#bookBtn').addEventListener('click', (e) => book(false, e.currentTarget));
$('#declineBtn').addEventListener('click', (e) => book(true, e.currentTarget));

await loadSlots();
