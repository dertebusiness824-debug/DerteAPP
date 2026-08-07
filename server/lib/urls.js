import { badRequest } from './errors.js';

/**
 * Normalizes an optional http(s) URL for storage.
 * Accepts bare hosts (`midominio.com`) and upgrades them to https.
 * Returns `undefined` when the field was omitted, `null` when cleared.
 */
export function normalizeHttpUrl(value, { max = 500, field = 'URL' } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.length > max) throw badRequest(`${field} demasiado larga`, { code: 'url_too_long' });

  let parsed;
  try {
    parsed = new URL(/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw badRequest(`${field} no válida`, { code: 'invalid_url' });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest(`${field} debe ser http o https`, { code: 'invalid_url_protocol' });
  }

  let normalized = parsed.toString();
  // `new URL('https://host')` adds a trailing slash; drop it unless the user typed one.
  if (!raw.endsWith('/') && parsed.pathname === '/' && !parsed.search && !parsed.hash) {
    normalized = normalized.replace(/\/$/, '');
  }
  return normalized;
}
