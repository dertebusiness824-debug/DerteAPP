import crypto from 'node:crypto';
import config from '../config.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';

/**
 * Zadarma REST client (https://zadarma.com/en/support/api/).
 *
 * Request signing, as required by the API:
 *   params      = alphabetically sorted, PHP `http_build_query`-style encoding
 *   stringToSign= method + params + md5(params)
 *   signature   = base64( hex( hmac_sha1(stringToSign, secret) ) )
 *   header      = Authorization: <key>:<signature>
 *
 * Credentials come from ZADARMA_KEY / ZADARMA_SECRET and are never logged.
 */

/** PHP urlencode-compatible encoding (spaces become `+`). */
function phpUrlEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function buildQuery(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${phpUrlEncode(key)}=${phpUrlEncode(params[key])}`)
    .join('&');
}

export function signRequest(method, params, secret = config.zadarma.secret) {
  const query = buildQuery(params);
  const md5 = crypto.createHash('md5').update(query).digest('hex');
  const hmacHex = crypto.createHmac('sha1', secret).update(`${method}${query}${md5}`).digest('hex');
  return { query, signature: Buffer.from(hmacHex).toString('base64') };
}

export const isConfigured = () => config.zadarma.configured;

function assertConfigured() {
  if (!isConfigured()) {
    throw new HttpError(503, 'Zadarma is not configured. Set ZADARMA_KEY and ZADARMA_SECRET.', {
      code: 'zadarma_not_configured',
    });
  }
}

/** Low-level signed call. `method` must keep its leading and trailing slash. */
export async function request(method, params = {}, { httpMethod = 'GET', timeoutMs = 12_000 } = {}) {
  assertConfigured();
  const { query, signature } = signRequest(method, params);
  const url = `${config.zadarma.apiUrl}${method}${httpMethod === 'GET' && query ? `?${query}` : ''}`;

  const init = {
    method: httpMethod,
    headers: {
      Authorization: `${config.zadarma.key}:${signature}`,
      Accept: 'application/json',
      ...(httpMethod === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    signal: AbortSignal.timeout(timeoutMs),
    ...(httpMethod === 'GET' ? {} : { body: query }),
  };

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new HttpError(502, `Could not reach Zadarma: ${error.message}`, { code: 'zadarma_unreachable' });
  }

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(502, 'Zadarma returned a response that could not be parsed', {
      code: 'zadarma_bad_response',
      details: { body: raw.slice(0, 200) },
    });
  }

  if (!response.ok || payload.status === 'error') {
    throw new HttpError(response.ok ? 400 : response.status, payload.message ?? 'Zadarma rejected the request', {
      code: 'zadarma_error',
      details: payload,
    });
  }

  return payload;
}

// --- Account & PBX -----------------------------------------------------------

export const getBalance = () => request('/v1/info/balance/');
export const getSipList = () => request('/v1/sip/');
export const getPbxInternals = () => request('/v1/pbx/internal/');
export const getPrice = ({ number, callerId }) =>
  request('/v1/info/price/', { number: normalizePhone(number) ?? number, caller_id: callerId });

/**
 * Places a callback call: Zadarma rings `from` (a SIP/extension or the owner's
 * mobile) and bridges it to `to`. This is what powers the one-tap call buttons.
 */
export function requestCallback({ from, to, sip, predicted = false }) {
  const destination = normalizePhone(to);
  if (!destination) throw badRequest('A valid destination number is required to place a call');
  const origin = normalizePhone(from) ?? from;
  if (!origin && !sip) throw badRequest('A caller (from) or SIP/extension is required to place a call');

  return request('/v1/request/callback/', {
    from: origin,
    to: destination.replace(/^\+/, ''),
    ...(sip ? { sip } : {}),
    ...(predicted ? { predicted: 1 } : {}),
  });
}

/** Rings the shop owner as a voice notification, e.g. for a new booking. */
export const voiceNotify = ({ to, sip = config.zadarma.defaultSip, from }) =>
  requestCallback({ from: from ?? to, to, sip });

export function sendSms({ to, message, callerId }) {
  const destination = normalizePhone(to);
  if (!destination) throw badRequest('A valid destination number is required to send an SMS');
  return request(
    '/v1/sms/send/',
    { number: destination, message: String(message).slice(0, 500), ...(callerId ? { caller_id: callerId } : {}) },
    { httpMethod: 'POST' },
  );
}

/** PBX call statistics. `start`/`end` use Zadarma's `YYYY-MM-DD HH:MM:SS`. */
export const getPbxStatistics = ({ start, end, version = 2, skip = 0, limit = 100 }) =>
  request('/v1/statistics/pbx/', { start, end, version, skip, limit });

export const getStatistics = ({ start, end, sip, skip = 0, limit = 100 }) =>
  request('/v1/statistics/', { start, end, sip, skip, limit });

/** Temporary download link for a recording. */
export const getRecordingLink = ({ callId, pbxCallId, lifetime = 1800 }) =>
  request('/v1/pbx/record/request/', {
    ...(callId ? { call_id: callId } : {}),
    ...(pbxCallId ? { pbx_call_id: pbxCallId } : {}),
    lifetime,
  });

// --- Webhooks ----------------------------------------------------------------

/**
 * Field order Zadarma uses to build the `Signature` header, per event.
 * The docs list a specific concatenation for each notification; we verify
 * against the documented order and fall back to the concatenation of all
 * non-signature values so a new event type does not silently break ingestion.
 */
const SIGNATURE_FIELDS = {
  NOTIFY_START: ['event', 'caller_id', 'called_did'],
  NOTIFY_INTERNAL: ['event', 'caller_id', 'internal'],
  NOTIFY_ANSWER: ['event', 'caller_id', 'destination'],
  NOTIFY_END: ['event', 'caller_id', 'called_did', 'duration'],
  NOTIFY_OUT_START: ['event', 'internal', 'destination'],
  NOTIFY_OUT_END: ['event', 'internal', 'destination', 'duration'],
  NOTIFY_RECORD: ['event', 'call_id_with_rec', 'pbx_call_id'],
  NOTIFY_IVR: ['event', 'caller_id', 'called_did'],
};

const hmacBase64 = (value, secret) =>
  Buffer.from(crypto.createHmac('sha1', secret).update(value).digest('hex')).toString('base64');

function signatureCandidates(payload) {
  const fields = SIGNATURE_FIELDS[payload.event];
  const candidates = [];
  if (fields) candidates.push(fields.map((field) => payload[field] ?? '').join(''));
  candidates.push(
    Object.keys(payload)
      .filter((key) => key !== 'signature')
      .sort()
      .map((key) => payload[key] ?? '')
      .join(''),
  );
  return candidates;
}

/** Constant-time check of the `Signature` header on an incoming notification. */
export function verifyWebhook(payload, signatureHeader, secret = config.zadarma.secret) {
  if (!config.zadarma.verifyWebhooks) return true;
  if (!secret || !signatureHeader) return false;

  const provided = Buffer.from(String(signatureHeader).trim());
  return signatureCandidates(payload).some((candidate) => {
    const expected = Buffer.from(hmacBase64(candidate, secret));
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  });
}

export default {
  isConfigured,
  request,
  signRequest,
  buildQuery,
  getBalance,
  getSipList,
  getPbxInternals,
  getPrice,
  requestCallback,
  voiceNotify,
  sendSms,
  getPbxStatistics,
  getStatistics,
  getRecordingLink,
  verifyWebhook,
};
