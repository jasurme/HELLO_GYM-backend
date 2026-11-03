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

module.exports = { z, validate, id, email, password, name, optionalText, phone, date, optionalDate, dateTime, time, money };
