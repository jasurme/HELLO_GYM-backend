import {
  api, initPage, html, render, toast, showError, confirmDialog, emptyState, fmtRange, $,
} from '../app.js';
import { sessionList } from '../components.js';

await initPage({ role: 'member' });

let scope = 'upcoming';

render('#page', html`
  <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
    <div><h1 class="page-title h3 mb-1">My sessions</h1>
      <p class="page-subtitle mb-0">Your personal-training sessions, upcoming and past.</p></div>
    <a class="btn btn-primary" href="/member/book.html"><i class="bi bi-calendar-plus me-1"></i>Book a session</a>
  </div>
  <ul class="nav nav-pills mb-3" id="tabs">
    <li class="nav-item"><button class="nav-link active" data-scope="upcoming">Upcoming</button></li>
    <li class="nav-item"><button class="nav-link" data-scope="past">Past &amp; cancelled</button></li>
  </ul>
  <div class="card" id="list"></div>`);

async function load() {
  const sessions = await api('/member/bookings', { query: { scope } });
  render('#list', sessions.length
    ? sessionList(sessions)
    : emptyState('calendar-x', scope === 'upcoming' ? 'No upcoming sessions.' : 'No past sessions yet.'));
}

$('#tabs').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-scope]');
  if (!btn) return;
  scope = btn.dataset.scope;
  document.querySelectorAll('#tabs .nav-link').forEach((el) => el.classList.toggle('active', el === btn));
  load();
});

$('#list').addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-cancel]');
  if (!btn) return;
  const ok = await confirmDialog({
    title: 'Cancel this session?',
    body: 'The session goes back into your monthly quota.',
    confirmText: 'Cancel session',
    variant: 'danger',
  });
  if (!ok) return;
  try {
    const s = await api(`/member/bookings/${btn.dataset.cancel}/cancel`, { method: 'POST' });
    toast(`Cancelled ${fmtRange(s.startsAt, s.endsAt)}`);
    await load();
  } catch (err) {
    showError(err);
  }
});

await load();
