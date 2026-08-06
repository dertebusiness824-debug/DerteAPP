import { badRequest } from './errors.js';

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises user input to E.164 (`+<country code><number>`).
 * Accepts spaces, dashes, parentheses and the `00` international prefix.
 * Returns null when the value cannot be a valid international number.
 */
export function normalizePhone(input) {
  if (input === null || input === undefined) return null;
  let value = String(input).trim();
  if (!value) return null;

  const hadPlus = value.startsWith('+');
  let digits = value.replace(/[^\d]/g, '');
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;

  const normalized = `+${digits}`;
  return E164.test(normalized) ? normalized : null;
}

export const isValidPhone = (input) => normalizePhone(input) !== null;

/** Normalises or throws a 400 - use on any inbound phone field. */
export function requirePhone(input, field = 'phone') {
  const phone = normalizePhone(input);
  if (!phone) {
    throw badRequest(`${field} must be a valid international number including the country code, e.g. +34600123456`, {
      code: 'invalid_phone',
      details: { field },
    });
  }
  return phone;
}

// ITU country calling codes are 1-3 digits. Only zones 1 and 7 are single
// digit; the two-digit codes are a fixed list, and everything else is three.
const ONE_DIGIT_CODES = new Set(['1', '7']);
const TWO_DIGIT_CODES = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66',
  '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
]);

/** Length of the country calling code inside an E.164 digit string. */
export function countryCodeLength(digits) {
  if (ONE_DIGIT_CODES.has(digits.slice(0, 1))) return 1;
  if (TWO_DIGIT_CODES.has(digits.slice(0, 2))) return 2;
  return 3;
}

/** `+34600123456` -> `+34 600 123 456` (display only, never stored). */
export function formatPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return phone ?? '';
  const digits = normalized.slice(1);
  const codeLength = countryCodeLength(digits);
  const national = digits.slice(codeLength);
  const groups = national.match(/\d{1,3}/g) ?? [];
  // Avoid a dangling single digit: 555 123 456 7 -> 555 123 4567.
  if (groups.length > 1 && groups.at(-1).length === 1) {
    groups[groups.length - 2] += groups.pop();
  }
  return `+${digits.slice(0, codeLength)} ${groups.join(' ')}`.trim();
}

/** `tel:` URI for one-tap calling from the mobile dashboard. */
export const telLink = (phone) => {
  const normalized = normalizePhone(phone);
  return normalized ? `tel:${normalized}` : null;
};

/** wa.me deep link; WhatsApp expects the number without the leading plus. */
export function whatsappLink(phone, text) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const base = `https://wa.me/${normalized.slice(1)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** Masks the middle digits for logs and audit trails. */
export function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return '';
  return `${normalized.slice(0, 4)}${'*'.repeat(Math.max(normalized.length - 6, 0))}${normalized.slice(-2)}`;
}
