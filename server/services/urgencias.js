import { query, queryAll, queryOne } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { channels, hub } from '../lib/events.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { formatInZone, parseDateOnly, utcFromZoned, zonedDateString } from '../lib/time.js';
import {
  createAppointment,
  getAppointment,
  serializeAppointment,
} from './appointments.js';
import { createCalcomBooking } from './calcom.js';
import { getAvailability } from './schedule.js';

export const URGENCIA_ACTIVE_HOURS = 24;
export const URGENCIA_HISTORY_DAYS = 60;
export const URGENCIA_DEFAULT_TITLE = 'Solicitud de servicio urgente';

const externalRef = (callId) => (callId ? `retell:${callId}` : null);

function normalizeStatus(value) {
  return value === 'accepted' ? 'accepted' : 'pending';
}

export function serializeUrgencia(row, { timezone = 'Europe/Madrid' } = {}) {
  if (!row) return null;
  const calledAt = row.called_at ? new Date(row.called_at) : new Date(row.created_at);
  const createdAt = new Date(row.created_at);
  const status = normalizeStatus(row.status);
  const vehicleLabel = [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    call_log_id: row.call_log_id ?? null,
    external_ref: row.external_ref ?? null,
    appointment_id: row.appointment_id ?? null,
    title: row.title?.trim() || URGENCIA_DEFAULT_TITLE,
    status,
    status_label: status === 'accepted' ? 'aceptada' : 'pendiente',
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
    called_date: zonedDateString(calledAt, timezone),
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
    accepted_at: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
    created_at: createdAt.toISOString(),
    created_local: formatInZone(createdAt, timezone, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    can_accept: status === 'pending',
  };
}

/**
 * Find an urgencia by Retell call id (`external_ref`) or recent phone match.
 */
export async function findUrgenciaByCallOrPhone({ shopId, callId = null, customerPhone = null } = {}) {
  const ref = externalRef(callId);
  if (ref) {
    const byRef = await queryOne('SELECT * FROM urgencias WHERE external_ref = $1', [ref]);
    if (byRef) return byRef;
  }
  if (shopId && customerPhone && customerPhone !== 'Sin teléfono') {
    return queryOne(
      `SELECT * FROM urgencias
        WHERE shop_id = $1
          AND customer_phone = $2
          AND created_at >= now() - interval '24 hours'
        ORDER BY created_at DESC
        LIMIT 1`,
      [shopId, customerPhone],
    );
  }
  return null;
}

/**
 * Insert or refresh an urgencia keyed by Retell call id.
 * Never downgrades an already-accepted row back to pending.
 *
 * @param {boolean} [forceAnalysis=false] When true (call_analyzed), overwrite
 *   customer/vehicle/plate/reason with the extracted values instead of COALESCE.
 * @param {boolean} [stubOnly=false] When true (call_ended), insert only if missing;
 *   never overwrite analysis columns on an existing row.
 */
export async function upsertUrgencia({
  shopId,
  callLogId = null,
  callId = null,
  title = URGENCIA_DEFAULT_TITLE,
  status = 'pending',
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
  forceAnalysis = false,
  stubOnly = false,
}) {
  const ref = externalRef(callId);
  const when = calledAt instanceof Date ? calledAt : calledAt ? new Date(calledAt) : new Date();
  const nextStatus = normalizeStatus(status);
  const nextTitle = String(title || URGENCIA_DEFAULT_TITLE).trim() || URGENCIA_DEFAULT_TITLE;

  const existing = await findUrgenciaByCallOrPhone({
    shopId,
    callId,
    customerPhone,
  });

  if (stubOnly && existing) {
    // call_ended: keep the row; only attach call_log / external_ref if missing.
    if (callLogId || (ref && !existing.external_ref)) {
      return queryOne(
        `UPDATE urgencias SET
           call_log_id = COALESCE($2, call_log_id),
           external_ref = COALESCE(external_ref, $3),
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [existing.id, callLogId, ref],
      );
    }
    return existing;
  }

  // call_analyzed matched by phone but different/missing external_ref → UPDATE in place.
  if (forceAnalysis && existing && existing.external_ref !== ref) {
    return queryOne(
      `UPDATE urgencias SET
         call_log_id = COALESCE($2, call_log_id),
         external_ref = COALESCE(external_ref, $3),
         title = COALESCE(NULLIF(title, ''), $4),
         status = CASE WHEN status = 'accepted' THEN status ELSE $5 END,
         customer_name = $6,
         customer_phone = COALESCE(NULLIF(NULLIF($7, ''), 'Sin teléfono'), customer_phone),
         vehicle_make = COALESCE($8, vehicle_make),
         vehicle_model = $9,
         vehicle_plate = $10,
         reason = $11,
         summary = COALESCE($12, summary),
         transcript = COALESCE($13, transcript),
         raw = raw || $14::jsonb,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        existing.id,
        callLogId,
        ref,
        nextTitle,
        nextStatus,
        customerName,
        customerPhone,
        vehicleMake,
        vehicleModel,
        vehiclePlate,
        reason,
        summary,
        transcript,
        JSON.stringify(raw ?? {}),
      ],
    );
  }

  const analysisUpdate = forceAnalysis
    ? `customer_name = EXCLUDED.customer_name,
       customer_phone = COALESCE(
         NULLIF(NULLIF(EXCLUDED.customer_phone, ''), 'Sin teléfono'),
         urgencias.customer_phone
       ),
       vehicle_make = COALESCE(EXCLUDED.vehicle_make, urgencias.vehicle_make),
       vehicle_model = COALESCE(EXCLUDED.vehicle_model, urgencias.vehicle_model),
       vehicle_plate = EXCLUDED.vehicle_plate,
       reason = EXCLUDED.reason,`
    : `-- Prefer real extracted values over placeholder defaults from earlier events.
       customer_name = COALESCE(
         NULLIF(NULLIF(EXCLUDED.customer_name, ''), 'Sin nombre'),
         NULLIF(urgencias.customer_name, 'Sin nombre'),
         EXCLUDED.customer_name,
         urgencias.customer_name
       ),
       customer_phone = COALESCE(
         NULLIF(NULLIF(EXCLUDED.customer_phone, ''), 'Sin teléfono'),
         urgencias.customer_phone
       ),
       vehicle_make = COALESCE(EXCLUDED.vehicle_make, urgencias.vehicle_make),
       vehicle_model = COALESCE(EXCLUDED.vehicle_model, urgencias.vehicle_model),
       vehicle_plate = COALESCE(
         NULLIF(NULLIF(EXCLUDED.vehicle_plate, ''), 'Sin matrícula'),
         NULLIF(urgencias.vehicle_plate, 'Sin matrícula'),
         EXCLUDED.vehicle_plate,
         urgencias.vehicle_plate
       ),
       reason = COALESCE(
         NULLIF(NULLIF(EXCLUDED.reason, ''), 'Consulta urgente'),
         NULLIF(urgencias.reason, 'Consulta urgente'),
         EXCLUDED.reason,
         urgencias.reason
       ),`;

  const row = await queryOne(
    `INSERT INTO urgencias
       (shop_id, call_log_id, external_ref, is_urgent, title, status, customer_name, customer_phone,
        vehicle_make, vehicle_model, vehicle_plate, reason, summary, transcript,
        called_at, source, raw)
     VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
     ON CONFLICT (external_ref) DO UPDATE SET
       call_log_id = COALESCE(EXCLUDED.call_log_id, urgencias.call_log_id),
       title = COALESCE(NULLIF(urgencias.title, ''), EXCLUDED.title),
       status = CASE
         WHEN urgencias.status = 'accepted' THEN urgencias.status
         ELSE EXCLUDED.status
       END,
       ${analysisUpdate}
       summary = COALESCE(EXCLUDED.summary, urgencias.summary),
       transcript = COALESCE(EXCLUDED.transcript, urgencias.transcript),
       called_at = COALESCE(urgencias.called_at, EXCLUDED.called_at),
       raw = urgencias.raw || EXCLUDED.raw,
       updated_at = now()
     RETURNING *`,
    [
      shopId,
      callLogId,
      ref,
      nextTitle,
      nextStatus,
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
 * Best-effort mirror to Supabase `urgencias` when service role is configured.
 * Postgres remains the source of truth for the app.
 */
export async function syncUrgenciaToSupabase(row, { callId = null } = {}) {
  if (!row?.id) return { ok: false, skipped: true, reason: 'missing_row' };
  try {
    const { getSupabaseAdmin, isSupabaseConfigured } = await import('../lib/supabase.js');
    const config = (await import('../config.js')).default;
    if (!config.supabase.adminConfigured || !isSupabaseConfigured()) {
      return { ok: false, skipped: true, reason: 'supabase_not_configured' };
    }
    const supabase = getSupabaseAdmin();
    const payload = {
      id: row.id,
      shop_id: row.shop_id,
      call_id: callId || (row.external_ref?.startsWith('retell:') ? row.external_ref.slice(7) : null),
      external_ref: row.external_ref,
      phone: row.customer_phone,
      customer_phone: row.customer_phone,
      customer_name: row.customer_name,
      vehicle: row.vehicle_model || row.vehicle_make || null,
      vehicle_model: row.vehicle_model,
      vehicle_make: row.vehicle_make,
      plate: row.vehicle_plate,
      vehicle_plate: row.vehicle_plate,
      reason: row.reason,
      status: normalizeStatus(row.status),
      called_at: row.called_at,
      updated_at: row.updated_at || new Date().toISOString(),
    };
    const { error } = await supabase.from('urgencias').upsert(payload, {
      onConflict: 'external_ref',
    });
    if (error) {
      console.warn('[urgencias] supabase upsert failed:', error.message || error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (error) {
    console.warn('[urgencias] supabase sync skipped:', error?.message || error);
    return { ok: false, skipped: true, error: error?.message || String(error) };
  }
}

/**
 * @param {'active'|'history'|'all'} scope
 * - active: last 24 hours
 * - history: older than 24h and younger than 60 days
 * - all: anything still retained (< 60 days)
 */
export function listUrgencias({
  shopId,
  scope = 'active',
  limit = 50,
  offset = 0,
  now = new Date(),
} = {}) {
  const params = [shopId];
  let where = 'shop_id = $1 AND is_urgent = TRUE';

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
      WHERE shop_id = $1 AND is_urgent = TRUE AND status = 'pending' AND created_at >= $2::timestamptz`,
    [shopId, since.toISOString()],
  );
  return row?.count ?? 0;
}

async function firstAvailableSlot(shop, { from = null, now = new Date() } = {}) {
  const startDate = from ?? zonedDateString(now, shop.timezone);
  const availability = await getAvailability({ shop, from: startDate, days: 14, now });
  for (const day of availability.days) {
    const slot = day.slots.find((entry) => entry.available);
    if (slot) return new Date(slot.start_at);
  }
  return null;
}

/**
 * Shop owner accepts an urgencia → creates a confirmed appointment and links it.
 * Prefer an explicit scheduledDate+scheduledTime (shop-local) from the accept modal.
 */
export async function acceptUrgencia({
  shop,
  urgenciaId,
  actorUserId = null,
  scheduledAt = null,
  scheduledDate = null,
  scheduledTime = null,
  now = new Date(),
} = {}) {
  if (!shop?.id) throw badRequest('shop is required');
  const row = await getUrgencia(shop.id, urgenciaId);
  if (!row) throw notFound('Urgencia no encontrada');

  if (row.status === 'accepted' && row.appointment_id) {
    const existing = await getAppointment(shop.id, row.appointment_id);
    return {
      urgencia: serializeUrgencia(row, { timezone: shop.timezone }),
      appointment: serializeAppointment(existing, { timezone: shop.timezone }),
      already_accepted: true,
    };
  }

  if (row.status === 'accepted') {
    throw conflict('Esta urgencia ya fue aceptada', { code: 'urgencia_already_accepted' });
  }

  const phone = String(row.customer_phone || '').trim();
  if (!phone || phone === 'Sin teléfono') {
    throw badRequest('La urgencia no tiene un teléfono válido para crear la reserva', {
      code: 'urgencia_missing_phone',
    });
  }

  const callDay = zonedDateString(
    row.called_at ? new Date(row.called_at) : row.created_at ? new Date(row.created_at) : now,
    shop.timezone,
  );

  let when = null;
  if (scheduledDate && scheduledTime) {
    const dateParts = parseDateOnly(scheduledDate);
    if (!dateParts) {
      throw badRequest('Fecha inválida', { code: 'invalid_scheduled_date' });
    }
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(scheduledTime).trim());
    if (!timeMatch) {
      throw badRequest('Hora inválida', { code: 'invalid_scheduled_time' });
    }
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (hour > 23 || minute > 59) {
      throw badRequest('Hora inválida', { code: 'invalid_scheduled_time' });
    }
    if (scheduledDate < callDay) {
      throw badRequest('La fecha no puede ser anterior a la llamada', {
        code: 'scheduled_before_call',
        details: { min_date: callDay },
      });
    }
    when = utcFromZoned({ ...dateParts, hour, minute }, shop.timezone);
  } else if (scheduledAt instanceof Date) {
    when = scheduledAt;
  } else if (scheduledAt) {
    when = new Date(scheduledAt);
  } else {
    when = await firstAvailableSlot(shop, { now });
  }

  if (!when || Number.isNaN(when.getTime())) {
    when = utcFromZoned(
      { ...parseDateOnly(zonedDateString(now, shop.timezone)), hour: 9, minute: 0 },
      shop.timezone,
    );
  }

  const notesParts = [
    'Convertida desde Urgencias (aceptación manual).',
    row.reason ? `Motivo: ${row.reason}` : null,
    row.summary && row.summary !== row.reason ? `Resumen: ${row.summary}` : null,
  ].filter(Boolean);

  const appointment = await createAppointment({
    shop,
    input: {
      customer_name: row.customer_name || 'Cliente sin nombre',
      customer_phone: phone,
      vehicle_make: row.vehicle_make ?? null,
      vehicle_model: row.vehicle_model ?? null,
      vehicle_plate: row.vehicle_plate ?? null,
      service_type: row.reason || URGENCIA_DEFAULT_TITLE,
      notes: notesParts.join('\n'),
      scheduled_at: when,
      duration_minutes: shop.slot_minutes,
      status: 'confirmed',
    },
    source: 'retell',
    enforceSchedule: false,
    externalRef: row.external_ref || `urgencia:${row.id}`,
    actorUserId,
    notify: true,
  });

  const updated = await queryOne(
    `UPDATE urgencias
        SET status = 'accepted',
            appointment_id = $3,
            accepted_at = now(),
            updated_at = now()
      WHERE shop_id = $1 AND id = $2
      RETURNING *`,
    [shop.id, row.id, appointment.id],
  );

  // Block the slot on Cal.com. Await so Render logs show success/error in this request.
  let calcom = null;
  try {
    const fecha =
      scheduledDate ||
      (when ? zonedDateString(when, shop.timezone || 'Atlantic/Canary') : null);
    const hora = scheduledTime
      ? String(scheduledTime).trim()
      : when
        ? formatInZone(when, shop.timezone || 'Atlantic/Canary', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        : null;
    calcom = await createCalcomBooking({ shop, appointment, fecha, hora });
    if (calcom?.skipped) {
      console.warn('[urgencias] cal.com skipped', calcom);
    } else if (calcom?.ok) {
      console.log('[urgencias] cal.com booking linked', {
        appointmentId: appointment.id,
        uid: calcom.uid,
      });
    } else {
      console.error('[urgencias] cal.com booking failed (reserva still accepted)', calcom);
    }
  } catch (error) {
    console.error('Error Cal.com API:', error?.message || error);
  }

  const serializedUrgencia = serializeUrgencia(updated, { timezone: shop.timezone });
  const serializedAppointment = serializeAppointment(appointment, { timezone: shop.timezone });

  hub.publish(channels.shop(shop.id), {
    type: 'urgencia_accepted',
    shop_id: shop.id,
    urgencia: serializedUrgencia,
    appointment: serializedAppointment,
  });

  return {
    urgencia: serializedUrgencia,
    appointment: serializedAppointment,
    already_accepted: false,
  };
}
