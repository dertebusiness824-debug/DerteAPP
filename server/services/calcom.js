/**
 * Cal.com booking sync — blocks the accepted Urgencia slot on the calendar.
 *
 * Env (Render):
 *   CAL_API_KEY          (alias: CALCOM_API_KEY)
 *   CAL_EVENT_TYPE_ID    (alias: CALCOM_EVENT_TYPE_ID)
 *   CAL_TIMEZONE         (default: Atlantic/Canary)
 */
import config from '../config.js';
import { query } from '../db/index.js';
import { formatInZone } from '../lib/time.js';

const DEFAULT_EMAIL = 'sin-email@derteapp.com';
const DEFAULT_DURATION_MINUTES = 60;

/** Synthetic / fallback email when the caller did not leave one. */
export function fallbackAttendeeEmail(phone, name) {
  const configured = config.calcom.defaultAttendeeEmail;
  if (configured) return configured;
  return DEFAULT_EMAIL;
}

/**
 * Build start/end ISO UTC from a Date (or fecha+hora wall-clock in shop TZ).
 * Matches:
 *   const startTime = new Date(`${fecha}T${hora}:00`).toISOString();
 *   const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();
 * but uses the already-UTC scheduled_at from accept when available.
 */
export function buildBookingWindow({
  scheduledAt,
  fecha = null,
  hora = null,
  durationMinutes = DEFAULT_DURATION_MINUTES,
  timeZone = 'Atlantic/Canary',
} = {}) {
  let start;
  if (scheduledAt) {
    start = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  } else if (fecha && hora) {
    // Interpret fecha/hora as local civil time in the shop/Cal timezone.
    // Appending Z would be wrong; use Intl offset via Date constructed then adjusted.
    const [hh, mm] = String(hora).split(':').map((n) => Number(n));
    const localStamp = `${fecha}T${String(hh).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00`;
    // For Atlantic/Canary / Europe/Madrid, Date.parse of bare local is treated as
    // *server* local. Prefer converting via the appointment's UTC instant when possible.
    start = new Date(localStamp);
  } else {
    start = null;
  }

  if (!start || Number.isNaN(start.getTime())) {
    return { startTime: null, endTime: null, durationMinutes };
  }

  const mins = Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MINUTES;
  const startTime = start.toISOString();
  const endTime = new Date(start.getTime() + mins * 60 * 1000).toISOString();
  return { startTime, endTime, durationMinutes: mins, timeZone };
}

/** v1-style body (also accepted patterns for many Cal.com installs). */
export function buildCalcomBookingPayload({
  appointment,
  shop,
  startTime,
  endTime,
  timeZone = 'Atlantic/Canary',
}) {
  const eventTypeId = Number(config.calcom.eventTypeId);
  const clienteNombre = appointment?.customer_name || 'Cliente Urgencia';
  const clienteEmail =
    appointment?.customer_email ||
    fallbackAttendeeEmail(appointment?.customer_phone, appointment?.customer_name);

  return {
    eventTypeId,
    start: startTime,
    end: endTime,
    responses: {
      name: clienteNombre,
      email: clienteEmail,
      notes: [
        appointment?.service_type,
        appointment?.vehicle_plate ? `Matrícula: ${appointment.vehicle_plate}` : null,
        appointment?.customer_phone ? `Tel: ${appointment.customer_phone}` : null,
        appointment?.notes,
      ]
        .filter(Boolean)
        .join('\n'),
      location: {
        value: 'inPerson',
        optionValue: 'Taller',
      },
    },
    timeZone: timeZone || shop?.timezone || config.calcom.timeZone || 'Atlantic/Canary',
    language: 'es',
    metadata: {
      derte_appointment_id: appointment?.id ?? null,
      derte_shop_id: shop?.id ?? null,
      derte_reference: appointment?.reference ?? null,
    },
  };
}

async function postCalcom(url, { headers = {}, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text, ok: response.ok, status: response.status };
}

/**
 * Creates a Cal.com booking for the accepted appointment.
 * Never throws to callers — acceptance must succeed even if Cal.com is down.
 */
