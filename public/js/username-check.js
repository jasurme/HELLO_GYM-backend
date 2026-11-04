// Live "is this @username free?" check, used on sign-up and profile settings.
import { api, html, render } from './app.js';

// Wires `input` and its status line; returns a function that resolves to
// true once the current value is confirmed available. `initial` (a value or
// a function) is the user's own current username, which always counts as free.
export function wireUsernameCheck(input, statusEl, { initial = null } = {}) {
  let timer;
  let seq = 0;
  let result = null;
  const hint = statusEl.innerHTML;

  const show = (res) => {
    result = res;
    input.classList.toggle('is-valid', Boolean(res?.available));
    input.classList.toggle('is-invalid', Boolean(res && !res.available));
    if (!res) { statusEl.innerHTML = hint; return; }
    render(statusEl, res.available
      ? html`<span class="ok"><i class="bi bi-check-circle-fill me-1"></i>@${res.username} is available</span>`
      : html`<span class="bad"><i class="bi bi-x-circle-fill me-1"></i>${res.reason}</span>
        ${res.suggestions.length ? html`<div>${res.suggestions.map((s) => html`<button type="button" class="username-suggestion" data-pick="${s}">@${s}</button>`)}</div>` : ''}`);
  };

  const check = async () => {
    const value = input.value.trim().toLowerCase().replace(/^@/, '');
    if (!value) { show(null); return null; }
    const own = typeof initial === 'function' ? initial() : initial;   // your current name is fine
    if (own && value === own) { show({ username: value, available: true, suggestions: [] }); return result; }
    const mine = ++seq;
    render(statusEl, html`<span class="text-secondary"><span class="spinner-border spinner-border-sm me-1"></span>Checking @${value}…</span>`);
    const res = await api('/auth/username', { query: { username: value } });
    if (mine === seq) show(res);
    return res;
  };

  input.addEventListener('input', () => {
    // Usernames are lowercase, without spaces or '@'.
    const cleaned = input.value.toLowerCase().replace(/\s+/g, '').replace(/^@/, '');
    if (cleaned !== input.value) input.value = cleaned;
    clearTimeout(timer);
    timer = setTimeout(check, 300);
  });
  statusEl.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-pick]');
    if (!pick) return;
    input.value = pick.dataset.pick;
    check();
  });

  return async () => {
    clearTimeout(timer);
    const res = await check();
    return Boolean(res?.available);
  };
}

// first.last from a name, as a starting suggestion.
export function suggestFromName(first, last) {
  const part = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  return [part(first), part(last)].filter(Boolean).join('.').slice(0, 30);
}
