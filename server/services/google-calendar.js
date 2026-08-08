/**
 * Google Calendar sync for shop appointments (bidirectional).
 *
 * Outbound: DerteAPP create/update/cancel → calendar.events insert/patch/delete
 * Inbound:  calendar.events.watch push → webhook → events.list → update appointments
 *
 * Auth modes (first match wins per shop):
 * 1. Shop OAuth refresh token (owner connected their Google account)
 * 2. Platform service account + shop.google_calendar_id (calendar shared with SA)
 *
 * Sync failures are logged and never fail the booking write path.
 */
import crypto from 'node:crypto';
import { google } from 'googleapis';
import config from '../config.js';
import { parseBookingNotes, plainBookingText } from '../lib/booking-notes-parse.js';
import { query, queryOne, queryAll } from '../db/index.js';
import { channels, hub } from '../lib/events.js';
import { appointmentReference, randomToken } from '../lib/ids.js';
import { formatPhone, normalizePhone } from '../lib/phone.js';
import { formatInZone, parseDateOnly, utcFromZoned, zonedDateString } from '../lib/time.js';
import {
  clearGoogleCalendarTokensOnSupabase,
  syncGoogleCalendarTokensToSupabase,
  syncShopToSupabase,
} from './supabase-sync.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const WATCH_TTL_MS = 6 * 24 * 60 * 60_000; // renew before Google's ~7 day max
const INBOUND_SKIP_MS = 60_000; // ignore echo of our own outbound writes

export const googleCalendarConfigured = () => config.googleCalendar.configured;

export const googleCalendarWebhookUrl = () =>
  `${config.appUrl}/api/shops/google-calendar/webhook`;

export const shopCalendarConnected = (shop) =>
  Boolean(
    shop?.google_calendar_sync_enabled &&
      shop?.google_calendar_id &&
      (shop?.google_calendar_refresh_token || config.googleCalendar.serviceAccountConfigured),
  );

export function serializeGoogleCalendarStatus(shop) {
  const watchExpiry = shop?.google_calendar_watch_expiration
    ? new Date(shop.google_calendar_watch_expiration)
    : null;
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
    watch_active: Boolean(watchExpiry && watchExpiry.getTime() > Date.now()),
    watch_expiration: watchExpiry ? watchExpiry.toISOString() : null,
    webhook_url: googleCalendarWebhookUrl(),
  };
}

function oauth2Client() {
  const { clientId, clientSecret, redirectUri } = config.googleCalendar;
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Channel token binds a watch notification to a shop (HMAC). */
export function buildWatchChannelToken(shopId) {
  const sig = crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(`gcal-watch:${shopId}`)
    .digest('base64url')
    .slice(0, 32);
  return `${shopId}.${sig}`;
}

export function verifyWatchChannelToken(token) {
  const raw = String(token ?? '');
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  const shopId = raw.slice(0, dot);
  const expected = buildWatchChannelToken(shopId);
  const a = Buffer.from(raw);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return shopId;
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

  const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
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
      tokenExpiry,
      email,
    ],
  );

  if (shop) {
    await syncShopToSupabase(shop);
    await syncGoogleCalendarTokensToSupabase(shop.id, {
      calendar_id: calendarId,
      refresh_token: tokens.refresh_token ?? null,
      access_token: tokens.access_token ?? null,
      token_expiry: tokenExpiry ? tokenExpiry.toISOString() : null,
      connected_email: email,
      sync_enabled: true,
    });
    await ensureCalendarWatch(shop);
    // Pull existing Google events into DerteAPP right after connect.
    shop._initialSync = await syncShopFromGoogleCalendar(shop, { mode: 'initial', force: true });
  }

  return shop;
}

export async function saveCalendarId({ shopId, calendarId, enabled = true }) {
  const shop = await queryOne(
    `UPDATE shops
        SET google_calendar_id = $2,
            google_calendar_sync_enabled = $3
      WHERE id = $1
      RETURNING *`,
    [shopId, calendarId?.trim() || null, Boolean(enabled && calendarId)],
  );
  if (shop) {
    await syncShopToSupabase(shop);
    await syncGoogleCalendarTokensToSupabase(shop.id, {
      calendar_id: shop.google_calendar_id,
      sync_enabled: shop.google_calendar_sync_enabled,
    });
    if (shop.google_calendar_sync_enabled) {
      await ensureCalendarWatch(shop);
      shop._initialSync = await syncShopFromGoogleCalendar(shop, { mode: 'initial', force: true });
    } else {
      await stopCalendarWatch(shop);
    }
  }
  return shop;
}

