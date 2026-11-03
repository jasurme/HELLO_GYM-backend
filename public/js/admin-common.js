// Dialogs the front desk uses on several admin pages.
import {
  api, ApiError, html, render, formModal, toast, krw, fmtDate, todayIso, isoDate, emptyState, $,
} from './app.js';

const field = (label, input, hint = '') => html`<div class="mb-3"><label class="form-label">${label}</label>${input}${hint ? html`<div class="form-text">${hint}</div>` : ''}</div>`;

// Sell a plan to a member, optionally taking payment at the desk.
export async function sellPlanDialog(memberId, { onDone } = {}) {
  const plans = await api('/plans');
  const { form } = formModal({
    title: 'Sell a membership plan',
    submitText: 'Create subscription',
    body: html`
      ${field('Plan', html`<select class="form-select" name="planId">${plans.map((p) => html`<option value="${p.planId}" data-price="${p.priceKrw}">${p.planName} · ${krw(p.priceKrw)}</option>`)}</select>`)}
      <div class="row g-3">
        <div class="col-sm-6">${field('Start date', html`<input type="date" class="form-control" name="startDate">`, 'Empty: today, or the day after the current plan ends')}</div>
        <div class="col-sm-6">${field('Price (KRW)', html`<input type="number" class="form-control" name="priceKrw" min="1" step="1000">`, 'Change only for a discount')}</div>
      </div>
      <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" name="takePayment" id="takePayment" checked>
        <label class="form-check-label" for="takePayment">Take the full payment now</label></div>
      <div class="row g-3" id="paymentFields">
        <div class="col-sm-6">${field('Method', html`<select class="form-select" name="method"><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option></select>`)}</div>
        <div class="col-sm-6">${field('Receipt / reference', html`<input class="form-control" name="reference" maxlength="100" placeholder="optional">`)}</div>
      </div>`,
    onSubmit: async (v) => {
      const plan = plans.find((p) => p.planId === Number(v.planId));
      const price = v.priceKrw || plan.priceKrw;
      const sub = await api('/admin/subscriptions', {
        method: 'POST',
        body: {
          memberId,
          planId: Number(v.planId),
          startDate: v.startDate,
          priceKrw: v.priceKrw || undefined,
          payment: v.takePayment ? { amountKrw: price, method: v.method, reference: v.reference } : null,
        },
      });
      toast(`${sub.planName} sold: ${fmtDate(sub.startDate)} → ${fmtDate(sub.endDate)}`);
      await onDone?.(sub);
    },
  });
  const syncPrice = () => { form.elements.priceKrw.placeholder = form.elements.planId.selectedOptions[0].dataset.price; };
  syncPrice();
  form.elements.planId.addEventListener('change', syncPrice);
  form.elements.takePayment.addEventListener('change', (e) => $('#paymentFields', form).classList.toggle('d-none', !e.target.checked));
}

// Record a desk payment against a subscription's balance.
export function recordPaymentDialog(sub, { onDone } = {}) {
  formModal({
    title: `Record a payment · ${sub.planName}`,
    submitText: 'Record payment',
    body: html`
      <p class="small text-secondary">${sub.memberName} · price ${krw(sub.priceKrw)} · paid ${krw(sub.paidKrw)} · <strong>balance ${krw(sub.balanceKrw)}</strong></p>
      <div class="row g-3">
        <div class="col-sm-6">${field('Amount (KRW)', html`<input type="number" class="form-control" name="amountKrw" min="1" step="1000" value="${sub.balanceKrw}">`)}</div>
        <div class="col-sm-6">${field('Method', html`<select class="form-select" name="method"><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option></select>`)}</div>
        <div class="col-sm-6">${field('Status', html`<select class="form-select" name="status"><option value="paid">Paid now</option><option value="pending">Pending (e.g. transfer expected)</option></select>`)}</div>
        <div class="col-sm-6">${field('Receipt / reference', html`<input class="form-control" name="reference" maxlength="100">`)}</div>
      </div>`,
    onSubmit: async (v) => {
      await api('/admin/payments', { method: 'POST', body: { ...v, subscriptionId: sub.subscriptionId } });
      toast(`Payment of ${krw(v.amountKrw)} recorded`);
      await onDone?.();
    },
  });
}

