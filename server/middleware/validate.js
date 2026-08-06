import { z } from 'zod';
import { normalizePhone } from '../lib/phone.js';

/** Validates and replaces req.body / req.query with the parsed result. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) return next(result.error);
  if (source === 'query') {
    req.validatedQuery = result.data;
  } else {
    req[source] = result.data;
  }
  return next();
};

/** Trimmed, non-empty string with a maximum length. */
export const text = (max = 255, { min = 1 } = {}) => z.string().trim().min(min).max(max);

/**
 * Optional free text that maps an empty string to null.
 * A field that is *absent* stays `undefined`, which is what lets PATCH handlers
 * tell "clear this value" apart from "leave this value alone".
 */
export const optionalText = (max = 255) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((value) => (value === null || value === '' ? null : value))
    .optional();

/** Accepts any human phone format and stores E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Introduce un teléfono válido con prefijo, p. ej. +34600123456',
      });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * Phone input that is validated later, once a shop's country code is known
 * (used by the public booking form so local numbers are still accepted).
 */
export const rawPhoneSchema = z.string().trim().min(4, 'Introduce un teléfono').max(32);

/** Same "absent means untouched" contract as optionalText. */
export const optionalPhoneSchema = z
  .union([z.string(), z.null()])
  .transform((value, ctx) => {
    if (value === null || String(value).trim() === '') return null;
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Introduce un teléfono válido con prefijo de país',
      });
      return z.NEVER;
    }
    return normalized;
  })
  .optional();

/**
 * Boolean that also understands query-string and form values.
 * `z.coerce.boolean()` cannot be used here: it is just `Boolean(value)`, so the
 * string "false" would come out as true.
 */
export const booleanish = (defaultValue = false) =>
  z
    .union([z.boolean(), z.string(), z.number()])
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    })
    .default(defaultValue);

export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format');

export const timeSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}:\d{2}(:\d{2})?$/, 'Use the HH:MM format');

export const datetimeSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide a valid date and time' });
      return z.NEVER;
    }
    return date;
  });

export { z };
