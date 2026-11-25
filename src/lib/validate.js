const { z } = require('zod');
const { badRequest } = require('./http-error');
const { parseLocal } = require('./time');

// Parses `data` with a zod schema or throws a 400 listing each invalid field.
function validate(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.entries(fields)[0];
  throw badRequest(first[0] === '_' ? first[1] : `${first[0]}: ${first[1]}`, { fields });
}

// Reusable field schemas
const id = z.coerce.number().int().positive();
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(255);
const password = z.string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one digit');
const name = z.string().trim().min(1, 'Required').max(50);
const optionalText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const phone = z.string().trim().regex(/^[0-9+\-() ]{7,20}$/, 'Enter a valid phone number')
  .optional().nullable().or(z.literal('')).transform((v) => v || null);
const date = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && parseLocal(v), 'Use the format YYYY-MM-DD');
const optionalDate = date.optional().nullable().or(z.literal('')).transform((v) => v || null);
const dateTime = z.string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(v) && parseLocal(v), 'Use the format YYYY-MM-DD HH:mm');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'Use the format HH:mm').transform((v) => v.slice(0, 5));
const money = z.coerce.number().int('Whole won only').positive('Must be more than 0').max(100000000);

// Card details for the demo gateway (see subscriptions.chargeOnline). The
// shape is checked so the checkout behaves like a real one; no money moves and
// nothing here is written to the database — the payment row keeps only its own
// PG reference number.
const cardNumber = z.string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^\d{16}$/.test(v), 'A card number is 16 digits');
const cardExpiry = z.string().trim()
  .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Use the format MM/YY')
  // Valid through the last day of the printed month.
  .refine((v) => new Date(2000 + Number(v.slice(3)), Number(v.slice(0, 2)), 1) > new Date(), 'This card has expired');
const cardCvc = z.string().trim().regex(/^\d{3}$/, 'The code is 3 digits');
const card = z.object({ number: cardNumber, expiry: cardExpiry, cvc: cardCvc });
// Optional, so the API stays usable without a card (tests, the front desk).
const optionalCard = card.optional().nullable();

module.exports = {
  z, validate, id, email, password, name, optionalText, phone, date, optionalDate, dateTime, time, money, card, optionalCard,
};
