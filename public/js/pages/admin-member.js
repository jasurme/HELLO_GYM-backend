import {
  api, initPage, html, render, badge, krw, fmtDate, fmtDateTime, emptyState, formModal, toast, showError,
  confirmDialog, queryParam, METHOD_LABELS, monthLabel, $,
} from '../app.js';
import { sessionList, personCell } from '../components.js';
import {
  sellPlanDialog, recordPaymentDialog, freezeDialog, bookForMemberDialog,
} from '../admin-common.js';

await initPage({ role: 'admin' });

const memberId = Number(queryParam('id'));
let data;

async function load() {
  data = await api(`/admin/members/${memberId}`);
  const p = data.profile;
  const name = `${p.firstName} ${p.lastName}`;
  document.title = `${name} · BinaryFit`;
  const live = data.subscriptions.filter((s) => ['active', 'frozen', 'pending_payment', 'upcoming'].includes(s.status));

  render('#page', html`
    <a href="/admin/members.html" class="small text-decoration-none"><i class="bi bi-arrow-left me-1"></i>All members</a>
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 my-3">
      ${personCell(name, p.userId, html`${p.email} · ${p.phone || 'no phone'}`)}
      <div class="d-flex flex-wrap gap-2">
        <button class="btn btn-outline-secondary" data-action="edit"><i class="bi bi-pencil me-1"></i>Edit</button>
        <button class="btn ${p.isActive ? 'btn-outline-danger' : 'btn-outline-success'}" data-action="toggle">
          ${p.isActive ? 'Deactivate account' : 'Reactivate account'}</button>
        <button class="btn btn-outline-primary" data-action="book" ${p.isActive ? '' : 'disabled'}><i class="bi bi-calendar-plus me-1"></i>Book trainer</button>
        <button class="btn btn-primary" data-action="sell" ${p.isActive ? '' : 'disabled'}><i class="bi bi-plus-lg me-1"></i>Sell plan</button>
      </div>
    </div>
    ${p.isActive ? '' : html`<div class="alert alert-secondary">Deactivated: cannot log in or book.</div>`}

    <div class="row g-4">
      <div class="col-xl-8">
        <div class="card mb-4">
          <div class="card-header">Subscriptions</div>
          ${data.subscriptions.length ? html`<div class="table-responsive"><table class="table align-middle mb-0">
            <thead><tr><th>Plan</th><th>Period</th><th class="text-end">Price</th><th class="text-end">Paid</th><th>Status</th><th></th></tr></thead>
            <tbody>${data.subscriptions.map((s) => html`<tr>
              <td><div class="fw-semibold">${s.planName}</div><div class="small text-secondary">#${s.subscriptionId}</div></td>
              <td class="small">${fmtDate(s.startDate)}<br>${fmtDate(s.endDate)}</td>
              <td class="text-end font-tabular">${krw(s.priceKrw)}</td>
              <td class="text-end font-tabular">${krw(s.paidKrw)}${s.balanceKrw > 0 && s.status !== 'cancelled' ? html`<div class="small text-danger">${krw(s.balanceKrw)} due</div>` : ''}</td>
              <td>${badge('membership', s.status)}</td>
              <td class="text-end">${live.includes(s) ? html`<div class="dropdown">
                <button class="btn btn-sm btn-light dropdown-toggle" data-bs-toggle="dropdown">Actions</button>
                <ul class="dropdown-menu dropdown-menu-end">
                  ${s.balanceKrw > 0 ? html`<li><button class="dropdown-item" data-sub-action="pay" data-id="${s.subscriptionId}"><i class="bi bi-cash me-2"></i>Record payment</button></li>` : ''}
                  ${['active', 'upcoming', 'frozen'].includes(s.status) ? html`<li><button class="dropdown-item" data-sub-action="freeze" data-id="${s.subscriptionId}"><i class="bi bi-snow me-2"></i>Freeze</button></li>` : ''}
                  <li><hr class="dropdown-divider"></li>
                  <li><button class="dropdown-item text-danger" data-sub-action="cancel" data-id="${s.subscriptionId}"><i class="bi bi-x-octagon me-2"></i>Cancel subscription</button></li>
                </ul></div>` : ''}</td>
            </tr>`)}</tbody></table></div>` : emptyState('journal', 'No subscriptions yet. Use "Sell plan".')}
        </div>

        <div class="card mb-4">
          <div class="card-header">Payments</div>
          ${data.payments.length ? html`<div class="table-responsive"><table class="table align-middle mb-0">
            <thead><tr><th>Date</th><th>For</th><th>Method</th><th>Reference</th><th class="text-end">Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>${data.payments.map((pay) => html`<tr>
              <td class="small">${fmtDateTime(pay.paidAt || pay.createdAt)}</td><td class="small"><div>${pay.product}</div>${pay.detail ? html`<div class="text-secondary">${pay.detail}</div>` : ''}</td>
              <td class="small">${METHOD_LABELS[pay.method]}</td><td class="small text-secondary">${pay.reference || '—'}</td>
              <td class="text-end font-tabular">${krw(pay.amountKrw)}</td><td>${badge('payment', pay.status)}</td>
              <td class="text-end text-nowrap">
                ${pay.status === 'pending' ? html`<button class="btn btn-sm btn-success" data-pay-status="paid" data-id="${pay.paymentId}">Paid</button>
                  <button class="btn btn-sm btn-outline-danger" data-pay-status="failed" data-id="${pay.paymentId}">Failed</button>` : ''}
                ${pay.status === 'paid' ? html`<button class="btn btn-sm btn-outline-secondary" data-pay-status="refunded" data-id="${pay.paymentId}">Refund</button>` : ''}
              </td></tr>`)}</tbody></table></div>` : emptyState('receipt', 'No payments yet.')}
        </div>

        <div class="card">
          <div class="card-header">Recent sessions</div>
          ${data.bookings.length ? sessionList(data.bookings, { viewer: 'member' }) : emptyState('calendar-x', 'No sessions yet.')}
        </div>
      </div>

      <div class="col-xl-4">
        <div class="card mb-4"><div class="card-header">Profile</div>
          <ul class="list-group list-group-flush small">
            <li class="list-group-item d-flex justify-content-between"><span class="text-secondary">Member since</span><span>${fmtDate(p.member.joinedOn)}</span></li>
            <li class="list-group-item d-flex justify-content-between"><span class="text-secondary">Date of birth</span><span>${p.member.dateOfBirth ? fmtDate(p.member.dateOfBirth) : '—'}</span></li>
            <li class="list-group-item d-flex justify-content-between"><span class="text-secondary">Emergency contact</span>
              <span class="text-end">${p.member.emergencyContactName || '—'}<br>${p.member.emergencyContactPhone || ''}</span></li>
            <li class="list-group-item d-flex justify-content-between"><span class="text-secondary">Account created</span><span>${fmtDateTime(p.createdAt)}</span></li>
          </ul></div>
        <div class="card mb-4"><div class="card-header">Training sessions per month</div>
          <ul class="list-group list-group-flush small">${data.usage.length ? data.usage.map((u) => html`
            <li class="list-group-item d-flex justify-content-between"><span>${monthLabel(u.month)}</span><span class="fw-semibold">${u.sessionsUsed}</span></li>`)
    : html`<li class="list-group-item text-secondary">No sessions yet</li>`}</ul></div>
        <div class="card"><div class="card-header">Freezes</div>
          <ul class="list-group list-group-flush small">${data.freezes.length ? data.freezes.map((f) => html`
            <li class="list-group-item d-flex justify-content-between align-items-center">
              <span>${fmtDate(f.freezeStart)} → ${fmtDate(f.freezeEnd)}<br><span class="text-secondary">${f.reason || ''}</span></span>
              <button class="btn btn-sm btn-link text-danger" data-unfreeze="${f.freezeId}" title="Remove (future freezes only)"><i class="bi bi-trash"></i></button></li>`)
    : html`<li class="list-group-item text-secondary">No freezes</li>`}</ul></div>
      </div>
    </div>`);
}

