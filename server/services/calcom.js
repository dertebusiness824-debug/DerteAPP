/**
 * Cal.com booking sync (API v2 preferred, v1 fallback).
 * Used when an Urgencia is accepted into a confirmed appointment so the slot
 * is blocked on the Cal.com calendar.
 */
import config from '../config.js';
import { query } from '../db/index.js';
import { formatInZone } from '../lib/time.js';

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Synthetic email when the caller did not leave one (Cal.com requires email). */
export function fallbackAttendeeEmail(phone, name) {
  const configured = config.calcom.defaultAttendeeEmail;
  if (configured) return configured;
  const digits = digitsOnly(phone).slice(-10) || 'unknown';
  const slug = String(name || 'cliente')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'cliente';
  return `${slug}.${digits}@bookings.derteapp.local`;
}

function buildV2Body({ appointment, shop, startIso }) {
  const attendee = {
    name: appointment.customer_name || 'Cliente',
    email: appointment.customer_email || fallbackAttendeeEmail(appointment.customer_phone, appointment.customer_name),
    timeZone: shop.timezone || 'Europe/Madrid',
    language: 'es',
  };
  if (appointment.customer_phone) {
    attendee.phoneNumber = appointment.customer_phone;
  }

  const body = {
    start: startIso,
    attendee,
    metadata: {
      derte_appointment_id: appointment.id,
      derte_shop_id: shop.id,
      derte_reference: appointment.reference ?? null,
      vehicle_plate: appointment.vehicle_plate ?? null,
      service_type: appointment.service_type ?? null,
    },
  };

  if (config.calcom.eventTypeId) {
    body.eventTypeId = config.calcom.eventTypeId;
  } else if (config.calcom.eventTypeSlug && config.calcom.username) {
    body.eventTypeSlug = config.calcom.eventTypeSlug;
    body.username = config.calcom.username;
  }

  return body;
}

function buildV1Body({ appointment, shop, startIso, endIso }) {
  return {
    eventTypeId: config.calcom.eventTypeId,
    start: startIso,
    end: endIso,
    responses: {
      name: appointment.customer_name || 'Cliente',
      email: appointment.customer_email || fallbackAttendeeEmail(appointment.customer_phone, appointment.customer_name),
      notes: [
        appointment.service_type,
        appointment.vehicle_plate ? `Matrícula: ${appointment.vehicle_plate}` : null,
        appointment.notes,
      ]
        .filter(Boolean)
        .join('\n'),
      location: {
        value: 'userPhone',
        optionValue: appointment.customer_phone || '',
      },
    },
    timeZone: shop.timezone || 'Europe/Madrid',
    language: 'es',
    metadata: {
      derte_appointment_id: appointment.id,
      derte_shop_id: shop.id,
    },
  };
}

async function postJson(url, { headers, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

/**
 * Creates a Cal.com booking for the accepted appointment.
 * Never throws to callers — acceptance must succeed even if Cal.com is down.
 */
export async function createCalcomBooking({ shop, appointment }) {
  if (!config.calcom.configured) {
    console.warn('[calcom] skip — not configured (set CALCOM_API_KEY + event type)');
    return { skipped: true, reason: 'not_configured' };
  }
  if (!appointment?.id || !appointment?.scheduled_at) {
    return { skipped: true, reason: 'missing_appointment' };
  }

  const start = new Date(appointment.scheduled_at);
  if (Number.isNaN(start.getTime())) {
    return { skipped: true, reason: 'invalid_scheduled_at' };
  }
  const durationMinutes = Number(appointment.duration_minutes) || shop.slot_minutes || 60;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  console.log('[calcom] creating booking', {
    appointmentId: appointment.id,
    shopId: shop.id,
    start: startIso,
    eventTypeId: config.calcom.eventTypeId || null,
    eventTypeSlug: config.calcom.eventTypeSlug || null,
  });

  try {
    let result;
    if (config.calcom.apiVersion === 'v1') {
      const url = `${config.calcom.apiUrl}/v1/bookings?apiKey=${encodeURIComponent(config.calcom.apiKey)}`;
      result = await postJson(url, {
        headers: {},
        body: buildV1Body({ appointment, shop, startIso, endIso }),
      });
    } else {
      const url = `${config.calcom.apiUrl}/v2/bookings`;
      result = await postJson(url, {
        headers: {
          Authorization: `Bearer ${config.calcom.apiKey}`,
          'cal-api-version': config.calcom.apiVersionHeader,
        },
        body: buildV2Body({ appointment, shop, startIso }),
      });
    }

    if (!result.ok) {
      console.error('[calcom] create booking failed', {
        status: result.status,
        body: result.json,
        appointmentId: appointment.id,
      });
      return { ok: false, status: result.status, error: result.json };
    }

    const data = result.json?.data ?? result.json;
    const uid = data?.uid ?? data?.id ?? null;
    const bookingId = data?.id != null ? String(data.id) : null;

    if (uid || bookingId) {
      await query(
        `UPDATE appointments
            SET calcom_booking_uid = COALESCE($2, calcom_booking_uid),
                calcom_booking_id = COALESCE($3, calcom_booking_id),
                calcom_last_synced_at = now()
          WHERE id = $1`,
        [appointment.id, uid != null ? String(uid) : null, bookingId],
      );
    }

    console.log('[calcom] booking created', {
      appointmentId: appointment.id,
      uid,
      bookingId,
      startLocal: formatInZone(start, shop.timezone || 'Europe/Madrid', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    });

    return { ok: true, uid, bookingId, data };
  } catch (error) {
    console.error('[calcom] create booking error:', error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}

/** Fire-and-forget Cal.com sync (mirrors Google Calendar queue pattern). */
export function queueCalcomBooking(shop, appointment) {
  if (!config.calcom.configured) return;
  setImmediate(() => {
    void createCalcomBooking({ shop, appointment });
  });
}

export default {
  createCalcomBooking,
  queueCalcomBooking,
  fallbackAttendeeEmail,
};
