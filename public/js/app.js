// Shared frontend helpers: API client, auth guard, navigation, formatting,
// safe HTML templating, toasts and dialogs. Every page script imports this.
/* global bootstrap */

// ---------------------------------------------------------------------
// Safe HTML: interpolated values are escaped unless wrapped in raw().
// ---------------------------------------------------------------------
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

class Raw {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}
export const raw = (text) => new Raw(text);

function renderValue(value) {
  if (value instanceof Raw) return value.text;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value === null || value === undefined || value === false) return '';
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => { out += renderValue(value) + strings[i + 1]; });
  return new Raw(out);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function render(target, content) {
  const el = typeof target === 'string' ? $(target) : target;
  el.innerHTML = renderValue(content);
  return el;
}

// ---------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------
export class ApiError extends Error {
  constructor(message, { status, rule, fields } = {}) {
    super(message);
    this.status = status;
    this.rule = rule;
    this.fields = fields;
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  let url = `/api${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    }
    if ([...params].length) url += `?${params}`;
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiError(data?.error?.message || `Request failed (${res.status})`, {
      status: res.status, rule: data?.error?.rule, fields: data?.error?.fields,
    });
  }
  return data;
}

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------
const krwFormat = new Intl.NumberFormat('ko-KR');
export const krw = (n) => `₩${krwFormat.format(Math.round(Number(n) || 0))}`;
export const num = (n) => krwFormat.format(Number(n) || 0);

// "2026-11-07" / "2026-11-07 11:30:00" → local Date (no timezone shifting)
export function parseLocal(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoDate(new Date());

export function fmtDate(value, { year = true } = {}) {
  const d = parseLocal(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
}
export function fmtTime(value) {
  const d = parseLocal(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}
export function fmtDateTime(value) {
  const d = parseLocal(value);
  if (!d) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${fmtDate(value, { year: !sameYear })} · ${fmtTime(value)}`;
}
export function fmtRange(start, end) {
  return `${fmtDate(start, { year: false })} · ${fmtTime(start)}–${fmtTime(end)}`;
}
export function relativeDay(value) {
  const d = parseLocal(value);
  if (!d) return '';
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date().toDateString())) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

export function dateChip(value) {
  const d = parseLocal(value);
  return html`<div class="date-chip"><div class="mon">${d.toLocaleDateString('en-GB', { month: 'short' })}</div><div class="day">${d.getDate()}</div><div class="mon">${d.toLocaleDateString('en-GB', { weekday: 'short' })}</div></div>`;
}

