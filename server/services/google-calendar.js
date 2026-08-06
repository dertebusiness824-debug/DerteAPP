/**
 * Google Calendar sync for shop appointments.
 *
 * Auth modes (first match wins per shop):
 * 1. Shop OAuth refresh token (owner connected their Google account)
 * 2. Platform service account + shop.google_calendar_id (calendar shared with SA)
 *
 * Sync failures are logged and never fail the booking write path.
 */
import { google } from 'googleapis';
import config from '../config.js';
import { query, queryOne } from '../db/index.js';
import { formatPhone } from '../lib/phone.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export const googleCalendarConfigured = () => config.googleCalendar.configured;

export const shopCalendarConnected = (shop) =>
  Boolean(
    shop?.google_calendar_sync_enabled &&
      shop?.google_calendar_id &&
      (shop?.google_calendar_refresh_token || config.googleCalendar.serviceAccountConfigured),
  );

export function serializeGoogleCalendarStatus(shop) {
  return {
    configured: googleCalendarConfigured(),
    oauth_configured: config.googleCalendar.oauthConfigured,
    service_account_configured: config.googleCalendar.serviceAccountConfigured,
    service_account_email: config.googleCalendar.serviceAccountConfigured
      ? config.googleCalendar.serviceAccountEmail
      : null,
    connected: shopCalendarConnected(shop),
    sync_enabled: Boolean(shop?.google_calendar_sync_enabled),
    calendar_id: shop?.google_calendar_id ?? null,
    connected_email: shop?.google_calendar_connected_email ?? null,
  };
}

