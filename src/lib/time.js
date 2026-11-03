// Local wall-clock helpers. The gym, Node (TZ) and MySQL sessions all run on
// the same zone, and DATETIME values travel as "YYYY-MM-DD HH:mm:ss" strings.
const pad = (n) => String(n).padStart(2, '0');

const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const formatDateTime = (d) => `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// "2026-11-07", "2026-11-07 11:30", "2026-11-07T11:30:00" → local Date
function parseLocal(value) {
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) || date.getMonth() !== Number(mo) - 1 ? null : date;
}

const now = () => formatDateTime(new Date());
const today = () => formatDate(new Date());
const addMinutes = (d, minutes) => new Date(d.getTime() + minutes * 60000);
const addDays = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds());

// Same rule as MySQL `date + INTERVAL n MONTH`: clamp to the month's last day.
function addMonths(d, months) {
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
}

// ISO-8601 weekday: 1 = Monday … 7 = Sunday (matches trainer_availability)
const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1;

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

module.exports = {
  formatDate, formatDateTime, parseLocal, now, today, addMinutes, addDays, addMonths, isoWeekday, toMinutes, fromMinutes,
};
