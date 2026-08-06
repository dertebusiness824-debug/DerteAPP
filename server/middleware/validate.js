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

export const optionalText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null);

/** Accepts any human phone format and stores E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid phone number including the country code, e.g. +34600123456',
      });
      return z.NEVER;
    }
    return normalized;
  });

export const optionalPhoneSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number including the country code' });
      return z.NEVER;
    }
    return normalized;
  });

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

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export { z };
