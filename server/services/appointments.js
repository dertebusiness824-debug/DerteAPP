import { parseBookingNotes } from '../lib/booking-notes-parse.js';
import { query, queryAll, queryOne, transaction } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { channels, hub } from '../lib/events.js';
import { appointmentReference } from '../lib/ids.js';
import { formatPhone, requirePhone, telLink, whatsappLink } from '../lib/phone.js';
import { formatInZone } from '../lib/time.js';
import { queueCalendarSync } from './google-calendar.js';
import { checkBookable } from './schedule.js';

export const APPOINTMENT_STATUSES = ['pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'no_show'];

// Which transitions the dashboard is allowed to make. Keeps the status column
// meaningful instead of letting any client set any value.
const ALLOWED_TRANSITIONS = {
  pending: ['accepted', 'cancelled', 'no_show'],
  accepted: ['in_progress', 'completed', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: ['pending'],
  no_show: ['pending'],
};

export function serializeAppointment(row, { timezone = 'UTC' } = {}) {
  const tz = row.timezone ?? timezone;
  const scheduledAt = new Date(row.scheduled_at);
  return {
    id: row.id,
    shop_id: row.shop_id,
    shop_name: row.shop_name ?? null,
    reference: row.reference,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    customer_phone_display: formatPhone(row.customer_phone),
    // One-tap call from the booking card — the primary customer contact action.
    customer_tel_link: telLink(row.customer_phone),
    customer_whatsapp_link: whatsappLink(
      row.customer_phone,
      `Hi ${row.customer_name}, about your booking ${row.reference}`,
    ),
    customer_email: row.customer_email ?? null,
    customer_mailto_link: row.customer_email
      ? `mailto:${String(row.customer_email).trim()}?subject=${encodeURIComponent(
          `Reserva ${row.reference}`,
        )}&body=${encodeURIComponent(
          `Hola ${row.customer_name},\n\nRespecto a tu reserva ${row.reference}:\n\n`,
        )}`
      : null,
    vehicle: {
      make: row.vehicle_make ?? null,
      model: row.vehicle_model ?? null,
      year: row.vehicle_year ?? null,
      plate: row.vehicle_plate ?? null,
      label: [row.vehicle_make, row.vehicle_model, row.vehicle_year].filter(Boolean).join(' ') || null,
    },
    service_type: row.service_type ?? null,
    notes: row.notes ?? null,
    internal_notes: row.internal_notes ?? null,
    scheduled_at: scheduledAt.toISOString(),
    scheduled_local: formatInZone(scheduledAt, tz, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    timezone: tz,
    duration_minutes: row.duration_minutes,
    status: row.status,
    price_estimate: row.price_estimate ?? null,
    source: row.source,
    source_url: row.source_url ?? null,
    accepted_at: row.accepted_at ?? null,
    completed_at: row.completed_at ?? null,
    cancelled_reason: row.cancelled_reason ?? null,
    google_event_id: row.google_event_id ?? null,
    google_last_synced_at: row.google_last_synced_at
      ? new Date(row.google_last_synced_at).toISOString()
      : null,
    created_at: row.created_at,
    allowed_transitions: ALLOWED_TRANSITIONS[row.status] ?? [],
  };
}

const SELECT_APPOINTMENT = `
  SELECT a.*, s.timezone, s.name AS shop_name
    FROM appointments a
    JOIN shops s ON s.id = a.shop_id
`;

export const getAppointment = (shopId, id) =>
  queryOne(`${SELECT_APPOINTMENT} WHERE a.id = $1 AND a.shop_id = $2`, [id, shopId]);

/**
 * When email / vehicle / plate are empty, parse "Nota del cliente" (notes) and
 * persist the extracted fields so the booking card shows real values instead of "—".
 */
export async function enrichAppointmentFromNotes(appointment) {
  if (!appointment?.notes) return appointment;

  const needsEmail = !appointment.customer_email;
  const needsMake = !appointment.vehicle_make;
  const needsModel = !appointment.vehicle_model;
  const needsPlate = !appointment.vehicle_plate;
  if (!needsEmail && !needsMake && !needsModel && !needsPlate) return appointment;

  const parsed = parseBookingNotes(appointment.notes);
  const email = needsEmail ? parsed.email : null;
  const make = needsMake ? parsed.vehicle_make : null;
  const model = needsModel ? parsed.vehicle_model : null;
  const plate = needsPlate ? parsed.vehicle_plate : null;

  if (!email && !make && !model && !plate) return appointment;

  console.log('[appointments] enrich from notes', {
    id: appointment.id,
    email,
    make,
    model,
    plate,
  });

  await query(
    `UPDATE appointments
        SET customer_email = COALESCE(customer_email, $2),
            vehicle_make = COALESCE(NULLIF(vehicle_make, ''), $3),
            vehicle_model = COALESCE(NULLIF(vehicle_model, ''), $4),
            vehicle_plate = COALESCE(NULLIF(vehicle_plate, ''), $5)
      WHERE id = $1`,
    [appointment.id, email, make, model, plate],
  );

  return (await getAppointment(appointment.shop_id, appointment.id)) ?? appointment;
}

export function listAppointments({
  shopId,
  status = null,
  from = null,
  to = null,
  search = null,
  limit = 50,
  offset = 0,
}) {
  const statuses = Array.isArray(status) ? status : status ? [status] : null;
  return queryAll(
    `${SELECT_APPOINTMENT}
      WHERE a.shop_id = $1
        AND ($2::text[] IS NULL OR a.status = ANY($2::text[]))
        AND ($3::timestamptz IS NULL OR a.scheduled_at >= $3)
        AND ($4::timestamptz IS NULL OR a.scheduled_at < $4)
        AND ($5::text IS NULL OR a.customer_name ILIKE '%' || $5 || '%'
             OR a.customer_phone ILIKE '%' || $5 || '%'
             OR a.reference ILIKE '%' || $5 || '%'
             OR a.vehicle_plate ILIKE '%' || $5 || '%')
      ORDER BY a.scheduled_at ASC
      LIMIT $6 OFFSET $7`,
    [shopId, statuses, from, to, search, limit, offset],
  );
}

/**
 * Creates an appointment. Bookings coming from a Hostinger site are always
 * schedule-checked; dashboard entries may override (`enforceSchedule: false`)
 * so an owner can slot in a walk-in outside normal hours.
 */
export async function createAppointment({
  shop,
  input,
  source = 'hostinger',
  enforceSchedule = true,
  actorUserId = null,
  // Lets a customer type their local number into the shop's own booking form.
  defaultCountryCode = null,
  // Provider reference (e.g. `retell:<call_id>`) that makes webhook ingestion
  // idempotent.
  externalRef = null,
  // Integrations that raise their own, more specific alert can opt out.
  notify = true,
}) {
  const customerPhone = requirePhone(input.customer_phone, 'customer_phone', { defaultCountryCode });
  const scheduledAt = input.scheduled_at instanceof Date ? input.scheduled_at : new Date(input.scheduled_at);
  if (Number.isNaN(scheduledAt.getTime())) throw badRequest('scheduled_at must be a valid date and time');

  const duration = Number(input.duration_minutes) || shop.slot_minutes;

  if (enforceSchedule) {
    const check = await checkBookable({ shop, scheduledAt, durationMinutes: duration });
    if (!check.ok) throw conflict(check.message, { code: check.reason, details: { reason: check.reason } });
  }

  const appointment = await queryOne(
    `INSERT INTO appointments
       (shop_id, reference, customer_name, customer_phone, customer_email,
        vehicle_make, vehicle_model, vehicle_year, vehicle_plate,
        service_type, notes, scheduled_at, duration_minutes, status, source, source_url, price_estimate,
        external_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      shop.id,
      appointmentReference(),
      String(input.customer_name).trim(),
      customerPhone,
      input.customer_email ?? null,
      input.vehicle_make ?? null,
      input.vehicle_model ?? null,
      input.vehicle_year ?? null,
      input.vehicle_plate ? String(input.vehicle_plate).toUpperCase().trim() : null,
      input.service_type ?? null,
      input.notes ?? null,
      scheduledAt.toISOString(),
      duration,
      input.status ?? 'pending',
      source,
      input.source_url ?? null,
      input.price_estimate ?? null,
      externalRef,
    ],
  );

  if (notify) {
    await query(
      `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
       SELECT m.user_id, $1, 'appointment_created', $2, $3, $4
         FROM shop_members m WHERE m.shop_id = $1`,
      [
        shop.id,
        'New booking request',
        `${appointment.customer_name} · ${formatInZone(scheduledAt, shop.timezone, {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        `/appointments/${appointment.id}`,
      ],
    );
  }

  await query(
    `INSERT INTO site_events (shop_id, event_type, path, metadata)
     VALUES ($1, 'booking_created', $2, $3)`,
    [shop.id, input.source_url ?? null, { appointment_id: appointment.id, source }],
  );

  if (actorUserId) {
    await recordAudit({ actorUserId, shopId: shop.id, action: 'appointment.create', entityId: appointment.id });
  }

  const full = await getAppointment(shop.id, appointment.id);
  hub.publish(channels.shop(shop.id), {
    type: 'appointment_created',
    shop_id: shop.id,
    appointment: serializeAppointment(full, { timezone: shop.timezone }),
  });

  queueCalendarSync(shop, full, { action: 'upsert' });
  return full;
}

/**
 * Confirms a pending appointment inside the app (status → accepted / "Confirmada").
 * Customers are contacted by phone from the booking card; Super Admin is notified.
 */
export async function acceptAppointment({ shop, appointmentId, user }) {
  let newlyConfirmed = false;
  const appointment = await transaction(async (client) => {
    const current = await client
      .query('SELECT * FROM appointments WHERE id = $1 AND shop_id = $2 FOR UPDATE', [appointmentId, shop.id])
      .then(({ rows }) => rows[0]);
    if (!current) throw notFound('Appointment not found');

    if (!['pending', 'accepted'].includes(current.status)) {
      throw conflict(`An appointment marked "${current.status}" can no longer be accepted`, {
        code: 'invalid_transition',
      });
    }

    if (current.status === 'pending') {
      await client.query(
        `UPDATE appointments SET status = 'accepted', accepted_at = now(), accepted_by = $2 WHERE id = $1`,
        [current.id, user?.id ?? null],
      );
      newlyConfirmed = true;
    }
    return current;
  });

  const full = await getAppointment(shop.id, appointment.id);
  const serialized = serializeAppointment(full, { timezone: shop.timezone });

  hub.publish(channels.shop(shop.id), {
    type: 'appointment_updated',
    shop_id: shop.id,
    appointment: serialized,
  });

  if (newlyConfirmed) {
    await notifySuperAdminAppointmentConfirmed(shop, full, serialized, user);
    if (user?.id) {
      await recordAudit({
        actorUserId: user.id,
        shopId: shop.id,
        action: 'appointment.confirm',
        entityType: 'appointment',
        entityId: full.id,
      });
    }
  }

  queueCalendarSync(shop, full, { action: 'upsert' });
  return { appointment: full, confirmed: newlyConfirmed };
}

/** Persists an in-app confirmation alert for every active Super Admin + SSE nudge. */
async function notifySuperAdminAppointmentConfirmed(shop, appointment, serialized, user) {
  const when = formatInZone(new Date(appointment.scheduled_at), shop.timezone || 'Europe/Madrid', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const confirmer = user?.full_name ? ` por ${user.full_name}` : '';
  const title = 'Cita confirmada por el taller';
  const body = `${shop.name}: ${appointment.customer_name} · ${when}${confirmer}`;
  const link = `/appointments/${appointment.id}`;

  try {
    await query(
      `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
       SELECT u.id, $1, 'appointment_confirmed', $2, $3, $4
         FROM users u
        WHERE u.role = 'super_admin'
          AND u.status = 'active'`,
      [shop.id, title, body, link],
    );

    hub.publish(channels.admin(), {
      type: 'appointment_confirmed',
      shop_id: shop.id,
      shop_name: shop.name,
      confirmed_by: user?.full_name ?? null,
      appointment: serialized,
    });
  } catch (error) {
    console.error('[appointments] super_admin confirm notify failed', appointment.id, error.message);
  }
}

export async function updateStatus({ shop, appointmentId, status, reason = null, user = null }) {
  if (!APPOINTMENT_STATUSES.includes(status)) throw badRequest('Unknown appointment status');

  const current = await queryOne('SELECT * FROM appointments WHERE id = $1 AND shop_id = $2', [appointmentId, shop.id]);
  if (!current) throw notFound('Appointment not found');
  if (current.status === status) return getAppointment(shop.id, appointmentId);

  if (!(ALLOWED_TRANSITIONS[current.status] ?? []).includes(status)) {
    throw conflict(`Cannot move an appointment from "${current.status}" to "${status}"`, {
      code: 'invalid_transition',
      details: { from: current.status, allowed: ALLOWED_TRANSITIONS[current.status] ?? [] },
    });
  }

  if (status === 'accepted') {
    const accepted = await acceptAppointment({ shop, appointmentId, user });
    return accepted.appointment;
  }

  await query(
    `UPDATE appointments
        SET status = $2,
            cancelled_reason = CASE WHEN $2 IN ('cancelled', 'no_show') THEN $3 ELSE cancelled_reason END,
            completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END
      WHERE id = $1`,
    [appointmentId, status, reason],
  );

  if (user) {
    await recordAudit({
      actorUserId: user.id,
      shopId: shop.id,
      action: 'appointment.status',
      entityId: appointmentId,
      metadata: { from: current.status, to: status },
    });
  }

  const full = await getAppointment(shop.id, appointmentId);
  hub.publish(channels.shop(shop.id), {
    type: 'appointment_updated',
    shop_id: shop.id,
    appointment: serializeAppointment(full, { timezone: shop.timezone }),
  });

  queueCalendarSync(shop, full, {
    action: ['cancelled', 'no_show'].includes(status) ? 'delete' : 'upsert',
  });
  return full;
}

export async function updateAppointment({ shop, appointmentId, patch, user = null }) {
  const current = await queryOne('SELECT * FROM appointments WHERE id = $1 AND shop_id = $2', [appointmentId, shop.id]);
  if (!current) throw notFound('Appointment not found');

  if (patch.scheduled_at || patch.duration_minutes) {
    const scheduledAt = patch.scheduled_at ? new Date(patch.scheduled_at) : new Date(current.scheduled_at);
    const duration = patch.duration_minutes ?? current.duration_minutes;
    const check = await checkBookable({
      shop,
      scheduledAt,
      durationMinutes: duration,
      excludeAppointmentId: appointmentId,
    });
    // Owners may deliberately reschedule outside opening hours; only a genuine
    // capacity clash is rejected.
    if (!check.ok && check.reason === 'full') {
      throw conflict(check.message, { code: check.reason });
    }
  }

  const fields = [
    'customer_name',
    'customer_phone',
    'customer_email',
    'vehicle_make',
    'vehicle_model',
    'vehicle_year',
    'vehicle_plate',
    'service_type',
    'notes',
    'internal_notes',
    'scheduled_at',
    'duration_minutes',
    'price_estimate',
  ];
  const updates = [];
  const values = [appointmentId, shop.id];
  for (const field of fields) {
    if (patch[field] === undefined) continue;
    values.push(field === 'customer_phone' ? requirePhone(patch[field], 'customer_phone') : patch[field]);
    updates.push(`${field} = $${values.length}`);
  }
  if (updates.length === 0) return getAppointment(shop.id, appointmentId);

  await query(`UPDATE appointments SET ${updates.join(', ')} WHERE id = $1 AND shop_id = $2`, values);
  if (user) {
    await recordAudit({ actorUserId: user.id, shopId: shop.id, action: 'appointment.update', entityId: appointmentId });
  }

  const full = await getAppointment(shop.id, appointmentId);
  hub.publish(channels.shop(shop.id), {
    type: 'appointment_updated',
    shop_id: shop.id,
    appointment: serializeAppointment(full, { timezone: shop.timezone }),
  });

  queueCalendarSync(shop, full, { action: 'upsert' });
  return full;
}

export const recordAudit = ({ actorUserId = null, shopId = null, action, entityType = null, entityId = null, metadata = {}, ip = null }) =>
  query(
    `INSERT INTO audit_log (actor_user_id, shop_id, action, entity_type, entity_id, metadata, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorUserId, shopId, action, entityType, entityId ? String(entityId) : null, metadata, ip],
  );
