import {
  api, initPage, html, render, toast, showError, confirmDialog, busy, formValues, DAY_NAMES, $,
} from '../app.js';

await initPage({ role: 'trainer' });

// Half-hour options 05:00–23:00 for the time pickers.
const TIMES = [];
for (let m = 5 * 60; m <= 23 * 60; m += 30) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`);
const timeOptions = (selected) => TIMES.map((t) => html`<option ${t === selected ? 'selected' : ''}>${t}</option>`);

render('#page', html`
  <h1 class="page-title h3 mb-1">Weekly availability</h1>
  <p class="page-subtitle mb-4">Members can book only inside these hours. Same-day windows cannot overlap.</p>
  <div class="card mb-4"><div class="card-body">
    <form id="addForm" class="row g-3 align-items-end">
      <div class="col-sm-4 col-lg-3"><label class="form-label">Day</label>
        <select class="form-select" name="dayOfWeek">${DAY_NAMES.slice(1).map((d, i) => html`<option value="${i + 1}">${d}</option>`)}</select></div>
      <div class="col-6 col-sm-3 col-lg-2"><label class="form-label">From</label><select class="form-select" name="startTime">${timeOptions('09:00')}</select></div>
      <div class="col-6 col-sm-3 col-lg-2"><label class="form-label">To</label><select class="form-select" name="endTime">${timeOptions('13:00')}</select></div>
      <div class="col-sm-2 col-lg-2"><button class="btn btn-primary w-100" type="submit"><i class="bi bi-plus-lg me-1"></i>Add</button></div>
    </form>
  </div></div>
  <div class="week-grid" id="week"></div>`);

async function load() {
  const windows = await api('/trainer/availability');
  render('#week', DAY_NAMES.slice(1).map((day, i) => {
    const mine = windows.filter((w) => w.dayOfWeek === i + 1);
    const hours = mine.reduce((sum, w) => sum + (toMin(w.endTime) - toMin(w.startTime)) / 60, 0);
    return html`<div class="card"><div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-baseline mb-2"><span class="fw-semibold">${day}</span>
        <span class="small text-secondary">${hours ? `${hours} h` : 'off'}</span></div>
      <div class="d-grid gap-2">${mine.map((w) => html`<div class="window-chip">
        <span>${w.startTime}–${w.endTime}</span>
        <button class="btn btn-sm btn-link text-danger p-0" data-remove="${w.availabilityId}" title="Remove"><i class="bi bi-x-circle"></i></button></div>`)}</div>
    </div></div>`;
  }));
}
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

$('#addForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await busy(event.submitter, async () => {
    try {
      const w = await api('/trainer/availability', { method: 'POST', body: formValues(event.target) });
      toast(`Added ${w.dayName} ${w.startTime}–${w.endTime}`);
      await load();
    } catch (err) { showError(err); }
  });
});

$('#week').addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-remove]');
  if (!btn) return;
  const ok = await confirmDialog({
    title: 'Remove this window?',
    body: 'Members will no longer be able to book these hours. Sessions already booked are kept.',
    confirmText: 'Remove', variant: 'danger',
  });
  if (!ok) return;
  try {
    const { upcomingSessionsInWindow: n } = await api(`/trainer/availability/${btn.dataset.remove}`, { method: 'DELETE' });
    toast(n ? `Removed. ${n} upcoming session${n === 1 ? ' is' : 's are'} still booked in those hours.` : 'Removed', n ? 'warning' : 'success');
    await load();
  } catch (err) { showError(err); }
});

await load();
