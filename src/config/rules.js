// App-level booking policy. The database enforces the hard rules (R1–R12);
// these are front-desk policies that only apply to requests from the web app.
module.exports = {
  SESSION_LENGTHS: [30, 60, 90],       // minutes, same as ck_bookings_length
  BOOKING_LEAD_MINUTES: 60,           // book at least an hour ahead
  BOOKING_MAX_DAYS_AHEAD: 60,         // and at most two months ahead
  MEMBER_CANCEL_NOTICE_HOURS: 12,     // members cancel at least 12 h before (R8, app part)
  MAX_FREEZE_DAYS: 60,                // same as ck_freezes_length
  RENEWAL_WINDOW_DAYS: 30,            // members may renew online this close to their end date
};
