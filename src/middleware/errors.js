const { HttpError } = require('../lib/http-error');

// Friendly text for CHECK constraints the app can hit (db/01_schema.sql).
const CHECK_MESSAGES = {
  ck_users_email: 'Enter a valid email address',
  ck_users_names: 'First and last name are required',
  ck_members_dob: 'Date of birth must be before the joining date',
  ck_plans_duration: 'Plan duration must be 1–24 months',
  ck_plans_price: 'Price must be more than 0',
  ck_plans_quota: 'Sessions per month must be 30 or fewer',
  ck_subscriptions_dates: 'End date must not be before the start date',
  ck_freezes_dates: 'Freeze end must not be before its start',
  ck_freezes_length: 'A freeze can last at most 60 days',
  ck_payments_amount: 'Amount must be more than 0',
  ck_payments_paid_at: 'Paid and refunded payments need a payment time',
  ck_availability_day: 'Day must be Monday to Sunday',
  ck_availability_times: 'End time must be after start time',
  ck_availability_grid: 'Times must be on the hour or half hour',
  ck_bookings_order: 'A session must end after it starts',
  ck_bookings_same_day: 'A session must start and end on the same day',
  ck_bookings_length: 'Sessions last 30, 60 or 90 minutes',
  ck_bookings_grid: 'Sessions start on the hour or half hour',
  ck_bookings_cancelled: 'Cancelled sessions need a cancellation time',
};

const UNIQUE_MESSAGES = {
  uq_users_email: 'An account with this email already exists',
  uq_plans_name: 'A plan with this name already exists',
  uq_availability_slot: 'You already have a window starting at that time',
};

// Turns database errors into HTTP responses:
//   SIGNAL 45000 "[R2] ..."  → 409 { message, rule: "R2" }   (business rule)
//   CHECK violation (3819)   → 400                            (invalid value)
//   duplicate key (1062)     → 409
//   foreign key (1451/1452)  → 409
function toHttp(err) {
  if (err instanceof HttpError) return err;

  const db = err.parent || err.original;
  if (db?.sqlState === '45000') {
    const match = /^\[(R\d+)\]\s*(.*)$/.exec(db.sqlMessage || '');
    return new HttpError(409, match ? match[2] : db.sqlMessage, { rule: match?.[1] });
  }
  if (db?.errno === 3819) {
    const name = /'([^']+)'/.exec(db.sqlMessage)?.[1];
    return new HttpError(400, CHECK_MESSAGES[name] || 'A value is not allowed', { constraint: name });
  }
  if (err.name === 'SequelizeUniqueConstraintError' || db?.errno === 1062) {
    const key = Object.keys(UNIQUE_MESSAGES).find((k) => (db?.sqlMessage || '').includes(k));
    return new HttpError(409, UNIQUE_MESSAGES[key] || 'This record already exists');
  }
  if (db?.errno === 1451) return new HttpError(409, 'This record is still in use and cannot be deleted');
  if (db?.errno === 1452) return new HttpError(409, 'A referenced record does not exist');
  if (err.type === 'entity.parse.failed') return new HttpError(400, 'Malformed JSON body');
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const http = toHttp(err);
  if (!http) {
    console.error(err);
    return res.status(500).json({ error: { message: 'Something went wrong on our side' } });
  }
  const { status, message, rule, fields, constraint } = http;
  return res.status(status).json({ error: { message, rule, fields, constraint } });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: 'Not found' } });
}

module.exports = { errorHandler, notFoundHandler, toHttp };
