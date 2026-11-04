// Small building blocks shared by several pages.
import {
  html, badge, dateChip, fmtTime, relativeDay, parseLocal, krw, fmtDate, avatar,
  api, confirmDialog, toast, showError, $,
} from './app.js';

export const CANCEL_NOTICE_HOURS = 12;

const hoursUntil = (value) => (parseLocal(value) - new Date()) / 3600000;

// " · ₩60,000 paid" / " · ₩60,000 refunded" next to a session's time.
function priceText(s) {
  if (s.priceKrw === undefined || s.priceKrw === null) return '';
  const state = { paid: 'paid', refunded: 'refunded', pending: 'unpaid', failed: 'unpaid' }[s.paymentStatus];
  return ` · ${krw(s.priceKrw)}${state ? ` ${state}` : ''}`;
}

// One training session as a list row. `viewer` decides which name is shown
// and which actions are offered: member | trainer | admin.
export function sessionItem(s, { viewer = 'member', actions = true } = {}) {
  const other = viewer === 'member'
    ? html`<i class="bi bi-person-badge me-1"></i>${s.trainerName}`
    : viewer === 'trainer'
      ? html`<i class="bi bi-person me-1"></i>${s.memberName}`
      : html`<i class="bi bi-person me-1"></i>${s.memberName} <span class="text-secondary">with</span> ${s.trainerName}`;

  const upcoming = s.status === 'booked' && hoursUntil(s.startsAt) > 0;
  const toMark = s.status === 'booked' && hoursUntil(s.startsAt) <= 0;
  let buttons = '';
  if (actions && upcoming) {
    const late = viewer === 'member' && hoursUntil(s.startsAt) < CANCEL_NOTICE_HOURS;
    buttons = late
      ? html`<span class="small text-secondary" title="Less than ${CANCEL_NOTICE_HOURS} hours to go">Call the desk to cancel</span>`
      : html`<button class="btn btn-sm btn-outline-danger" data-cancel="${s.bookingId}"><i class="bi bi-x-lg me-1"></i>Cancel</button>`;
  }
  if (actions && toMark && viewer === 'trainer') {
    buttons = html`<div class="btn-group btn-group-sm">
      <button class="btn btn-success" data-mark="completed" data-id="${s.bookingId}"><i class="bi bi-check2 me-1"></i>Completed</button>
      <button class="btn btn-outline-warning" data-mark="no_show" data-id="${s.bookingId}">No-show</button></div>`;
  }

  return html`
    <div class="list-group-item session-item status-${s.status} d-flex gap-3 align-items-center py-3">
      ${dateChip(s.startsAt)}
      <div class="flex-grow-1 min-w-0">
        <div class="fw-semibold">${fmtTime(s.startsAt)}–${fmtTime(s.endsAt)}
          <span class="text-secondary fw-normal small ms-1">${s.durationMin} min · ${relativeDay(s.startsAt)}${priceText(s)}</span></div>
        <div class="small">${other}</div>
        ${s.memberNote ? html`<div class="small text-secondary"><i class="bi bi-chat-left-text me-1"></i>${s.memberNote}</div>` : ''}
        ${s.trainerNote ? html`<div class="small text-success-emphasis"><i class="bi bi-journal-check me-1"></i>${s.trainerNote}</div>` : ''}
      </div>
      <div class="text-end d-flex flex-column align-items-end gap-2">
        ${badge('booking', s.status)}
        ${buttons}
      </div>
    </div>`;
}

export function sessionList(sessions, options) {
  return html`<div class="list-group list-group-flush">${sessions.map((s) => sessionItem(s, options))}</div>`;
}

// Gradient card summarising a member's current gym membership.
export function membershipCard({ current, next, sessionsThisMonth = 0 }, { actions = '' } = {}) {
  if (!current) {
    return html`<div class="card membership-card h-100"><div class="card-body p-4">
      <div class="text-muted-light small text-uppercase fw-semibold mb-2">Membership</div>
      <h3 class="fw-bold">No active membership</h3>
      <p class="text-muted-light">Renew to use the gym and book trainers${next ? html` (your ${next.planName} plan starts ${fmtDate(next.startDate)})` : ''}.</p>
      ${actions}
    </div></div>`;
  }
  return html`<div class="card membership-card h-100"><div class="card-body p-4">
    <div class="d-flex justify-content-between align-items-start mb-2">
      <span class="text-muted-light small text-uppercase fw-semibold">Membership</span>
      <span class="badge rounded-pill text-bg-light">${current.status.replace('_', ' ')}</span>
    </div>
    <h3 class="fw-bold mb-0">${current.planName}</h3>
    <div class="text-muted-light mb-3">${fmtDate(current.startDate)} → ${fmtDate(current.endDate)}</div>
    <div class="row g-3 mb-3">
      <div class="col-6"><div class="fs-3 fw-bold">${current.daysLeft}</div><div class="small text-muted-light">days left</div></div>
      <div class="col-6"><div class="fs-3 fw-bold">${current.balanceKrw > 0 ? krw(current.balanceKrw) : 'Paid'}</div>
        <div class="small text-muted-light">${current.balanceKrw > 0 ? 'to pay' : krw(current.priceKrw)}</div></div>
    </div>
    <div class="small text-muted-light mb-3"><i class="bi bi-person-badge me-1"></i>${sessionsThisMonth
    ? `${sessionsThisMonth} training session${sessionsThisMonth === 1 ? '' : 's'} this month`
    : 'No training sessions this month'} · trainers are paid per session</div>
    ${next ? html`<div class="small text-muted-light mb-3"><i class="bi bi-arrow-repeat me-1"></i>Next: ${next.planName} from ${fmtDate(next.startDate)} (${next.status.replace('_', ' ')})</div>` : ''}
    ${actions}
  </div></div>`;
}

export function personCell(name, id, sub) {
  return html`<div class="d-flex align-items-center gap-2">${avatar(name, id)}<div class="lh-sm"><div class="fw-semibold">${name}</div>
    ${sub ? html`<div class="small text-secondary">${sub}</div>` : ''}</div></div>`;
}

// Trainer marks a past session completed / no-show, with an optional note.
export async function markSession(bookingId, status, { onDone } = {}) {
  const label = status === 'completed' ? 'completed' : 'a no-show';
  const result = await confirmDialog({
    title: `Mark session as ${label}?`,
    body: status === 'completed' ? 'Add a short note for the member (optional).' : 'The session stays paid; no refund for a no-show.',
    confirmText: status === 'completed' ? 'Mark completed' : 'Mark no-show',
    variant: status === 'completed' ? 'success' : 'warning',
    extra: html`<textarea class="form-control mt-3" id="markNote" rows="2" maxlength="255" placeholder="e.g. Great form on squats"></textarea>`,
  });
  if (!result) return;
  const note = $('#markNote', result.form)?.value.trim();
  try {
    await api(`/trainer/sessions/${bookingId}`, {
      method: 'PATCH',
      body: { status, ...(note ? { trainerNote: note } : {}) },
    });
    toast(`Session marked as ${label}`);
    await onDone?.();
  } catch (err) {
    showError(err);
  }
}