const AVATAR_COLORS = ['#4338ca', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
export function avatar(name, id = 0, size = '') {
  const initials = String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return html`<span class="avatar ${size}" style="background:${raw(AVATAR_COLORS[id % AVATAR_COLORS.length])}">${initials}</span>`;
}

// ---------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------
const BADGES = {
  membership: {
    active: ['success', 'Active'],
    frozen: ['info', 'Frozen'],
    upcoming: ['primary', 'Upcoming'],
    pending_payment: ['warning', 'Awaiting payment'],
    expired: ['secondary', 'Expired'],
    cancelled: ['danger', 'Cancelled'],
    none: ['light', 'No membership'],
  },
  booking: {
    booked: ['primary', 'Booked'],
    completed: ['success', 'Completed'],
    no_show: ['warning', 'No-show'],
    cancelled: ['secondary', 'Cancelled'],
  },
  payment: {
    paid: ['success', 'Paid'],
    pending: ['warning', 'Pending'],
    failed: ['danger', 'Failed'],
    refunded: ['secondary', 'Refunded'],
  },
};
export function badge(kind, status) {
  const [color, label] = BADGES[kind]?.[status || 'none'] || ['secondary', status];
  return html`<span class="badge rounded-pill bg-${color}-subtle text-${color}-emphasis border border-${color}-subtle">${label}</span>`;
}
export const METHOD_LABELS = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', online: 'Online' };
export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function emptyState(icon, text) {
  return html`<div class="empty-state"><i class="bi bi-${icon}"></i>${text}</div>`;
}

// ---------------------------------------------------------------------
// Navigation and page guard
// ---------------------------------------------------------------------
const NAV = {
  member: [
    ['/member/', 'speedometer2', 'Dashboard'],
    ['/member/book.html', 'calendar-plus', 'Book a session'],
    ['/member/bookings.html', 'calendar-week', 'My sessions'],
    ['/member/membership.html', 'credit-card-2-front', 'Membership'],
    ['/social/', 'chat-heart', 'Social'],
  ],
  trainer: [
    ['/trainer/', 'speedometer2', 'Today'],
    ['/trainer/sessions.html', 'calendar-week', 'Sessions'],
    ['/trainer/availability.html', 'clock', 'Availability'],
    ['/trainer/members.html', 'people', 'My members'],
    ['/social/', 'chat-heart', 'Social'],
  ],
  admin: [
    ['/admin/', 'speedometer2', 'Dashboard'],
    ['/admin/members.html', 'people', 'Members'],
    ['/admin/trainers.html', 'person-badge', 'Trainers'],
    ['/admin/plans.html', 'card-list', 'Plans'],
    ['/admin/subscriptions.html', 'journal-check', 'Subscriptions'],
    ['/admin/payments.html', 'cash-coin', 'Payments'],
    ['/admin/bookings.html', 'calendar-week', 'Bookings'],
    ['/admin/reports.html', 'bar-chart-line', 'Reports'],
  ],
};

function renderNav(user) {
  const path = window.location.pathname.replace(/index\.html$/, '');
  const links = NAV[user.role].map(([href, icon, label]) => html`
    <li class="nav-item">
      <a class="nav-link ${path === href || (href === '/social/' && path.startsWith(href)) ? 'active' : ''}" href="${href}"><i class="bi bi-${icon} me-1"></i>${label}</a>
    </li>`);
  const nav = document.createElement('nav');
  nav.className = 'navbar navbar-expand-lg navbar-dark app-nav sticky-top';
  render(nav, html`
    <div class="container">
      <a class="navbar-brand d-flex align-items-center" href="/${user.role}/">
        <span class="brand-mark"><i class="bi bi-lightning-charge-fill"></i></span>BinaryFit
      </a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav" aria-label="Menu">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="mainNav">
        <ul class="navbar-nav me-auto mb-2 mb-lg-0 gap-lg-1">${links}</ul>
        <div class="dropdown">
          <button class="btn btn-link text-white text-decoration-none dropdown-toggle d-flex align-items-center gap-2 px-0" data-bs-toggle="dropdown">
            ${avatar(`${user.firstName} ${user.lastName}`, user.userId)}
            <span class="text-start lh-sm">
              <span class="d-block fw-semibold">${user.firstName} ${user.lastName}</span>
              <span class="role-pill">${user.role}</span>
            </span>
          </button>
          <ul class="dropdown-menu dropdown-menu-end shadow">
            <li><span class="dropdown-item-text small text-secondary">${user.email}</span></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="/profile.html"><i class="bi bi-person me-2"></i>My profile</a></li>
            <li><button class="dropdown-item" id="logoutBtn"><i class="bi bi-box-arrow-right me-2"></i>Log out</button></li>
          </ul>
        </div>
      </div>
    </div>`);
  document.body.prepend(nav);
  $('#logoutBtn').addEventListener('click', logout);
}

function renderFooter() {
  const footer = document.createElement('footer');
  footer.className = 'app-footer py-4 mt-4 border-top';
  render(footer, html`<div class="container d-flex flex-wrap justify-content-between gap-2">
    <span><i class="bi bi-lightning-charge-fill text-brand"></i> BinaryFit Gym · Membership &amp; Training Booking System</span>
    <span>Team Binary Minds · Database Design project</span>
  </div>`);
  document.body.append(footer);
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login.html';
}

// Every dashboard page starts with this: checks login and role, draws the nav.
export async function initPage({ role } = {}) {
  let user;
  try {
    user = await api('/auth/me');
  } catch {
    window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return new Promise(() => {});
  }
  const allowed = Array.isArray(role) ? role : role ? [role] : null;
  if (allowed && !allowed.includes(user.role)) {
    window.location.href = `/${user.role}/`;
    return new Promise(() => {});
  }
  renderNav(user);
  renderFooter();
  return user;
}

// ---------------------------------------------------------------------
// Feedback: toasts, confirm dialogs, busy buttons, form errors
// ---------------------------------------------------------------------
export function toast(message, variant = 'success') {
  let container = $('#toastStack');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastStack';
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    container.style.zIndex = 1100;
    document.body.append(container);
  }
  const icons = { success: 'check-circle-fill', danger: 'exclamation-octagon-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' };
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${variant} border-0`;
  el.setAttribute('role', 'status');
  render(el, html`<div class="d-flex"><div class="toast-body"><i class="bi bi-${icons[variant] || icons.info} me-2"></i>${message}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`);
  container.append(el);
  const t = new bootstrap.Toast(el, { delay: variant === 'danger' ? 7000 : 4000 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}

// Shows an API error; business-rule violations show which rule fired.
export function showError(err) {
  const rule = err.rule ? ` (${err.rule})` : '';
  toast(`${err.message}${rule}`, 'danger');
}

export function confirmDialog({ title, body, confirmText = 'Confirm', variant = 'primary', extra = '' }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'modal fade';
    el.tabIndex = -1;
    render(el, html`<div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">${title}</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">${body}${raw(String(extra))}</div>
      <div class="modal-footer">
        <button type="button" class="btn btn-light" data-bs-dismiss="modal">Back</button>
        <button type="button" class="btn btn-${variant}" data-confirm>${confirmText}</button>
      </div></div></div>`);
    document.body.append(el);
    const modal = new bootstrap.Modal(el);
    let result = false;
    $('[data-confirm]', el).addEventListener('click', () => { result = { form: el }; modal.hide(); });
    el.addEventListener('hidden.bs.modal', () => { el.remove(); resolve(result); });
    modal.show();
  });
}

export async function busy(button, fn) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${original}`;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

// Form → plain object; empty strings become null, checkboxes booleans.
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value.trim() === '' ? null : el.value.trim();
  }
  return out;
}

