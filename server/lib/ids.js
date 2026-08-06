import crypto from 'node:crypto';

/** URL-safe random token, used for chat links, public keys and session ids. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** Numeric OTP of the requested length, without modulo bias. */
export function numericCode(length = 6) {
  let code = '';
  while (code.length < length) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

export function slugify(value, fallback = 'shop') {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

const REFERENCE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';

/** Short human-quotable booking reference, e.g. `DA-7KQ4M2`. */
export function appointmentReference() {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += REFERENCE_ALPHABET[crypto.randomInt(0, REFERENCE_ALPHABET.length)];
  }
  return `DA-${suffix}`;
}

/** Timing-safe string comparison for tokens and signatures. */
export function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a ?? ''));
  const bufferB = Buffer.from(String(b ?? ''));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}