export async function disconnectCalendar(shopId) {
  const current = await queryOne('SELECT * FROM shops WHERE id = $1', [shopId]);
  if (current) await stopCalendarWatch(current).catch(() => {});

  const shop = await queryOne(
    `UPDATE shops
        SET google_calendar_sync_enabled = false,
            google_calendar_refresh_token = NULL,
            google_calendar_access_token = NULL,
            google_calendar_token_expiry = NULL,
            google_calendar_connected_email = NULL,
            google_calendar_watch_channel_id = NULL,
            google_calendar_watch_resource_id = NULL,
            google_calendar_watch_expiration = NULL,
            google_calendar_sync_token = NULL
      WHERE id = $1
      RETURNING *`,
    [shopId],
  );
  if (shop) await clearGoogleCalendarTokensOnSupabase(shopId);
  return shop;
}

async function persistTokens(shopId, credentials) {
  if (!credentials?.access_token && !credentials?.refresh_token) return;
  const expiry = credentials.expiry_date ? new Date(credentials.expiry_date) : null;
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
      expiry,
    ],
  );
  await syncGoogleCalendarTokensToSupabase(shopId, {
    access_token: credentials.access_token ?? null,
    refresh_token: credentials.refresh_token ?? null,
    token_expiry: expiry ? expiry.toISOString() : null,
  });
}

function getAuthForShop(shop) {
  if (shop.google_calendar_refresh_token && config.googleCalendar.oauthConfigured) {
    const client = oauth2Client();
    client.setCredentials({
      refresh_token: shop.google_calendar_refresh_token,
      access_token: shop.google_calendar_access_token ?? undefined,
      expiry_date: shop.google_calendar_token_expiry
        ? new Date(shop.google_calendar_token_expiry).getTime()
        : undefined,
    });
    // Auto-refresh: google-auth refreshes access_token and emits `tokens`.
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

function syncStamp() {
  return new Date().toISOString();
}

export function buildCalendarEvent(appointment, shop) {
  const reason = appointment.service_type || 'Cita';
  const title = `${appointment.customer_name} - ${reason}`;
  const vehicle = [appointment.vehicle_make, appointment.vehicle_model, appointment.vehicle_year]
    .filter(Boolean)
    .join(' ');
  const plate = appointment.vehicle_plate || '—';
  const phone = appointment.customer_phone ? formatPhone(appointment.customer_phone) : '—';
  const syncedAt = syncStamp();
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
        derte_sync_at: syncedAt,
      },
    },
  };
}