export function clearFieldErrors(form) {
  $$('.is-invalid', form).forEach((el) => el.classList.remove('is-invalid'));
  $$('.invalid-feedback[data-auto]', form).forEach((el) => el.remove());
}

export function showFieldErrors(form, err) {
  clearFieldErrors(form);
  if (!err.fields) return showError(err);
  let shown = false;
  for (const [field, message] of Object.entries(err.fields)) {
    const input = form.elements[field];
    if (!input) continue;
    input.classList.add('is-invalid');
    const fb = document.createElement('div');
    fb.className = 'invalid-feedback';
    fb.dataset.auto = '1';
    fb.textContent = message;
    input.after(fb);
    shown = true;
  }
  if (!shown) showError(err);
  return undefined;
}

export const modal = (selector) => bootstrap.Modal.getOrCreateInstance($(selector));
export const queryParam = (name) => new URLSearchParams(window.location.search).get(name);

// A modal with a form. onSubmit(values, form) may throw an ApiError: field
// errors are shown inline and the dialog stays open; on success it closes.
export function formModal({ title, body, submitText = 'Save', size = '', onSubmit, onShown }) {
  const el = document.createElement('div');
  el.className = 'modal fade';
  el.tabIndex = -1;
  render(el, html`<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size}">
    <form class="modal-content" novalidate>
      <div class="modal-header"><h5 class="modal-title">${title}</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer">
        <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
        <button type="submit" class="btn btn-primary">${submitText}</button>
      </div>
    </form></div>`);
  document.body.append(el);
  const form = $('form', el);
  const instance = new bootstrap.Modal(el);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const button = event.submitter || $('[type=submit]', form);
    await busy(button, async () => {
      try {
        await onSubmit(formValues(form), form);
        instance.hide();
      } catch (err) {
        if (err instanceof ApiError) showFieldErrors(form, err);
        else throw err;
      }
    });
  });
  el.addEventListener('shown.bs.modal', () => onShown?.(form, el));
  el.addEventListener('hidden.bs.modal', () => el.remove());
  instance.show();
  return { form, el, modal: instance };
}

// Full-screen "Payment complete" confirmation: an animated green check with
// the amount and what was bought, then a smooth fade into `redirect`.
export function paymentComplete({ amount, lines = [], redirect, delay = 2300 }) {
  const el = document.createElement('div');
  el.className = 'pay-success';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  render(el, html`<div class="pay-success-card">
    <svg class="pay-check" viewBox="0 0 52 52" aria-hidden="true">
      <circle class="pay-check-circle" cx="26" cy="26" r="24"></circle>
      <path class="pay-check-mark" fill="none" d="M14 27 l8 8 l16 -17"></path>
    </svg>
    <h2 class="h4 fw-bold mt-3 mb-1">Payment complete</h2>
    ${amount != null ? html`<div class="fs-3 fw-bold pay-amount">${krw(amount)}</div>` : ''}
    ${lines.map((line) => html`<div class="text-secondary">${line}</div>`)}
    <div class="small text-secondary mt-3"><span class="spinner-grow spinner-grow-sm text-success me-2"></span>Taking you to your dashboard…</div>
  </div>`);
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => {
    document.body.classList.add('page-leave');
    setTimeout(() => { window.location.href = redirect; }, 350);
  }, delay);
}
