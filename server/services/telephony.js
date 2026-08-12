import config from '../config.js';
import { queryAll, queryOne } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { channels, hub } from '../lib/events.js';
import { formatPhone, normalizePhone, normalizeProviderPhone, telLink, whatsappLink } from '../lib/phone.js';
import zadarma from './zadarma.js';

const DISPOSITION_STATUS = {
  answered: 'completed',
  busy: 'busy',
  cancel: 'cancelled',
  cancelled: 'cancelled',
  'no answer': 'no_answer',
  noanswer: 'no_answer',
  failed: 'failed',
  'no money': 'failed',
  'no money, no destination': 'failed',
  unallocated_number: 'failed',
};

const statusFromDisposition = (disposition) =>
  DISPOSITION_STATUS[String(disposition ?? '').toLowerCase().trim()] ?? 'completed';

const TERMINAL_STATUSES = new Set(['completed', 'no_answer', 'busy', 'failed', 'cancelled']);
const IN_PROGRESS_STATUSES = new Set(['started', 'ringing', 'answered']);

/** Prefer end-of-call status; never regress a finished call to ringing/started. */
function mergeCallStatus(existingStatus, nextStatus) {
  if (!nextStatus) return existingStatus || 'started';
  if (existingStatus && TERMINAL_STATUSES.has(existingStatus) && IN_PROGRESS_STATUSES.has(nextStatus)) {
    return existingStatus;
  }
  return nextStatus;
}

/** Digits-only compare for DID matching across formatting (+34…, spaces). */
const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/** Maps an inbound DID (or outbound extension) to the tenant that owns it. */
export async function resolveShopForCall({ did, internal }) {
  const digited = digitsOnly(did);
  if (digited) {
    // Match shops.zadarma_did (did_zadarma alias) and shops.retell_did (inbound number).
    const shop = await queryOne(
      `SELECT * FROM shops
        WHERE (
              zadarma_did IS NOT NULL
              AND regexp_replace(zadarma_did, '[^0-9]', '', 'g') = $1
            )
           OR (
              retell_did IS NOT NULL
              AND regexp_replace(retell_did, '[^0-9]', '', 'g') = $1
            )
        LIMIT 1`,
      [digited],
    );
    if (shop) return shop;
  }
  if (internal) {
    const shop = await queryOne('SELECT * FROM shops WHERE zadarma_sip = $1 LIMIT 1', [String(internal)]);
    if (shop) return shop;
  }
  return null;
}

/** Best available customer CLI from a Zadarma notification. */
function extractZadarmaCallerPhone(payload = {}, { outbound = false } = {}) {
  const candidates = outbound
    ? [payload.destination, payload.caller_id, payload.caller_number, payload.from_number]
    : [payload.caller_id, payload.caller_number, payload.from_number, payload.destination];
  for (const raw of candidates) {
    if (raw === null || raw === undefined || raw === '') continue;
    const normalized = normalizeProviderPhone(raw);
    if (normalized) return normalized;
    const text = String(raw).trim();
    if (text && !/^(anonymous|unknown|restricted)$/i.test(text)) return text;
  }
  return null;
}

/** Best-effort link between a phone call and an existing booking. */
async function findRelatedAppointment(shopId, phone) {
  const normalized = normalizeProviderPhone(phone);
  if (!shopId || !normalized) return null;
  const appointment = await queryOne(
    `SELECT id FROM appointments
      WHERE shop_id = $1 AND customer_phone = $2
      ORDER BY abs(extract(epoch FROM (scheduled_at - now()))) ASC
      LIMIT 1`,
    [shopId, normalized],
  );
  return appointment;
}