const findSub = (id) => data.subscriptions.find((s) => s.subscriptionId === Number(id));

$('#page').addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const subAction = event.target.closest('[data-sub-action]');
  const payStatus = event.target.closest('[data-pay-status]');
  const unfreeze = event.target.closest('[data-unfreeze]');
  try {
    if (action === 'sell') await sellPlanDialog(memberId, { onDone: load });
    else if (action === 'book') await bookForMemberDialog({ memberId, onDone: load });
    else if (action === 'edit') editProfile();
    else if (action === 'toggle') {
      const activate = !data.profile.isActive;
      const ok = await confirmDialog({
        title: activate ? 'Reactivate this account?' : 'Deactivate this account?',
        body: activate ? 'The member will be able to log in again.' : 'The member will be logged out and cannot log in or book. All records are kept.',
        confirmText: activate ? 'Reactivate' : 'Deactivate',
        variant: activate ? 'success' : 'danger',
      });
      if (!ok) return;
      await api(`/admin/members/${memberId}`, { method: 'PATCH', body: { isActive: activate } });
      toast(activate ? 'Account reactivated' : 'Account deactivated');
      await load();
    } else if (subAction) {
      const sub = findSub(subAction.dataset.id);
      if (subAction.dataset.subAction === 'pay') recordPaymentDialog(sub, { onDone: load });
      if (subAction.dataset.subAction === 'freeze') freezeDialog(sub, { onDone: load });
      if (subAction.dataset.subAction === 'cancel') {
        const result = await confirmDialog({
          title: `Cancel ${sub.planName}?`,
          body: 'Booked future sessions in this period are cancelled automatically (database trigger).',
          confirmText: 'Cancel subscription',
          variant: 'danger',
          extra: sub.paidKrw > 0 ? html`<div class="form-check mt-3"><input class="form-check-input" type="checkbox" id="refundBox">
            <label class="form-check-label" for="refundBox">Refund the ${krw(sub.paidKrw)} paid</label></div>` : '',
        });
        if (!result) return;
        const refund = $('#refundBox', result.form)?.checked || false;
        const r = await api(`/admin/subscriptions/${sub.subscriptionId}/cancel`, { method: 'POST', body: { refund } });
        toast(`Cancelled. ${r.cancelledSessions} future session(s) cancelled${r.refundedKrw ? `, ${krw(r.refundedKrw)} refunded` : ''}.`);
        await load();
      }
    } else if (payStatus) {
      const status = payStatus.dataset.payStatus;
      const ok = await confirmDialog({
        title: { paid: 'Mark payment as received?', failed: 'Mark payment as failed?', refunded: 'Refund this payment?' }[status],
        body: status === 'refunded' ? 'The membership will show as not fully paid afterwards.' : 'This updates the payment record.',
        confirmText: 'Confirm',
        variant: status === 'paid' ? 'success' : 'danger',
      });
      if (!ok) return;
      await api(`/admin/payments/${payStatus.dataset.id}`, { method: 'PATCH', body: { status } });
      toast('Payment updated');
      await load();
    } else if (unfreeze) {
      const ok = await confirmDialog({ title: 'Remove this freeze?', body: 'The frozen days are taken off the end date again.', confirmText: 'Remove', variant: 'danger' });
      if (!ok) return;
      await api(`/admin/freezes/${unfreeze.dataset.unfreeze}`, { method: 'DELETE' });
      toast('Freeze removed');
      await load();
    }
  } catch (err) {
    showError(err);
  }
});

