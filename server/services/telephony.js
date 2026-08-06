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

/** Maps an inbound DID (or outbound extension) to the tenant that owns it. */
export async function resolveShopForCall({ did, internal }) {
  const normalizedDid = normalizeProviderPhone(did);
  if (normalizedDid || did) {
    const shop = await queryOne(
      `SELECT * FROM shops
        WHERE zadarma_did IS NOT NULL
          AND regexp_replace(zadarma_did, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
        LIMIT 1`,
      [String(normalizedDid ?? did)],
    );
    if (shop) return shop;
  }
  if (internal) {
    const shop = await queryOne('SELECT * FROM shops WHERE zadarma_sip = $1 LIMIT 1', [String(internal)]);
    if (shop) return shop;
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
  return {
    id: row.id,
    shop_id: row.shop_id,
    shop_name: row.shop_name ?? null,
    direction: row.direction,
    caller_phone: row.caller_phone ?? null,
    caller_phone_display: row.caller_phone ? formatPhone(row.caller_phone) : null,
    callee_phone: row.callee_phone ?? null,
    callee_phone_display: row.callee_phone ? formatPhone(row.callee_phone) : null,
    counterparty: row.direction === 'out' ? row.callee_phone : row.caller_phone,
    tel_link: telLink(row.direction === 'out' ? row.callee_phone : row.caller_phone),
    whatsapp_link: whatsappLink(row.direction === 'out' ? row.callee_phone : row.caller_phone),
    sip: row.sip ?? null,
    status: row.status,
    disposition: row.disposition ?? null,
    duration_seconds: row.duration_seconds,
    recording_url: row.recording_url ?? null,
    appointment_id: row.appointment_id ?? null,
    appointment_reference: row.appointment_reference ?? null,
    started_at: row.started_at,
    answered_at: row.answered_at ?? null,
    ended_at: row.ended_at ?? null,
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
  const callerPhone = normalizeProviderPhone(payload.caller_id) ?? payload.caller_id ?? null;
  const calleePhone =
    normalizeProviderPhone(payload.destination) ??
    normalizeProviderPhone(payload.called_did) ??
    payload.destination ??
    payload.called_did ??
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
      patch.status = 'ringing';
      break;
    case 'NOTIFY_ANSWER':
      patch.status = 'answered';
      patch.answered_at = new Date();
      break;
    case 'NOTIFY_END':
    case 'NOTIFY_OUT_END':
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
            status = EXCLUDED.status,
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
  const response = await zadarma.requestCallback({ from, to: destination, sip });

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

export function listCalls({ shopId = null, limit = 50, offset = 0, direction = null, status = null }) {
  return queryAll(
    `SELECT c.*, s.name AS shop_name, a.reference AS appointment_reference
       FROM call_logs c
       LEFT JOIN shops s ON s.id = c.shop_id
       LEFT JOIN appointments a ON a.id = c.appointment_id
      WHERE ($1::uuid IS NULL OR c.shop_id = $1)
        AND ($2::text IS NULL OR c.direction = $2)
        AND ($3::text IS NULL OR c.status = $3)
      ORDER BY c.started_at DESC
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
