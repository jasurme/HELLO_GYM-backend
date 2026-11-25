import {
  api, initPage, html, render, toast, showError, confirmDialog, emptyState, fmtRange, krw, queryParam, $,
} from '../app.js';
import { membershipCard, sessionList } from '../components.js';

const user = await initPage({ role: 'member' });

async function load() {
  const data = await api('/member/overview');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const { current, eligibility, unpaid, upcoming } = data;

  let actions = html`<a class="btn btn-light text-brand fw-semibold" href="/member/book.html"><i class="bi bi-calendar-plus me-1"></i>Book a trainer</a>`;
  if (!current) actions = html`<a class="btn btn-light text-brand fw-semibold" href="/member/membership.html">Renew membership</a>`;
  else if (current.status === 'pending_payment') actions = html`<a class="btn btn-warning fw-semibold" href="/member/membership.html#pay">Pay ${krw(current.balanceKrw)}</a>`;
  else if (current.status === 'frozen') actions = '';

  render('#page', html`
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
      <div>
        <h1 class="page-title h3 mb-1">${greeting}, ${user.firstName}</h1>
        <p class="page-subtitle mb-0">Your membership and next sessions.</p>
      </div>
      <a class="btn btn-primary" href="/member/book.html"><i class="bi bi-calendar-plus me-1"></i>Book a trainer</a>
    </div>

    ${queryParam('welcome') ? html`<div class="alert alert-success d-flex align-items-center gap-2">
      <i class="bi bi-stars"></i><div>Welcome to BinaryFit! Your <strong>${current?.planName}</strong> membership is paid and active.
      Want a personal trainer? Book one any time; each session is paid when you book it.</div></div>` : ''}

    ${unpaid.length ? html`<div class="alert alert-warning d-flex align-items-center gap-2">
      <i class="bi bi-exclamation-triangle-fill"></i>
      <div class="flex-grow-1">Your <strong>${unpaid[0].planName}</strong> membership is waiting for payment of <strong>${krw(unpaid[0].balanceKrw)}</strong>.</div>
      <a class="btn btn-sm btn-warning" href="/member/membership.html#pay">Pay now</a></div>` : ''}
    ${!eligibility.eligible && !unpaid.length ? html`<div class="alert alert-info d-flex align-items-center gap-2">
      <i class="bi bi-info-circle-fill"></i><div class="flex-grow-1">${eligibility.reason}</div>
      <a class="btn btn-sm btn-outline-primary" href="/member/membership.html">Membership</a></div>` : ''}

    <div class="row g-4">
      <div class="col-lg-5">${membershipCard(data, { actions })}</div>
      <div class="col-lg-7">
        <div class="card h-100">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-calendar-week me-2 text-brand"></i>Upcoming sessions</span>
            <a class="small" href="/member/bookings.html">See all</a>
          </div>
          ${upcoming.length ? sessionList(upcoming) : emptyState('calendar-x', 'No training sessions booked. Trainers are optional and paid per session.')}
        </div>
      </div>
    </div>`);
}

$('#page').addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-cancel]');
  if (!btn) return;
  const id = btn.dataset.cancel;
  const ok = await confirmDialog({
    title: 'Cancel this session?',
    body: 'You get a full refund of what you paid for it.',
    confirmText: 'Cancel session',
    variant: 'danger',
  });
  if (!ok) return;
  try {
    const s = await api(`/member/bookings/${id}/cancel`, { method: 'POST' });
    toast(`Cancelled ${fmtRange(s.startsAt, s.endsAt)} with ${s.trainerName}`);
    await load();
  } catch (err) {
    showError(err);
  }
});

await load();