function editProfile() {
  const p = data.profile;
  formModal({
    title: 'Edit member',
    body: html`<div class="row g-3">
      <div class="col-sm-6"><label class="form-label">First name</label><input class="form-control" name="firstName" value="${p.firstName}"></div>
      <div class="col-sm-6"><label class="form-label">Last name</label><input class="form-control" name="lastName" value="${p.lastName}"></div>
      <div class="col-sm-6"><label class="form-label">Email</label><input class="form-control" name="email" type="email" value="${p.email}"></div>
      <div class="col-sm-6"><label class="form-label">Phone</label><input class="form-control" name="phone" value="${p.phone || ''}"></div>
      <div class="col-sm-6"><label class="form-label">Date of birth</label><input class="form-control" type="date" name="dateOfBirth" value="${p.member.dateOfBirth || ''}"></div>
      <div class="col-sm-6"></div>
      <div class="col-sm-6"><label class="form-label">Emergency contact</label><input class="form-control" name="emergencyContactName" value="${p.member.emergencyContactName || ''}"></div>
      <div class="col-sm-6"><label class="form-label">Emergency phone</label><input class="form-control" name="emergencyContactPhone" value="${p.member.emergencyContactPhone || ''}"></div>
    </div>`,
    onSubmit: async (values) => {
      await api(`/admin/members/${memberId}`, { method: 'PATCH', body: values });
      toast('Member updated');
      await load();
    },
  });
}

await load();