function oauth2Client() {
  const { clientId, clientSecret, redirectUri } = config.googleCalendar;
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Builds the Google consent URL for a shop. `state` must carry shop_id. */
export function buildConnectUrl({ shopId, userId }) {
  const client = oauth2Client();
  if (!client) throw new Error('Google Calendar OAuth no está configurado');
  const state = Buffer.from(JSON.stringify({ shopId, userId, t: Date.now() })).toString('base64url');
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

export function parseOAuthState(state) {
  try {
    return JSON.parse(Buffer.from(String(state ?? ''), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Exchanges the OAuth code and stores tokens + primary calendar on the shop. */
export async function completeOAuthConnect({ shopId, code }) {
  const client = oauth2Client();
  if (!client) throw new Error('Google Calendar OAuth no está configurado');

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const calendarApi = google.calendar({ version: 'v3', auth: client });

  const [profile, primary] = await Promise.all([
    oauth2.userinfo.get().catch(() => ({ data: {} })),
    calendarApi.calendars.get({ calendarId: 'primary' }).catch(() => ({ data: { id: 'primary' } })),
  ]);

  const calendarId = primary.data.id || 'primary';
  const email = profile.data.email ?? null;

  const shop = await queryOne(
    `UPDATE shops
        SET google_calendar_id = $2,
            google_calendar_refresh_token = COALESCE($3, google_calendar_refresh_token),
            google_calendar_access_token = $4,
            google_calendar_token_expiry = $5,
            google_calendar_connected_email = $6,
            google_calendar_sync_enabled = true
      WHERE id = $1
      RETURNING *`,
    [
      shopId,
      calendarId,
      tokens.refresh_token ?? null,
      tokens.access_token ?? null,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      email,
    ],
  );

  return shop;
}

export async function saveCalendarId({ shopId, calendarId, enabled = true }) {
  return queryOne(
    `UPDATE shops
        SET google_calendar_id = $2,
            google_calendar_sync_enabled = $3
      WHERE id = $1
      RETURNING *`,
    [shopId, calendarId?.trim() || null, Boolean(enabled && calendarId)],
  );
}

export async function disconnectCalendar(shopId) {
  // Keep calendar_id so re-enabling with a service account is easy.
  return queryOne(
    `UPDATE shops
        SET google_calendar_sync_enabled = false,
            google_calendar_refresh_token = NULL,
            google_calendar_access_token = NULL,
            google_calendar_token_expiry = NULL,
            google_calendar_connected_email = NULL
      WHERE id = $1
      RETURNING *`,
    [shopId],
  );
}

async function persistTokens(shopId, credentials) {
  if (!credentials?.access_token && !credentials?.refresh_token) return;
  await query(
    `UPDATE shops
        SET google_calendar_access_token = COALESCE($2, google_calendar_access_token),
            google_calendar_refresh_token = COALESCE($3, google_calendar_refresh_token),
            google_calendar_token_expiry = COALESCE($4, google_calendar_token_expiry)
      WHERE id = $1`,
    [
      shopId,
      credentials.access_token ?? null,
      credentials.refresh_token ?? null,
      credentials.expiry_date ? new Date(credentials.expiry_date) : null,
    ],
  );
}

async function getAuthForShop(shop) {
  if (shop.google_calendar_refresh_token && config.googleCalendar.oauthConfigured) {
    const client = oauth2Client();
    client.setCredentials({
      refresh_token: shop.google_calendar_refresh_token,
      access_token: shop.google_calendar_access_token ?? undefined,
      expiry_date: shop.google_calendar_token_expiry
        ? new Date(shop.google_calendar_token_expiry).getTime()
        : undefined,
    });
    client.on('tokens', (tokens) => {
      void persistTokens(shop.id, tokens);
    });
    return client;
  }

  if (config.googleCalendar.serviceAccountConfigured && shop.google_calendar_id) {
    return new google.auth.JWT({
      email: config.googleCalendar.serviceAccountEmail,
      key: config.googleCalendar.serviceAccountPrivateKey,
      scopes: SCOPES,
    });
  }

  return null;
}

function eventWindow(appointment, shop) {
  const start = new Date(appointment.scheduled_at);
  const end = new Date(start.getTime() + Number(appointment.duration_minutes || shop.slot_minutes || 60) * 60_000);
  const timeZone = shop.timezone || appointment.timezone || 'Europe/Madrid';
  return {
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
  };
}

export function buildCalendarEvent(appointment, shop) {
  const reason = appointment.service_type || 'Cita';
  const title = `${appointment.customer_name} - ${reason}`;
  const vehicle = [appointment.vehicle_make, appointment.vehicle_model, appointment.vehicle_year]
    .filter(Boolean)
    .join(' ');
  const plate = appointment.vehicle_plate || '—';
  const phone = appointment.customer_phone ? formatPhone(appointment.customer_phone) : '—';
  const lines = [
    `Referencia: ${appointment.reference}`,
    `Cliente: ${appointment.customer_name}`,
    `Teléfono: ${phone}`,
    appointment.customer_email ? `Email: ${appointment.customer_email}` : null,
    `Vehículo: ${vehicle || '—'} · Matrícula: ${plate}`,
    `Servicio: ${reason}`,
    `Estado: ${appointment.status}`,
    `Origen: ${appointment.source}`,
    appointment.notes ? `Notas: ${appointment.notes}` : null,
    appointment.cancelled_reason ? `Motivo cancelación: ${appointment.cancelled_reason}` : null,
  ].filter(Boolean);

  return {
    summary: title,
    description: lines.join('\n'),
    ...eventWindow(appointment, shop),
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        derte_appointment_id: String(appointment.id),
        derte_shop_id: String(shop.id),
        derte_reference: String(appointment.reference),
      },
    },
  };
}

async function calendarClient(shop) {
  const auth = await getAuthForShop(shop);
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

export async function createCalendarEvent(shop, appointment) {
  const calendar = await calendarClient(shop);
  if (!calendar || !shop.google_calendar_id) return null;
  const { data } = await calendar.events.insert({
    calendarId: shop.google_calendar_id,
    requestBody: buildCalendarEvent(appointment, shop),
  });
  return data.id ?? null;
}

export async function updateCalendarEvent(shop, appointment) {
  const calendar = await calendarClient(shop);
  if (!calendar || !shop.google_calendar_id || !appointment.google_event_id) return null;
  const { data } = await calendar.events.patch({
    calendarId: shop.google_calendar_id,
    eventId: appointment.google_event_id,
    requestBody: buildCalendarEvent(appointment, shop),
  });
  return data.id ?? appointment.google_event_id;
}

export async function deleteCalendarEvent(shop, eventId) {
  const calendar = await calendarClient(shop);
  if (!calendar || !shop.google_calendar_id || !eventId) return false;
  try {
    await calendar.events.delete({
      calendarId: shop.google_calendar_id,
      eventId,
    });
    return true;
  } catch (error) {
    // Already gone is fine.
    if (error?.code === 404 || error?.status === 404) return true;
    throw error;
  }
}

async function setGoogleEventId(appointmentId, eventId) {
  return queryOne(`UPDATE appointments SET google_event_id = $2 WHERE id = $1 RETURNING *`, [
    appointmentId,
    eventId,
  ]);
}

/**
 * Syncs one appointment to Google Calendar.
 * - cancelled / no_show → delete event (and clear id)
 * - otherwise create or update
 */
export async function syncAppointmentToGoogleCalendar(shop, appointment, { action = 'upsert' } = {}) {
  if (!shopCalendarConnected(shop) || !appointment) return { synced: false, reason: 'not_connected' };

  try {
    const shouldRemove =
      action === 'delete' || ['cancelled', 'no_show'].includes(appointment.status);

    if (shouldRemove) {
      if (appointment.google_event_id) {
        await deleteCalendarEvent(shop, appointment.google_event_id);
        await setGoogleEventId(appointment.id, null);
      }
      return { synced: true, action: 'deleted' };
    }

    if (appointment.google_event_id) {
      await updateCalendarEvent(shop, appointment);
      return { synced: true, action: 'updated', event_id: appointment.google_event_id };
    }

    const eventId = await createCalendarEvent(shop, appointment);
    if (eventId) await setGoogleEventId(appointment.id, eventId);
    return { synced: Boolean(eventId), action: 'created', event_id: eventId };
  } catch (error) {
    console.error('[google-calendar] sync failed', {
      shopId: shop.id,
      appointmentId: appointment.id,
      message: error.message,
    });
    return { synced: false, reason: 'error', message: error.message };
  }
}

/** Fire-and-forget wrapper used by appointment services. */
export function queueCalendarSync(shop, appointment, options) {
  if (!shopCalendarConnected(shop)) return;
  setImmediate(() => {
    void syncAppointmentToGoogleCalendar(shop, appointment, options);
  });
}