export function serializeCall(row) {
  const counterpartyRaw = row.direction === 'out' ? row.callee_phone : row.caller_phone;
  const counterpartyDisplay = counterpartyRaw ? formatPhone(counterpartyRaw) : null;
  const status = row.status || 'started';
  const inProgress = status === 'started' || status === 'ringing' || status === 'answered';
  const missed = status === 'no_answer' || status === 'busy' || status === 'failed' || status === 'cancelled';
  const completed = status === 'completed';
  let statusLabel = 'En curso';
  if (completed) statusLabel = 'Completada';
  else if (missed) statusLabel = 'Perdida';

  const when = row.started_at || row.created_at || null;

  return {
    id: row.id,
    shop_id: row.shop_id,
    shop_name: row.shop_name ?? null,
    direction: row.direction,
    caller_phone: row.caller_phone ?? null,
    caller_phone_display: row.caller_phone ? formatPhone(row.caller_phone) : null,
    callee_phone: row.callee_phone ?? null,
    callee_phone_display: row.callee_phone ? formatPhone(row.callee_phone) : null,
    counterparty: counterpartyRaw || null,
    counterparty_display: counterpartyDisplay,
    customer_phone: counterpartyRaw || null,
    customer_phone_display: counterpartyDisplay || 'Desconocido/Sin ID',
    tel_link: telLink(counterpartyRaw),
    whatsapp_link: whatsappLink(counterpartyRaw),
    sip: row.sip ?? null,
    status,
    status_label: statusLabel,
    status_kind: completed ? 'completed' : missed ? 'missed' : 'in_progress',
    disposition: row.disposition ?? null,
    duration_seconds: row.duration_seconds,
    recording_url: row.recording_url ?? null,
    appointment_id: row.appointment_id ?? null,
    appointment_reference: row.appointment_reference ?? null,
    started_at: row.started_at,
    created_at: row.created_at ?? row.started_at ?? null,
    answered_at: row.answered_at ?? null,
    ended_at: row.ended_at ?? null,
    timestamp: when,
    provider: row.provider,
  };
}

/**
 * Applies one Zadarma notification to the call log. Idempotent per
 * (provider, pbx_call_id): repeated or out-of-order events merge into one row.
 */
