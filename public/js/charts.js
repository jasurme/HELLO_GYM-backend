// Chart.js helpers (Chart is loaded globally from /vendor/chart.js).
/* global Chart */
import { krw, monthLabel } from './app.js';

const BRAND = '#4338ca';
const PALETTE = ['#4338ca', '#10b981', '#f59e0b', '#0ea5e9', '#ef4444', '#8b5cf6', '#ec4899'];
const compactKrw = (v) => (v >= 1e6 ? `₩${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `₩${Math.round(v / 1e3)}K` : `₩${v}`);

Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.color = '#6b7280';
Chart.defaults.plugins.legend.labels.boxWidth = 12;

const charts = new Map();
function draw(canvas, config) {
  charts.get(canvas)?.destroy();
  const chart = new Chart(canvas, config);
  charts.set(canvas, chart);
  return chart;
}

// Monthly revenue bars (collected) with refunds as a second series.
export function revenueChart(canvas, trend) {
  return draw(canvas, {
    type: 'bar',
    data: {
      labels: trend.map((r) => monthLabel(r.month)),
      datasets: [
        { label: 'Collected', data: trend.map((r) => r.revenueKrw), backgroundColor: BRAND, borderRadius: 6, maxBarThickness: 36 },
        { label: 'Refunded', data: trend.map((r) => r.refundedKrw), backgroundColor: '#fca5a5', borderRadius: 6, maxBarThickness: 36 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${krw(c.raw)}` } } },
      scales: { y: { ticks: { callback: compactKrw }, grid: { color: '#eef0f4' } }, x: { grid: { display: false } } },
    },
  });
}

export function planDoughnut(canvas, byPlan) {
  const rows = byPlan.filter((p) => p.activeMembers > 0);
  return draw(canvas, {
    type: 'doughnut',
    data: {
      labels: rows.map((p) => p.planName),
      datasets: [{ data: rows.map((p) => p.activeMembers), backgroundColor: PALETTE, borderWidth: 2 }],
    },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } },
  });
}

export function trainerBars(canvas, rows) {
  return draw(canvas, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.trainerName),
      datasets: [
        { label: 'Completed', data: rows.map((r) => r.completed), backgroundColor: '#10b981', borderRadius: 4 },
        { label: 'No-show', data: rows.map((r) => r.noShows), backgroundColor: '#f59e0b', borderRadius: 4 },
        { label: 'Booked', data: rows.map((r) => r.booked), backgroundColor: BRAND, borderRadius: 4 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: { x: { stacked: true, grid: { color: '#eef0f4' } }, y: { stacked: true, grid: { display: false } } },
    },
  });
}
