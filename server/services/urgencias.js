import { query, queryAll, queryOne } from '../db/index.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { formatInZone } from '../lib/time.js';

export const URGENCIA_ACTIVE_HOURS = 24;
export const URGENCIA_HISTORY_DAYS = 60;

const externalRef = (callId) => (callId ? `retell:${callId}` : null);

export function serializeUrgencia(row, { timezone = 'Europe/Madrid' } = {}) {
  if (!row) return null;
  const calledAt = row.called_at ? new Date(row.called_at) : new Date(row.created_at);
  const createdAt = new Date(row.created_at);
  const vehicleLabel = [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    call_log_id: row.call_log_id ?? null,
    external_ref: row.external_ref ?? null,
    is_urgent: row.is_urgent !== false,
    customer_name: row.customer_name ?? null,
    customer_phone: row.customer_phone,
    customer_phone_display: formatPhone(row.customer_phone),
    customer_tel_link: telLink(row.customer_phone),
    customer_whatsapp_link: whatsappLink(
      row.customer_phone,
      `Hola${row.customer_name ? ` ${row.customer_name}` : ''}, te llamo del taller por tu urgencia.`,
    ),
    vehicle: {
      make: row.vehicle_make ?? null,
      model: row.vehicle_model ?? null,
      plate: row.vehicle_plate ?? null,
      label: vehicleLabel,
    },
    reason: row.reason ?? null,
    summary: row.summary ?? null,
    transcript: row.transcript ?? null,
    called_at: calledAt.toISOString(),
    called_local: formatInZone(calledAt, timezone, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    called_time: formatInZone(calledAt, timezone, {
      hour: '2-digit',
      minute: '2-digit',
    }),
    source: row.source ?? 'retell',
    created_at: createdAt.toISOString(),
    created_local: formatInZone(createdAt, timezone, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

/**
 * Insert or refresh an urgencia keyed by Retell call id.
 */
export async function upsertUrgencia({
  shopId,
  callLogId = null,
  callId = null,
  customerName = null,
  customerPhone,
  vehicleMake = null,
  vehicleModel = null,
  vehiclePlate = null,
  reason = null,
  summary = null,
  transcript = null,
  calledAt = null,
  source = 'retell',
  raw = {},
}) {
  const ref = externalRef(callId);
  const when = calledAt instanceof Date ? calledAt : calledAt ? new Date(calledAt) : new Date();

  const row = await queryOne(
    `INSERT INTO urgencias
       (shop_id, call_log_id, external_ref, is_urgent, customer_name, customer_phone,
        vehicle_make, vehicle_model, vehicle_plate, reason, summary, transcript,
        called_at, source, raw)
     VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
     ON CONFLICT (external_ref) DO UPDATE SET
       call_log_id = COALESCE(EXCLUDED.call_log_id, urgencias.call_log_id),
       customer_name = COALESCE(EXCLUDED.customer_name, urgencias.customer_name),
       customer_phone = EXCLUDED.customer_phone,
       vehicle_make = COALESCE(EXCLUDED.vehicle_make, urgencias.vehicle_make),
       vehicle_model = COALESCE(EXCLUDED.vehicle_model, urgencias.vehicle_model),
       vehicle_plate = COALESCE(EXCLUDED.vehicle_plate, urgencias.vehicle_plate),
       reason = COALESCE(EXCLUDED.reason, urgencias.reason),
       summary = COALESCE(EXCLUDED.summary, urgencias.summary),
       transcript = COALESCE(EXCLUDED.transcript, urgencias.transcript),
       called_at = COALESCE(EXCLUDED.called_at, urgencias.called_at),
       raw = urgencias.raw || EXCLUDED.raw,
       updated_at = now()
     RETURNING *`,
    [
      shopId,
      callLogId,
      ref,
      customerName,
      customerPhone,
      vehicleMake,
      vehicleModel,
      vehiclePlate,
      reason,
      summary,
      transcript,
      when.toISOString(),
      source,
      JSON.stringify(raw ?? {}),
    ],
  );
  return row;
}

/**
 * @param {'active'|'history'|'all'} scope
 * - active: last 24 hours
 * - history: older than 24h and younger than 60 days
 * - all: anything still retained (< 60 days)
 */
export function listUrgencias({
  shopId = null,
  scope = 'active',
  limit = 50,
  offset = 0,
  now = new Date(),
} = {}) {
  // shopId optional: when null, return across all shops (avoids empty UI on shop mismatch).
  const params = [];
  let where = 'is_urgent = TRUE';

  if (shopId) {
    params.push(shopId);
    where += ` AND shop_id = $${params.length}`;
  }

  if (scope === 'active') {
    params.push(new Date(now.getTime() - URGENCIA_ACTIVE_HOURS * 60 * 60_000).toISOString());
    where += ` AND created_at >= $${params.length}::timestamptz`;
  } else if (scope === 'history') {
    params.push(new Date(now.getTime() - URGENCIA_ACTIVE_HOURS * 60 * 60_000).toISOString());
    params.push(new Date(now.getTime() - URGENCIA_HISTORY_DAYS * 24 * 60 * 60_000).toISOString());
    where += ` AND created_at < $${params.length - 1}::timestamptz AND created_at >= $${params.length}::timestamptz`;
  } else {
    params.push(new Date(now.getTime() - URGENCIA_HISTORY_DAYS * 24 * 60 * 60_000).toISOString());
    where += ` AND created_at >= $${params.length}::timestamptz`;
  }

  params.push(limit, offset);
  return queryAll(
    `SELECT * FROM urgencias
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export function getUrgencia(shopId, id) {
  return queryOne(`SELECT * FROM urgencias WHERE shop_id = $1 AND id = $2`, [shopId, id]);
}

/** Hard-delete urgencias older than 60 days. */
export async function purgeOldUrgencias({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - URGENCIA_HISTORY_DAYS * 24 * 60 * 60_000);
  const result = await query(`DELETE FROM urgencias WHERE created_at < $1::timestamptz`, [
    cutoff.toISOString(),
  ]);
  return { deleted: result.rowCount ?? 0 };
}

export async function countActiveUrgencias(shopId, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - URGENCIA_ACTIVE_HOURS * 60 * 60_000);
  const row = await queryOne(
    `SELECT COUNT(*)::int AS count FROM urgencias
      WHERE shop_id = $1 AND is_urgent = TRUE AND created_at >= $2::timestamptz`,
    [shopId, since.toISOString()],
  );
  return row?.count ?? 0;
}