function calendarClient(shop) {
  const auth = getAuthForShop(shop);
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

async function markAppointmentSynced(appointmentId, eventId = undefined) {
  if (eventId === undefined) {
    return queryOne(
      `UPDATE appointments SET google_last_synced_at = now() WHERE id = $1 RETURNING *`,
      [appointmentId],
    );
  }
  return queryOne(
    `UPDATE appointments
        SET google_event_id = $2,
            google_last_synced_at = now()
      WHERE id = $1
      RETURNING *`,
    [appointmentId, eventId],
  );
}

export async function createCalendarEvent(shop, appointment) {
  const calendar = calendarClient(shop);
  if (!calendar || !shop.google_calendar_id) return null;
  const { data } = await calendar.events.insert({
    calendarId: shop.google_calendar_id,
    requestBody: buildCalendarEvent(appointment, shop),
  });
  return data.id ?? null;
}

export async function updateCalendarEvent(shop, appointment) {
  const calendar = calendarClient(shop);
  if (!calendar || !shop.google_calendar_id || !appointment.google_event_id) return null;
  const { data } = await calendar.events.patch({
    calendarId: shop.google_calendar_id,
    eventId: appointment.google_event_id,
    requestBody: buildCalendarEvent(appointment, shop),
  });
  return data.id ?? appointment.google_event_id;
}

export async function deleteCalendarEvent(shop, eventId) {
  const calendar = calendarClient(shop);
  if (!calendar || !shop.google_calendar_id || !eventId) return false;
  try {
    await calendar.events.delete({
      calendarId: shop.google_calendar_id,
      eventId,
    });
    return true;
  } catch (error) {
    if (error?.code === 404 || error?.status === 404) return true;
    throw error;
  }
}

/**
 * Syncs one appointment to Google Calendar (DerteAPP → Google).
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
        await markAppointmentSynced(appointment.id, null);
      }
      return { synced: true, action: 'deleted' };
    }

    if (appointment.google_event_id) {
      await updateCalendarEvent(shop, appointment);
      await markAppointmentSynced(appointment.id, appointment.google_event_id);
      return { synced: true, action: 'updated', event_id: appointment.google_event_id };
    }

    const eventId = await createCalendarEvent(shop, appointment);
    if (eventId) await markAppointmentSynced(appointment.id, eventId);
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

// --- Push watch (Google → DerteAPP) ------------------------------------------

async function persistWatch(shopId, channel) {
  const expiration = channel.expiration ? new Date(Number(channel.expiration)) : null;
  return queryOne(
    `UPDATE shops
        SET google_calendar_watch_channel_id = $2,
            google_calendar_watch_resource_id = $3,
            google_calendar_watch_expiration = $4
      WHERE id = $1
      RETURNING *`,
    [shopId, channel.id ?? null, channel.resourceId ?? null, expiration],
  );
}

export async function stopCalendarWatch(shop) {
  if (!shop?.google_calendar_watch_channel_id || !shop?.google_calendar_watch_resource_id) {
    return { stopped: false, reason: 'no_watch' };
  }
  const calendar = calendarClient(shop);
  if (!calendar) return { stopped: false, reason: 'no_auth' };
  try {
    await calendar.channels.stop({
      requestBody: {
        id: shop.google_calendar_watch_channel_id,
        resourceId: shop.google_calendar_watch_resource_id,
      },
    });
  } catch (error) {
    // Channel may already be expired/unknown.
    if (![404, 400].includes(error?.code) && ![404, 400].includes(error?.status)) {
      console.warn('[google-calendar] stop watch failed', shop.id, error.message);
    }
  }
  await query(
    `UPDATE shops
        SET google_calendar_watch_channel_id = NULL,
            google_calendar_watch_resource_id = NULL,
            google_calendar_watch_expiration = NULL
      WHERE id = $1`,
    [shop.id],
  );
  return { stopped: true };
}

/**
 * Subscribes to Google push notifications for the shop calendar.
 * Requires a public HTTPS webhook (APP_URL).
 */
export async function ensureCalendarWatch(shop) {
  if (!shopCalendarConnected(shop)) return { watched: false, reason: 'not_connected' };
  if (!config.appUrl.startsWith('https://') && !config.isTest && config.isProduction) {
    console.warn('[google-calendar] watch skipped — APP_URL must be HTTPS in production');
    return { watched: false, reason: 'https_required' };
  }

  const calendar = calendarClient(shop);
  if (!calendar) return { watched: false, reason: 'no_auth' };

  const expiresAt = shop.google_calendar_watch_expiration
    ? new Date(shop.google_calendar_watch_expiration).getTime()
    : 0;
  // Renew if missing or expiring within 24h.
  if (
    shop.google_calendar_watch_channel_id &&
    shop.google_calendar_watch_resource_id &&
    expiresAt > Date.now() + 24 * 60 * 60_000
  ) {
    return { watched: true, reason: 'active', channelId: shop.google_calendar_watch_channel_id };
  }

  if (shop.google_calendar_watch_channel_id) {
    await stopCalendarWatch(shop).catch(() => {});
  }

  const channelId = `derte-${shop.id.slice(0, 8)}-${randomToken(8)}`.slice(0, 64);
  const expiration = Date.now() + WATCH_TTL_MS;

  try {
    const { data } = await calendar.events.watch({
      calendarId: shop.google_calendar_id,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: googleCalendarWebhookUrl(),
        token: buildWatchChannelToken(shop.id),
        expiration: String(expiration),
      },
    });
    await persistWatch(shop.id, data);
    console.log(`[google-calendar] watch started for shop ${shop.id} → ${googleCalendarWebhookUrl()}`);
    return { watched: true, channelId: data.id, expiration: data.expiration };
  } catch (error) {
    console.error('[google-calendar] watch failed', shop.id, error.message);
    return { watched: false, reason: 'error', message: error.message };
  }
}