export async function ingestWebhook(payload) {
  const event = String(payload.event ?? '').toUpperCase();
  const pbxCallId = payload.pbx_call_id ?? payload.call_id ?? null;
  if (!pbxCallId) return { ignored: true, reason: 'missing_call_id' };

  const outbound = event.startsWith('NOTIFY_OUT');
  const internalCall = event === 'NOTIFY_INTERNAL';
  const direction = outbound ? 'out' : internalCall ? 'internal' : 'in';

  const shop = await resolveShopForCall({ did: payload.called_did, internal: payload.internal });
  const callerPhone = extractZadarmaCallerPhone(payload, { outbound });
  const calleePhone =
    normalizeProviderPhone(payload.destination) ??
    normalizeProviderPhone(payload.called_did) ??
    (payload.destination ? String(payload.destination).trim() : null) ??
    (payload.called_did ? String(payload.called_did).trim() : null) ??
    null;

  const existing = await queryOne(`SELECT * FROM call_logs WHERE provider = 'zadarma' AND external_id = $1`, [
    String(pbxCallId),
  ]);

  const patch = {
    shop_id: shop?.id ?? existing?.shop_id ?? null,
    direction,
    caller_phone: callerPhone ?? existing?.caller_phone ?? null,
    callee_phone: calleePhone ?? existing?.callee_phone ?? null,
    sip: payload.internal ?? payload.sip ?? existing?.sip ?? null,
    status: existing?.status ?? 'started',
    disposition: existing?.disposition ?? null,
    duration_seconds: existing?.duration_seconds ?? 0,
    billable_seconds: existing?.billable_seconds ?? 0,
    recording_url: existing?.recording_url ?? null,
    answered_at: existing?.answered_at ?? null,
    ended_at: existing?.ended_at ?? null,
    started_at: existing?.started_at ?? (payload.call_start ? new Date(payload.call_start) : new Date()),
  };

  switch (event) {
    case 'NOTIFY_START':
    case 'NOTIFY_OUT_START':
    case 'NOTIFY_INTERNAL':
      patch.status = mergeCallStatus(existing?.status, 'ringing');
      break;
    case 'NOTIFY_ANSWER':
      patch.status = mergeCallStatus(existing?.status, 'answered');
      patch.answered_at = new Date();
      break;
    case 'NOTIFY_END':
    case 'NOTIFY_OUT_END':
      // End of call → Completada / Perdida (never leave "En curso").
      patch.status = statusFromDisposition(payload.disposition);
      patch.disposition = payload.disposition ?? null;
      patch.duration_seconds = Number(payload.duration ?? 0) || 0;
      patch.billable_seconds = Number(payload.billseconds ?? payload.duration ?? 0) || 0;
      patch.ended_at = new Date();
      break;
    case 'NOTIFY_RECORD':
      patch.recording_url = payload.call_id_with_rec ? `zadarma:${payload.call_id_with_rec}` : patch.recording_url;
      break;
    default:
      break;
  }

  // Prefer a newly extracted CLI over a previous empty/unknown value.
  if (callerPhone) patch.caller_phone = callerPhone;
  if (calleePhone) patch.callee_phone = calleePhone;

  const appointment =
    existing?.appointment_id
      ? { id: existing.appointment_id }
      : await findRelatedAppointment(patch.shop_id, direction === 'out' ? patch.callee_phone : patch.caller_phone);

  const row = await queryOne(
    `INSERT INTO call_logs
       (shop_id, appointment_id, provider, external_id, pbx_call_id, direction, caller_phone, callee_phone, sip,
        status, disposition, duration_seconds, billable_seconds, recording_url, started_at, answered_at, ended_at, raw)
     VALUES ($1, $2, 'zadarma', $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (provider, external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET shop_id = COALESCE(call_logs.shop_id, EXCLUDED.shop_id),
            appointment_id = COALESCE(call_logs.appointment_id, EXCLUDED.appointment_id),
            direction = EXCLUDED.direction,
            caller_phone = COALESCE(EXCLUDED.caller_phone, call_logs.caller_phone),
            callee_phone = COALESCE(EXCLUDED.callee_phone, call_logs.callee_phone),
            sip = COALESCE(EXCLUDED.sip, call_logs.sip),
            status = CASE
              WHEN call_logs.status IN ('completed', 'no_answer', 'busy', 'failed', 'cancelled')
                   AND EXCLUDED.status IN ('started', 'ringing', 'answered')
              THEN call_logs.status
              ELSE EXCLUDED.status
            END,
            disposition = COALESCE(EXCLUDED.disposition, call_logs.disposition),
            duration_seconds = GREATEST(EXCLUDED.duration_seconds, call_logs.duration_seconds),
            billable_seconds = GREATEST(EXCLUDED.billable_seconds, call_logs.billable_seconds),
            recording_url = COALESCE(EXCLUDED.recording_url, call_logs.recording_url),
            answered_at = COALESCE(call_logs.answered_at, EXCLUDED.answered_at),
            ended_at = COALESCE(EXCLUDED.ended_at, call_logs.ended_at),
            raw = call_logs.raw || EXCLUDED.raw
     RETURNING *`,
    [
      patch.shop_id,
      appointment?.id ?? null,
      String(pbxCallId),
      direction,
      patch.caller_phone,
      patch.callee_phone,
      patch.sip,
      patch.status,
      patch.disposition,
      patch.duration_seconds,
      patch.billable_seconds,
      patch.recording_url,
      patch.started_at,
      patch.answered_at,
      patch.ended_at,
      { [event]: payload },
    ],
  );

  if (row.shop_id) {
    hub.publish(channels.shop(row.shop_id), { type: 'call_event', event, call: serializeCall(row) });
  }

  return { call: row, event };
}

/**
 * One-tap call from the dashboard. Zadarma dials the owner first, then bridges
 * to the customer, so no phone credit is spent by the owner's handset.
 */
