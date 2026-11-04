import { api, html, render, krw, avatar, $ } from '../app.js';

const [plans, trainers, me] = await Promise.all([
  api('/plans'),
  api('/trainers'),
  api('/auth/me').catch(() => null),
]);

if (me) {
  render('#authLinks', html`<a class="btn btn-light btn-sm text-brand fw-semibold" href="/${me.role}/">
    <i class="bi bi-speedometer2 me-1"></i>Go to my dashboard</a>`);
}

$('#statTrainers').textContent = trainers.length;
$('#statPlans').textContent = plans.length;
if (trainers.length) $('#statPt').textContent = krw(Math.min(...trainers.map((t) => t.hourlyRateKrw)) / 2);

// The longest plan is the cheapest per month.
const best = plans.reduce((a, p) => (!a || p.durationMonths > a.durationMonths ? p : a), null);
const perMonth = (p) => krw(p.priceKrw / p.durationMonths);
render('#planList', plans.map((p) => html`
  <div class="col-md-6 col-lg-3">
    <div class="card plan-card h-100 ${p === best ? 'featured' : ''}">
      <div class="card-body d-flex flex-column">
        ${p === best ? html`<span class="badge text-bg-primary align-self-start mb-2">Best value</span>` : ''}
        <h5 class="fw-bold">${p.planName}</h5>
        <div class="price">${krw(p.priceKrw)}</div>
        <div class="text-secondary small mb-3">${perMonth(p)} a month</div>
        <p class="small flex-grow-1">${p.description}</p>
        <ul class="list-unstyled small mb-4">
          <li><i class="bi bi-check2 text-success me-1"></i>Gym floor, cardio &amp; free weights</li>
          <li><i class="bi bi-check2 text-success me-1"></i>Lockers and showers</li>
          <li><i class="bi bi-plus text-brand me-1"></i>Book trainers any time, pay per session</li>
        </ul>
        <a href="/register.html?plan=${p.planId}" class="btn ${p === best ? 'btn-primary' : 'btn-outline-primary'}">Choose ${p.planName}</a>
      </div>
    </div>
  </div>`));

render('#trainerList', trainers.map((t) => html`
  <div class="col-md-6 col-lg-4">
    <div class="card h-100">
      <div class="card-body">
        <div class="d-flex align-items-center gap-3 mb-3">
          ${avatar(t.name, t.trainerId)}
          <div class="flex-grow-1"><h6 class="mb-0 fw-bold">${t.name}</h6><span class="small text-brand">${t.specialization}</span></div>
          <div class="text-end lh-sm"><div class="fw-bold">${krw(t.hourlyRateKrw)}</div><div class="small text-secondary">per hour</div></div>
        </div>
        <p class="small text-secondary">${t.bio}</p>
        <div class="d-flex flex-wrap gap-1">${t.hours.map((h) => html`<span class="badge bg-brand-soft text-brand fw-normal">${h.dayName.slice(0, 3)} ${h.startTime}–${h.endTime}</span>`)}</div>
      </div>
    </div>
  </div>`));