/** Renew watches that expire soon (called from maintenance). */
export async function renewExpiringCalendarWatches() {
  const shops = await queryAll(
    `SELECT * FROM shops
      WHERE google_calendar_sync_enabled = true
        AND google_calendar_id IS NOT NULL
        AND (
          google_calendar_watch_expiration IS NULL
          OR google_calendar_watch_expiration < now() + interval '36 hours'
        )`,
  );
  let renewed = 0;
  for (const shop of shops) {
    if (!shopCalendarConnected(shop)) continue;
    const result = await ensureCalendarWatch(shop);
    if (result.watched) renewed += 1;
  }
  return { renewed, checked: shops.length };
}

export function shouldSkipInboundSync(appointment, event) {
  const derteSyncAt = event?.extendedProperties?.private?.derte_sync_at;
  if (derteSyncAt) {
    const stamped = Date.parse(derteSyncAt);
    if (Number.isFinite(stamped) && Date.now() - stamped < INBOUND_SKIP_MS) {
      return { skip: true, reason: 'outbound_echo' };
    }
  }
  if (appointment?.google_last_synced_at) {
    const last = new Date(appointment.google_last_synced_at).getTime();
    if (Date.now() - last < INBOUND_SKIP_MS) {
      return { skip: true, reason: 'recent_local_sync' };
    }
  }
  return { skip: false };
}

