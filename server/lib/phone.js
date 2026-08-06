import { badRequest } from './errors.js';

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises user input to E.164 (`+<country code><number>`).
 *
 * An international prefix (`+` or `00`) is required, because a bare local
 * number cannot be turned into a correct international one by guessing - and a
 * wrong number here means a booking nobody can call back.
 *
 * `defaultCountryCode` opts into that guess for one specific case: a customer
 * typing their local number into a shop's booking form, where the shop's own
 * country is a safe assumption.
 */
export function normalizePhone(input, { defaultCountryCode = null } = {}) {
  if (input === null || input === undefined) return null;
  const value = String(input).trim();
  if (!value) return null;

  const hadPlus = value.startsWith('+');
  let digits = value.replace(/\D/g, '');
  if (!digits) return null;

  const hadInternationalPrefix = hadPlus || digits.startsWith('00');
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);

  if (!hadInternationalPrefix) {
    const countryCode = String(defaultCountryCode ?? '').replace(/\D/g, '');
    if (!countryCode) return null;
    // Only prepend when the number does not already carry that country code;
    // the length guard keeps national numbers that merely start with the same
    // digits from being misread as international.
    const alreadyPrefixed = digits.startsWith(countryCode) && digits.length - countryCode.length >= 8;
    if (!alreadyPrefixed) {
      // Drop the national trunk prefix (the leading 0 in 07… / 06…).
      digits = `${countryCode}${digits.replace(/^0+/, '')}`;
    }
  }

  const normalized = `+${digits}`;
  return E164.test(normalized) ? normalized : null;
}

/**
 * Normalises a number that arrived from a telephony provider.
 *
 * Zadarma (like most PBX providers) reports full international numbers with no
 * leading `+` - `34611000001` rather than `+34611000001` - so a bare digit
 * string can be trusted to already contain the country code here.
 * Returns null for SIP extensions and other non-E.164 values, which callers
 * keep verbatim.
 */
export function normalizeProviderPhone(input) {
  if (input === null || input === undefined) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;
  const normalized = `+${digits}`;
  return E164.test(normalized) ? normalized : null;
}

export const isValidPhone = (input, options) => normalizePhone(input, options) !== null;

/** Normalises or throws a 400 - use on any inbound phone field. */
export function requirePhone(input, field = 'phone', options) {
  const phone = normalizePhone(input, options);
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

/**
 * Country calling code of an international number (`+34600111222` -> `34`).
 * Used to interpret a local number a caller reads out, which cannot be
 * normalised without knowing the country.
 */
export function countryCodeOf(phone) {
  const normalized = normalizePhone(phone) ?? normalizeProviderPhone(phone);
  if (!normalized) return null;
  const digits = normalized.slice(1);
  return digits.slice(0, countryCodeLength(digits));
}

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