export async function createCalcomBooking({ shop, appointment, fecha = null, hora = null } = {}) {
  if (!config.calcom.configured) {
    console.warn(
      '[calcom] skip — not configured. Set CAL_API_KEY and CAL_EVENT_TYPE_ID (or CALCOM_* aliases) in Render.',
    );
    return { skipped: true, reason: 'not_configured' };
  }
  if (!appointment?.id) {
    console.warn('[calcom] skip — missing appointment');
    return { skipped: true, reason: 'missing_appointment' };
  }

  const timeZone = config.calcom.timeZone || shop?.timezone || 'Atlantic/Canary';
  const durationMinutes =
    Number(appointment.duration_minutes) || Number(shop?.slot_minutes) || DEFAULT_DURATION_MINUTES;

  const { startTime, endTime } = buildBookingWindow({
    scheduledAt: appointment.scheduled_at,
    fecha,
    hora,
    durationMinutes,
    timeZone,
  });

  if (!startTime || !endTime) {
    console.error('[calcom] skip — could not build start/end ISO times', {
      scheduled_at: appointment.scheduled_at,
      fecha,
      hora,
    });
    return { skipped: true, reason: 'invalid_window' };
  }

  const payload = buildCalcomBookingPayload({
    appointment,
    shop,
    startTime,
    endTime,
    timeZone,
  });

  console.log('[calcom] creating booking', {
    appointmentId: appointment.id,
    shopId: shop?.id,
    eventTypeId: payload.eventTypeId,
    start: payload.start,
    end: payload.end,
    timeZone: payload.timeZone,
    apiVersion: config.calcom.apiVersion,
  });

  try {
    let url;
    let headers = {};

    if (config.calcom.apiVersion === 'v2') {
      url = `${config.calcom.apiUrl}/v2/bookings`;
      headers = {
        Authorization: `Bearer ${config.calcom.apiKey}`,
        'cal-api-version': config.calcom.apiVersionHeader,
      };
      // v2 prefers attendee; still send start + eventTypeId. Keep responses for compatibility.
      const v2Body = {
        eventTypeId: payload.eventTypeId,
        start: payload.start,
        attendee: {
          name: payload.responses.name,
          email: payload.responses.email,
          timeZone: payload.timeZone,
          language: 'es',
          phoneNumber: appointment.customer_phone || undefined,
        },
        metadata: payload.metadata,
        location: { type: 'inPerson', address: 'Taller' },
      };
      const { ok, status, text } = await postCalcom(url, { headers, body: v2Body });
      if (!ok) {
        console.error('Error Cal.com API:', status, text);
        return { ok: false, status, error: text };
      }
      return persistCalcomResult(appointment.id, text, startTime);
    }

    // Default: v1 POST /v1/bookings?apiKey=… with start + end + responses
    url = `${config.calcom.apiUrl}/v1/bookings?apiKey=${encodeURIComponent(config.calcom.apiKey)}`;
    const { ok, status, text } = await postCalcom(url, { headers: {}, body: payload });

    if (!ok) {
      console.error('Error Cal.com API:', status, text);
      return { ok: false, status, error: text };
    }

    return persistCalcomResult(appointment.id, text, startTime);
  } catch (error) {
    console.error('Error Cal.com API:', error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}

async function persistCalcomResult(appointmentId, text, startTime) {
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  const data = json?.data ?? json;
  const uid = data?.uid != null ? String(data.uid) : data?.id != null ? String(data.id) : null;
  const bookingId = data?.id != null ? String(data.id) : null;

  if (uid || bookingId) {
    await query(
      `UPDATE appointments
          SET calcom_booking_uid = COALESCE($2, calcom_booking_uid),
              calcom_booking_id = COALESCE($3, calcom_booking_id),
              calcom_last_synced_at = now()
        WHERE id = $1`,
      [appointmentId, uid, bookingId],
    );
  }

  console.log('[calcom] booking created OK', {
    appointmentId,
    uid,
    bookingId,
    start: startTime,
  });

  return { ok: true, uid, bookingId, data };
}

/**
 * Queue Cal.com sync. Prefer awaiting `createCalcomBooking` from accept when
 * you need Render logs in the same request; this helper stays fire-and-forget.
 */
export function queueCalcomBooking(shop, appointment, extras = {}) {
  if (!config.calcom.configured) {
    console.warn(
      '[calcom] queue skipped — set CAL_API_KEY and CAL_EVENT_TYPE_ID on Render',
    );
    return;
  }
  setImmediate(() => {
    void createCalcomBooking({ shop, appointment, ...extras });
  });
}

export default {
  createCalcomBooking,
  queueCalcomBooking,
  fallbackAttendeeEmail,
  buildBookingWindow,
  buildCalcomBookingPayload,
};