function eventStartDate(event) {
  const raw = event?.start?.dateTime || event?.start?.date;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventDurationMinutes(event, fallback = 60) {
  const start = eventStartDate(event);
  const endRaw = event?.end?.dateTime || event?.end?.date;
  if (!start || !endRaw) return fallback;
  const end = new Date(endRaw);
  if (Number.isNaN(end.getTime())) return fallback;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  return minutes > 0 ? minutes : fallback;
}

function parseSummary(summary) {
  const text = String(summary ?? '').trim() || 'Cliente Google';
  const parts = text.split(' - ');
  if (parts.length >= 2) {
    return {
      customer_name: parts[0].trim() || 'Cliente Google',
      service_type: parts.slice(1).join(' - ').trim() || null,
    };
  }
  return { customer_name: text, service_type: null };
}

/**
 * Pulls vehicle model/make and licence plate from a Google Calendar description.
 * Supports labelled lines, bare Spanish plates and free-form "opel corsa 4961GGJ".
 */
export function parseVehicleFromDescription(description) {
  const parsed = parseBookingNotes(description);
  return {
    vehicle_make: parsed.vehicle_make,
    vehicle_model: parsed.vehicle_model,
    vehicle_plate: parsed.vehicle_plate,
  };
}

/** Best-effort customer email from attendees or note text. */
export function extractCustomerEmailFromGoogleEvent(event, shop) {
  const skip = new Set(
    [shop?.google_calendar_connected_email, shop?.google_calendar_id, shop?.email]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase()),
  );

  const attendees = Array.isArray(event?.attendees) ? event.attendees : [];
  for (const person of attendees) {
    const email = String(person?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    if (person.self || person.resource || person.organizer) continue;
    if (skip.has(email)) continue;
    return email.slice(0, 180);
  }

  return parseBookingNotes(event?.description).email;
}

function startOfTodayIso(timezone = 'Europe/Madrid') {
  try {
    const day = zonedDateString(new Date(), timezone);
    return utcFromZoned({ ...parseDateOnly(day), hour: 0, minute: 0, second: 0 }, timezone).toISOString();
  } catch {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    return day.toISOString();
  }
}

function placeholderPhone() {
  return `+399${String(Date.now()).slice(-8)}${String(crypto.randomInt(0, 9))}`;
}

/**
 * In-app + SSE alerts for shop staff and Super Admins when Google creates a booking.
 * (No SMTP mailer in the stack — this is the platform “push” channel.)
 */
async function notifyGoogleBookingCreated(shop, appointmentId) {
  try {
    const { getAppointment, serializeAppointment } = await import('./appointments.js');
    const full = await getAppointment(shop.id, appointmentId);
    if (!full) return;

    const when = formatInZone(new Date(full.scheduled_at), shop.timezone || 'Europe/Madrid', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const vehicle = [full.vehicle_make, full.vehicle_model, full.vehicle_plate].filter(Boolean).join(' · ');
    const title = 'Nueva reserva (Google Calendar)';
    const body = `${shop.name}: ${full.customer_name} · ${when}${vehicle ? ` · ${vehicle}` : ''}${
      full.service_type ? ` · ${full.service_type}` : ''
    }`;
    const link = `/appointments/${full.id}`;

    await query(
      `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
       SELECT m.user_id, $1, 'appointment_created', $2, $3, $4
         FROM shop_members m
        WHERE m.shop_id = $1`,
      [shop.id, title, body, link],
    );

    await query(
      `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
       SELECT u.id, $1, 'appointment_created', $2, $3, $4
         FROM users u
        WHERE u.role = 'super_admin'
          AND u.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM shop_members m
             WHERE m.shop_id = $1 AND m.user_id = u.id
          )`,
      [shop.id, title, body, link],
    );

    const payload = {
      type: 'appointment_created',
      shop_id: shop.id,
      shop_name: shop.name,
      source: 'google',
      appointment: serializeAppointment(full, { timezone: shop.timezone }),
    };
    hub.publish(channels.shop(shop.id), payload);
    hub.publish(channels.admin(), payload);
    console.log('[google-calendar] notified shop + super_admin', {
      shopId: shop.id,
      appointmentId,
      reference: full.reference,
    });
  } catch (error) {
    console.error('[google-calendar] notify failed', appointmentId, error.message);
  }
}

async function publishAppointmentUpdated(shop, appointmentId) {
  try {
    const { getAppointment, serializeAppointment } = await import('./appointments.js');
    const full = await getAppointment(shop.id, appointmentId);
    if (!full) return;
    hub.publish(channels.shop(shop.id), {
      type: 'appointment_updated',
      shop_id: shop.id,
      appointment: serializeAppointment(full, { timezone: shop.timezone }),
    });
  } catch (error) {
    console.warn('[google-calendar] publish update failed', error.message);
  }
}

async function applyGoogleEvent(shop, event, { force = false } = {}) {
  if (!event?.id) return { applied: false, reason: 'no_event' };

  const appointmentId = event.extendedProperties?.private?.derte_appointment_id ?? null;
  let appointment = appointmentId
    ? await queryOne('SELECT * FROM appointments WHERE id = $1 AND shop_id = $2', [appointmentId, shop.id])
    : await queryOne('SELECT * FROM appointments WHERE shop_id = $1 AND google_event_id = $2', [
        shop.id,
        event.id,
      ]);

  if (!force) {
    const gate = shouldSkipInboundSync(appointment, event);
    if (gate.skip) return { applied: false, ...gate };
  }

  // Cancelled / deleted on Google.
  if (event.status === 'cancelled') {
    if (!appointment || ['cancelled', 'no_show', 'completed'].includes(appointment.status)) {
      return { applied: false, reason: 'nothing_to_cancel' };
    }
    await query(
      `UPDATE appointments
          SET status = 'cancelled',
              cancelled_reason = COALESCE(cancelled_reason, 'Cancelada en Google Calendar'),
              google_last_synced_at = now()
        WHERE id = $1`,
      [appointment.id],
    );
    await publishAppointmentUpdated(shop, appointment.id);
    return { applied: true, action: 'cancelled', appointmentId: appointment.id };
  }

  const start = eventStartDate(event);
  if (!start) return { applied: false, reason: 'no_start' };
  const duration = eventDurationMinutes(event, shop.slot_minutes || 60);
  const { customer_name, service_type } = parseSummary(event.summary);
  const notesFromGoogle = event.description ? plainBookingText(event.description).slice(0, 2000) : null;
  const fromNotes = parseBookingNotes(event.description);
  const vehicle = {
    vehicle_make: fromNotes.vehicle_make,
    vehicle_model: fromNotes.vehicle_model,
    vehicle_plate: fromNotes.vehicle_plate,
  };
  const email = extractCustomerEmailFromGoogleEvent(event, shop) || fromNotes.email;

  console.log('[google-calendar] parsed event fields', {
    eventId: event.id,
    customer_name,
    service_type,
    email,
    vehicle,
  });

  if (appointment) {
    await query(
      `UPDATE appointments
          SET scheduled_at = $2,
              duration_minutes = $3,
              customer_name = COALESCE(NULLIF($4, ''), customer_name),
              service_type = COALESCE($5, service_type),
              notes = CASE
                        WHEN $6::text IS NULL THEN notes
                        WHEN notes IS NULL OR notes = '' THEN $6
                        ELSE notes
                      END,
              customer_email = COALESCE(customer_email, $8),
              vehicle_make = COALESCE(NULLIF(vehicle_make, ''), $9),
              vehicle_model = COALESCE(NULLIF(vehicle_model, ''), $10),
              vehicle_plate = COALESCE(NULLIF(vehicle_plate, ''), $11),
              google_event_id = $7,
              google_last_synced_at = now(),
              status = CASE WHEN status = 'cancelled' THEN 'confirmed' ELSE status END
        WHERE id = $1`,
      [
        appointment.id,
        start.toISOString(),
        duration,
        customer_name,
        service_type,
        notesFromGoogle,
        event.id,
        email,
        vehicle.vehicle_make,
        vehicle.vehicle_model,
        vehicle.vehicle_plate,
      ],
    );
    await publishAppointmentUpdated(shop, appointment.id);
    return { applied: true, action: 'updated', appointmentId: appointment.id };
  }

  // New Google event → auto-confirmed booking in DerteAPP.
  const phone =
    normalizePhone(event.extendedProperties?.private?.derte_customer_phone) ||
    // Placeholder: Google events often lack a phone; owners can edit later.
    placeholderPhone();

  const created = await queryOne(
    `INSERT INTO appointments
       (shop_id, reference, customer_name, customer_phone, customer_email,
        vehicle_make, vehicle_model, vehicle_plate,
        service_type, notes, scheduled_at, duration_minutes, status, source,
        google_event_id, google_last_synced_at, accepted_at)
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       'confirmed', 'google', $13, now(), now()
     )
     RETURNING *`,
    [
      shop.id,
      appointmentReference(),
      customer_name,
      phone,
      email,
      vehicle.vehicle_make,
      vehicle.vehicle_model,
      vehicle.vehicle_plate,
      service_type,
      notesFromGoogle,
      start.toISOString(),
      duration,
      event.id,
    ],
  );

  // Stamp the Google event with Derte ids so future edits map back (no loop:
  // derte_sync_at + google_last_synced_at gate inbound echoes).
  try {
    const calendar = calendarClient(shop);
    if (calendar) {
      await calendar.events.patch({
        calendarId: shop.google_calendar_id,
        eventId: event.id,
        requestBody: {
          extendedProperties: {
            private: {
              derte_appointment_id: String(created.id),
              derte_shop_id: String(shop.id),
              derte_reference: String(created.reference),
              derte_sync_at: syncStamp(),
            },
          },
        },
      });
    }
  } catch (error) {
    console.warn('[google-calendar] stamp new event failed', error.message);
  }

  await notifyGoogleBookingCreated(shop, created.id);
  return { applied: true, action: 'created', appointmentId: created.id };
}

async function listChangedEvents(shop) {
  const calendar = calendarClient(shop);
  if (!calendar) return { items: [], syncToken: shop.google_calendar_sync_token };

  const params = {
    calendarId: shop.google_calendar_id,
    singleEvents: true,
    showDeleted: true,
    maxResults: 250,
  };

  if (shop.google_calendar_sync_token) {
    params.syncToken = shop.google_calendar_sync_token;
  } else {
    params.updatedMin = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    params.orderBy = 'updated';
  }

  try {
    const { data } = await calendar.events.list(params);
    return { items: data.items ?? [], syncToken: data.nextSyncToken ?? shop.google_calendar_sync_token };
  } catch (error) {
    // 410 = sync token invalidated — reset and retry with updatedMin.
    if (error?.code === 410 || error?.status === 410) {
      await query(`UPDATE shops SET google_calendar_sync_token = NULL WHERE id = $1`, [shop.id]);
      const { data } = await calendar.events.list({
        calendarId: shop.google_calendar_id,
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
        updatedMin: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
        orderBy: 'updated',
      });
      return { items: data.items ?? [], syncToken: data.nextSyncToken ?? null };
    }
    throw error;
  }
}

/**
 * Full or incremental pull of Google Calendar events into DerteAPP appointments.
 * - `initial`: every event from start-of-today (shop TZ) onward
 * - `incremental`: syncToken / updatedMin delta (used by webhooks)
 */
export async function syncShopFromGoogleCalendar(shop, { mode = 'incremental', force = false } = {}) {
  const fresh = (await queryOne('SELECT * FROM shops WHERE id = $1', [shop.id])) ?? shop;
  if (!shopCalendarConnected(fresh)) {
    console.log(`[google-calendar] sync skipped — shop ${fresh.id} not connected`);
    return { ok: false, reason: 'not_connected', fetched: 0, created: 0, updated: 0, cancelled: 0, skipped: 0 };
  }

  const calendar = calendarClient(fresh);
  if (!calendar) {
    console.error(`[google-calendar] sync aborted — no auth for shop ${fresh.id}`);
    return { ok: false, reason: 'no_auth', fetched: 0, created: 0, updated: 0, cancelled: 0, skipped: 0 };
  }

  console.log(
    `[google-calendar] ${mode} sync start shop=${fresh.id} calendar=${fresh.google_calendar_id} tz=${fresh.timezone}`,
  );

  let items = [];
  let syncToken = fresh.google_calendar_sync_token ?? null;

  try {
    if (mode === 'initial') {
      const timeMin = startOfTodayIso(fresh.timezone || 'Europe/Madrid');
      console.log(`[google-calendar] initial list timeMin=${timeMin}`);
      let pageToken;
      let page = 0;
      do {
        page += 1;
        const { data } = await calendar.events.list({
          calendarId: fresh.google_calendar_id,
          singleEvents: true,
          showDeleted: false,
          timeMin,
          maxResults: 250,
          orderBy: 'startTime',
          pageToken,
        });
        const batch = data.items ?? [];
        items = items.concat(batch);
        pageToken = data.nextPageToken || undefined;
        console.log(`[google-calendar] page ${page}: ${batch.length} events (total ${items.length})`);
        if (!pageToken && data.nextSyncToken) syncToken = data.nextSyncToken;
      } while (pageToken);
    } else {
      const listed = await listChangedEvents(fresh);
      items = listed.items;
      syncToken = listed.syncToken;
    }
  } catch (error) {
    console.error(`[google-calendar] events.list failed shop=${fresh.id}:`, error.message);
    return {
      ok: false,
      reason: 'list_failed',
      message: error.message,
      fetched: 0,
      created: 0,
      updated: 0,
      cancelled: 0,
      skipped: 0,
    };
  }

  console.log(`[google-calendar] fetched ${items.length} events from Google for shop ${fresh.id}`);

  const results = [];
  for (const event of items) {
    try {
      const result = await applyGoogleEvent(fresh, event, { force: force || mode === 'initial' });
      results.push(result);
      console.log(
        `[google-calendar] map event id=${event.id} status=${event.status} summary=${JSON.stringify(event.summary || '')} →`,
        result,
      );
    } catch (error) {
      console.error('[google-calendar] map event failed', {
        shopId: fresh.id,
        eventId: event?.id,
        summary: event?.summary,
        message: error.message,
      });
      results.push({ applied: false, reason: 'error', message: error.message });
    }
  }

  if (syncToken && syncToken !== fresh.google_calendar_sync_token) {
    await query(`UPDATE shops SET google_calendar_sync_token = $2 WHERE id = $1`, [fresh.id, syncToken]);
    console.log(`[google-calendar] stored syncToken for shop ${fresh.id}`);
  }

  const summary = {
    ok: true,
    mode,
    shop_id: fresh.id,
    fetched: items.length,
    created: results.filter((row) => row.action === 'created').length,
    updated: results.filter((row) => row.action === 'updated').length,
    cancelled: results.filter((row) => row.action === 'cancelled').length,
    skipped: results.filter((row) => !row.applied).length,
    applied: results.filter((row) => row.applied).length,
  };
  console.log('[google-calendar] sync complete', summary);
  return summary;
}

/**
 * Handles a Google Calendar push notification for one shop.
 * Pulls incremental changes and applies them to appointments.
 */
export async function processCalendarWebhookNotification({ channelId, resourceState, channelToken }) {
  console.log('[google-calendar] webhook notification', { channelId, resourceState });
  if (resourceState === 'sync') {
    return { ok: true, action: 'sync_ack' };
  }

  let shop = null;
  if (channelToken) {
    const shopId = verifyWatchChannelToken(channelToken);
    if (shopId) shop = await queryOne('SELECT * FROM shops WHERE id = $1', [shopId]);
  }
  if (!shop && channelId) {
    shop = await queryOne('SELECT * FROM shops WHERE google_calendar_watch_channel_id = $1', [channelId]);
  }
  if (!shop || !shopCalendarConnected(shop)) {
    console.warn('[google-calendar] webhook shop not found / not connected', { channelId });
    return { ok: false, reason: 'shop_not_found' };
  }

  return syncShopFromGoogleCalendar(shop, { mode: 'incremental', force: false });
}
