import {
  api, initPage, html, render, krw, formModal, toast, showError, confirmDialog, emptyState, $,
} from '../app.js';

await initPage({ role: 'admin' });

let plans = [];

render('#page', html`
  <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">
    <div><h1 class="page-title h3 mb-1">Membership plans</h1>
      <p class="page-subtitle mb-0">Price changes apply to new sales only: sold subscriptions keep their agreed price.</p></div>
    <button class="btn btn-primary" id="newBtn"><i class="bi bi-plus-lg me-1"></i>New plan</button>
  </div>
  <div class="card"><div class="table-responsive" id="table"></div></div>`);

async function load() {
  plans = await api('/admin/plans');
  render('#table', plans.length ? html`<table class="table align-middle mb-0">
    <thead><tr><th>Plan</th><th class="text-end">Months</th><th class="text-end">Price</th><th class="text-end">Per month</th>
      <th class="text-end">Active members</th><th class="text-end">Times sold</th><th>On sale</th><th></th></tr></thead>
    <tbody>${plans.map((p) => html`<tr class="${p.isActive ? '' : 'text-secondary'}">
      <td><div class="fw-semibold">${p.planName}</div><div class="small text-secondary">${p.description || ''}</div></td>
      <td class="text-end">${p.durationMonths}</td><td class="text-end font-tabular">${krw(p.priceKrw)}</td>
      <td class="text-end font-tabular small">${krw(p.priceKrw / p.durationMonths)}</td>
      <td class="text-end">${p.activeMembers}</td><td class="text-end">${p.timesSold}</td>
      <td><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-toggle="${p.planId}" ${p.isActive ? 'checked' : ''}></div></td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-light" data-edit="${p.planId}"><i class="bi bi-pencil"></i></button>
        ${p.timesSold === 0 ? html`<button class="btn btn-sm btn-light text-danger" data-delete="${p.planId}"><i class="bi bi-trash"></i></button>` : ''}
      </td></tr>`)}</tbody></table>` : emptyState('card-list', 'No plans yet.'));
}

function planForm(plan = {}) {
  formModal({
    title: plan.planId ? `Edit ${plan.planName}` : 'New plan',
    body: html`<div class="row g-3">
      <div class="col-12"><label class="form-label">Name</label><input class="form-control" name="planName" value="${plan.planName || ''}"></div>
      <div class="col-12"><label class="form-label">Description</label><input class="form-control" name="description" maxlength="255" value="${plan.description || ''}"></div>
      <div class="col-sm-6"><label class="form-label">Months</label><input class="form-control" type="number" name="durationMonths" min="1" max="24" value="${plan.durationMonths || 1}"></div>
      <div class="col-sm-6"><label class="form-label">Price (KRW)</label><input class="form-control" type="number" name="priceKrw" min="1000" step="1000" value="${plan.priceKrw || ''}"></div>
      <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="isActive" id="isActive" ${plan.isActive === false ? '' : 'checked'}>
        <label class="form-check-label" for="isActive">On sale</label></div></div>
    </div>`,
    onSubmit: async (values) => {
      if (plan.planId) await api(`/admin/plans/${plan.planId}`, { method: 'PATCH', body: values });
      else await api('/admin/plans', { method: 'POST', body: values });
      toast(plan.planId ? 'Plan updated' : 'Plan created');
      await load();
    },
  });
}

$('#newBtn').addEventListener('click', () => planForm());
$('#table').addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-edit]');
  const del = event.target.closest('[data-delete]');
  if (edit) planForm(plans.find((p) => p.planId === Number(edit.dataset.edit)));
  if (del) {
    const ok = await confirmDialog({ title: 'Delete this plan?', body: 'Only plans that were never sold can be deleted.', confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await api(`/admin/plans/${del.dataset.delete}`, { method: 'DELETE' });
      toast('Plan deleted');
      await load();
    } catch (err) { showError(err); }
  }
});
$('#table').addEventListener('change', async (event) => {
  const toggle = event.target.closest('[data-toggle]');
  if (!toggle) return;
  try {
    await api(`/admin/plans/${toggle.dataset.toggle}`, { method: 'PATCH', body: { isActive: toggle.checked } });
    toast(toggle.checked ? 'Plan is on sale' : 'Plan is no longer on sale');
    await load();
  } catch (err) { showError(err); }
});

await load();
