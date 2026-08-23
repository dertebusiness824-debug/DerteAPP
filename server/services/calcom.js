/**
 * Cal.com booking sync — blocks the accepted Urgencia slot on the calendar.
 *
 * Env (Render):
 *   CAL_API_KEY          (alias: CALCOM_API_KEY)
 *   CAL_EVENT_TYPE_ID    (alias: CALCOM_EVENT_TYPE_ID)
 *   CAL_TIMEZONE         (default: Atlantic/Canary)
 */
import crypto from 'node:crypto';
import config from '../config.js';
import { query, queryAll, queryOne } from '../db/index.js';
import { isValidTimeZone } from '../lib/time.js';
import { notifyNuevaCita } from './web-push.js';

const DEFAULT_EMAIL = 'sin-email@derteapp.com';
const DEFAULT_DURATION_MINUTES = 60;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function unwrapResponseValue(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    return text || null;
  }
  if (typeof value === 'object') {
    if (value.value != null) return unwrapResponseValue(value.value);
    if (value.label != null && typeof value.label !== 'object') {
      return unwrapResponseValue(value.label);
    }
  }
  return null;
}

export function unwrapCalcomWebhook(body = {}) {
  const triggerEvent = String(
    body.triggerEvent || body.trigger_event || body.event || body.type || '',
  );
  const payload =
    body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : body;
  return { triggerEvent, payload };
}

export function isBookingCreatedEvent(triggerEvent) {
  const normalized = String(triggerEvent || '')
    .trim()
    .toUpperCase()
    .replace(/[.\s-]+/g, '_');
  return normalized === 'BOOKING_CREATED' || normalized.endsWith('_BOOKING_CREATED');
}

/** Spanish wall-clock for the push body (`25 ago 2026, 11:00`). */
export function formatFechaHoraCita(startTime, timeZone) {
  const date = startTime instanceof Date ? startTime : new Date(startTime);
  if (!startTime || Number.isNaN(date.getTime())) return 'fecha por confirmar';
  const zone = isValidTimeZone(timeZone) ? timeZone : config.calcom.timeZone || 'Atlantic/Canary';
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function extractCalcomBookingFields(payload = {}) {
  const attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const first = attendees[0] && typeof attendees[0] === 'object' ? attendees[0] : {};
  const responses = payload.responses && typeof payload.responses === 'object' ? payload.responses : {};
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const nombreCliente =
    first.name ||
    unwrapResponseValue(responses.name) ||
    payload.booker?.name ||
    payload.name ||
    'Cliente';
  const tipoServicio =
    payload.eventTitle ||
    unwrapResponseValue(responses.service) ||
    payload.type ||
    payload.title ||
    'Reserva';
  const startTime = payload.startTime || payload.start || payload.start_time || null;
  const timeZone =
    payload.organizer?.timeZone ||
    first.timeZone ||
    payload.timeZone ||
    config.calcom.timeZone ||
    'Atlantic/Canary';
  const uid = payload.uid != null ? String(payload.uid) : payload.bookingId != null ? String(payload.bookingId) : null;
  const organizerEmail = payload.organizer?.email || payload.user?.email || null;

  return {
    nombreCliente: String(nombreCliente).trim() || 'Cliente',
    tipoServicio: String(tipoServicio).trim() || 'Reserva',
    startTime,
    timeZone,
    fechaHoraFormateada: formatFechaHoraCita(startTime, timeZone),
    uid,
    organizerEmail: organizerEmail ? String(organizerEmail).trim().toLowerCase() : null,
    metadata,
    eventTypeId: payload.eventTypeId ?? payload.event_type_id ?? null,
  };
}

export async function resolveCalcomShopId(booking = {}) {
  const metaShop = booking.metadata?.derte_shop_id || booking.metadata?.shop_id;
  if (metaShop && UUID_RE.test(String(metaShop))) return String(metaShop);

  if (booking.uid) {
    const linked = await queryOne(
      `SELECT shop_id FROM appointments WHERE calcom_booking_uid = $1 LIMIT 1`,
      [booking.uid],
    );
    if (linked?.shop_id) return linked.shop_id;
  }

  if (booking.organizerEmail) {
    const byShopEmail = await queryOne(
      `SELECT id FROM shops WHERE lower(email) = lower($1) AND status = 'active' LIMIT 1`,
      [booking.organizerEmail],
    );
    if (byShopEmail?.id) return byShopEmail.id;

    const byOwner = await queryOne(
      `SELECT m.shop_id
         FROM shop_members m
         JOIN users u ON u.id = m.user_id
         JOIN shops s ON s.id = m.shop_id
        WHERE lower(u.email) = lower($1)
          AND s.status = 'active'
        ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.created_at ASC
        LIMIT 1`,
      [booking.organizerEmail],
    );
    if (byOwner?.shop_id) return byOwner.shop_id;
  }

  const active = await queryAll(`SELECT id FROM shops WHERE status = 'active' LIMIT 2`);
  if (active.length === 1) return active[0].id;
  return null;
}

export function verifyCalcomWebhookSignature(rawBody, signatureHeader, secret = config.calcom.webhookSecret) {
  if (!secret) return { ok: true, skipped: true };
  const provided = String(signatureHeader || '')
    .trim()
    .replace(/^sha256=/i, '');
  if (!provided) return { ok: false, reason: 'missing_signature' };
  const expected = crypto.createHmac('sha256', secret).update(String(rawBody || ''), 'utf8').digest('hex');
  try {
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true };
  } catch {
    // Fall through to string compare for non-hex headers.
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length === right.length && crypto.timingSafeEqual(left, right)) return { ok: true };
  return { ok: false, reason: 'bad_signature' };
}

/**
 * BOOKING_CREATED → shop push_subscriptions → web-push.
 * Never throws — webhook ACK must stay 200.
 */
export async function handleCalcomBookingCreated(body, { notify = notifyNuevaCita } = {}) {
  const { triggerEvent, payload } = unwrapCalcomWebhook(body);
  if (!isBookingCreatedEvent(triggerEvent) && !isBookingCreatedEvent(payload?.triggerEvent)) {
    return { skipped: true, reason: 'ignored_event', triggerEvent };
  }

  const booking = extractCalcomBookingFields(payload);
  const shopId = await resolveCalcomShopId(booking);
  if (!shopId) {
    console.warn('[calcom-webhook] skip push — could not resolve shop', {
      uid: booking.uid,
      organizerEmail: booking.organizerEmail,
      eventTypeId: booking.eventTypeId,
    });
    return { skipped: true, reason: 'no_shop', booking };
  }

  console.log('[calcom-webhook] BOOKING_CREATED → web-push', {
    shopId,
    uid: booking.uid,
    nombreCliente: booking.nombreCliente,
    tipoServicio: booking.tipoServicio,
    when: booking.fechaHoraFormateada,
  });

  const result = await notify(shopId, booking);
  return { skipped: false, shopId, booking, result };
}

export default {
  createCalcomBooking,
  queueCalcomBooking,
  fallbackAttendeeEmail,
  buildBookingWindow,
  buildCalcomBookingPayload,
  unwrapCalcomWebhook,
  isBookingCreatedEvent,
  formatFechaHoraCita,
  extractCalcomBookingFields,
  resolveCalcomShopId,
  verifyCalcomWebhookSignature,
  handleCalcomBookingCreated,
};