export async function placeCall({ shop, user, to, appointmentId = null }) {
  const destination = normalizePhone(to);
  if (!destination) throw badRequest('A valid destination number is required');

  const from = user?.phone ?? shop.phone;
  const sip = shop.zadarma_sip || config.zadarma.defaultSip || undefined;
  const credentials = zadarma.resolveCredentials(shop);
  if (!credentials) {
    throw badRequest('Zadarma no está configurado para este taller (API Key / Secret).', {
      code: 'zadarma_not_configured',
    });
  }
  const response = await zadarma.requestCallback({
    from,
    to: destination,
    sip,
    credentials: { key: credentials.key, secret: credentials.secret },
  });

  const row = await queryOne(
    `INSERT INTO call_logs
       (shop_id, appointment_id, user_id, provider, external_id, direction, caller_phone, callee_phone, sip, status, raw)
     VALUES ($1, $2, $3, 'zadarma', $4, 'out', $5, $6, $7, 'started', $8)
     RETURNING *`,
    [
      shop.id,
      appointmentId,
      user?.id ?? null,
      response?.pbx_call_id ?? response?.call_id ?? null,
      from,
      destination,
      sip ?? null,
      { callback_request: response },
    ],
  );

  hub.publish(channels.shop(shop.id), { type: 'call_event', event: 'CALLBACK_REQUESTED', call: serializeCall(row) });
  return { call: serializeCall(row), provider_response: response };
}

export function listCalls({ shopId = null, limit = 200, offset = 0, direction = null, status = null } = {}) {
  // Full shop history (no upcoming/future filter). Newest first.
  return queryAll(
    `SELECT c.*, s.name AS shop_name, a.reference AS appointment_reference
       FROM call_logs c
       LEFT JOIN shops s ON s.id = c.shop_id
       LEFT JOIN appointments a ON a.id = c.appointment_id
      WHERE ($1::uuid IS NULL OR c.shop_id = $1)
        AND ($2::text IS NULL OR c.direction = $2)
        AND ($3::text IS NULL OR c.status = $3)
      ORDER BY COALESCE(c.created_at, c.started_at) DESC, c.started_at DESC
      LIMIT $4 OFFSET $5`,
    [shopId, direction, status, limit, offset],
  ).then((rows) => rows.map(serializeCall));
}

export async function callStats({ shopId = null, days = 30 }) {
  const row = await queryOne(
    `SELECT count(*)::int                                                       AS total,
            count(*) FILTER (WHERE direction = 'in')::int                       AS inbound,
            count(*) FILTER (WHERE direction = 'out')::int                      AS outbound,
            count(*) FILTER (WHERE status = 'completed')::int                   AS answered,
            count(*) FILTER (WHERE status IN ('no_answer', 'busy', 'failed'))::int AS missed,
            COALESCE(sum(duration_seconds), 0)::int                             AS total_seconds,
            COALESCE(round(avg(NULLIF(duration_seconds, 0))), 0)::int           AS avg_seconds
       FROM call_logs
      WHERE ($1::uuid IS NULL OR shop_id = $1)
        AND started_at > now() - ($2 || ' days')::interval`,
    [shopId, String(days)],
  );
  return row;
}

/**
 * Sends an OTP over Zadarma SMS when credentials are present.
 * A delivery failure is reported, never thrown: the code is already stored, so
 * the user can still be helped by another channel.
 */
export async function deliverOtpSms(phone, code) {
  if (!zadarma.isConfigured()) return { delivered: false, reason: 'zadarma_not_configured' };
  try {
    await zadarma.sendSms({ to: phone, message: `${config.appName} code: ${code}. It expires in 5 minutes.` });
    return { delivered: true };
  } catch (error) {
    if (!config.isTest) console.error('[telephony] SMS delivery failed:', error.message);
    return { delivered: false, reason: 'send_failed' };
  }
}