export function freezeDialog(sub, { onDone } = {}) {
  formModal({
    title: `Freeze ${sub.memberName}'s membership`,
    submitText: 'Freeze',
    body: html`
      <p class="small text-secondary">The frozen days are added to the end date (now ${fmtDate(sub.endDate)}). Booked sessions inside the freeze must be cancelled first.</p>
      <div class="row g-3">
        <div class="col-sm-6">${field('First frozen day', html`<input type="date" class="form-control" name="freezeStart" min="${todayIso()}" value="${todayIso()}">`)}</div>
        <div class="col-sm-6">${field('Number of days', html`<input type="number" class="form-control" name="days" min="1" max="60" value="14">`)}</div>
      </div>
      ${field('Reason', html`<input class="form-control" name="reason" maxlength="255" placeholder="e.g. business trip">`)}`,
    onSubmit: async (v) => {
      const updated = await api(`/admin/subscriptions/${sub.subscriptionId}/freezes`, { method: 'POST', body: v });
      toast(`Frozen. New end date: ${fmtDate(updated.endDate)}`);
      await onDone?.();
    },
  });
}

// Book a session on a member's behalf (no lead-time policy for the desk).
export async function bookForMemberDialog({ memberId = null, onDone } = {}) {
  const [trainers, members] = await Promise.all([
    api('/trainers'),
    memberId ? null : api('/admin/members', { query: { status: 'active' } }),
  ]);
  const tomorrow = isoDate(new Date(Date.now() + 86400000));
  const { form } = formModal({
    title: 'Book a session for a member',
    submitText: 'Book session',
    size: 'modal-lg',
    body: html`
      <div class="row g-3">
        ${memberId ? '' : html`<div class="col-12">${field('Member', html`<select class="form-select" name="memberId">${members.map((m) => html`<option value="${m.memberId}">${m.firstName} ${m.lastName} · ${m.planName}</option>`)}</select>`)}</div>`}
        <div class="col-sm-5">${field('Trainer', html`<select class="form-select" name="trainerId">${trainers.map((t) => html`<option value="${t.trainerId}">${t.name} · ${t.specialization}</option>`)}</select>`)}</div>
        <div class="col-sm-4">${field('Day', html`<input type="date" class="form-control" name="date" min="${todayIso()}" value="${tomorrow}">`)}</div>
        <div class="col-sm-3">${field('Length', html`<select class="form-select" name="duration"><option value="30">30 min</option><option value="60" selected>60 min</option><option value="90">90 min</option></select>`)}</div>
      </div>
      <input type="hidden" name="slot">
      <div id="slotArea" class="mt-2"></div>`,
    onSubmit: async (v) => {
      if (!v.slot) throw new ApiError('Pick a time first');
      const s = await api('/admin/bookings', {
        method: 'POST',
        body: { memberId: Number(memberId || v.memberId), trainerId: Number(v.trainerId), startsAt: `${v.date} ${v.slot}`, duration: Number(v.duration) },
      });
      toast(`Booked ${s.memberName} with ${s.trainerName}`);
      await onDone?.(s);
    },
  });

  async function loadSlots() {
    form.elements.slot.value = '';
    const area = $('#slotArea', form);
    render(area, html`<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>`);
    try {
      const data = await api('/admin/slots', {
        query: {
          trainerId: form.elements.trainerId.value,
          memberId: memberId || form.elements.memberId?.value,
          date: form.elements.date.value,
          duration: form.elements.duration.value,
        },
      });
      const e = data.eligibility;
      if (e && !e.eligible) {
        render(area, html`<div class="alert alert-warning mb-0">${e.reason}</div>`);
        return;
      }
      const free = data.slots.filter((s) => s.available || s.reason === 'too_soon');
      render(area, free.length ? html`
        ${e ? html`<p class="small text-secondary">${e.used} of ${e.quota} sessions used in ${e.month}</p>` : ''}
        <div class="slot-grid">${data.slots.map((s) => html`<button type="button" class="btn btn-sm ${s.available || s.reason === 'too_soon' ? 'btn-outline-primary' : 'btn-light text-secondary unavailable'}"
          data-slot="${s.time}" ${s.available || s.reason === 'too_soon' ? '' : 'disabled'}>${s.time}</button>`)}</div>`
        : emptyState('calendar-x', data.windows.length ? 'No free times on this day.' : `${data.trainer.name} does not work on this day.`));
    } catch (err) {
      render(area, html`<div class="alert alert-danger mb-0">${err.message}</div>`);
    }
  }

  $('#slotArea', form).addEventListener('click', (event) => {
    const btn = event.target.closest('[data-slot]');
    if (!btn) return;
    form.elements.slot.value = btn.dataset.slot;
    form.querySelectorAll('[data-slot]').forEach((b) => b.classList.toggle('active', b === btn));
  });
  for (const name of ['trainerId', 'date', 'duration', 'memberId']) form.elements[name]?.addEventListener('change', loadSlots);
  await loadSlots();
}
