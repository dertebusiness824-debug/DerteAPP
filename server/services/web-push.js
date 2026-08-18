/**
 * Web Push (VAPID) delivery for DerteApp PWA — including iOS 16.4+ home-screen apps.
 */
import webpush from 'web-push';
import config from '../config.js';
import { query, queryAll, queryOne } from '../db/index.js';
import { formatInZone } from '../lib/time.js';

let configured = false;

function ensureConfigured() {
  if (configured) return config.webPush.configured;
  if (!config.webPush.configured) {
    console.warn('[web-push] not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
    return false;
  }
  webpush.setVapidDetails(
    config.webPush.subject,
    config.webPush.publicKey,
    config.webPush.privateKey,
  );
  configured = true;
  console.log('[web-push] VAPID ready', {
    subject: config.webPush.subject,
    publicKeyPrefix: `${config.webPush.publicKey.slice(0, 12)}…`,
  });
  return true;
}

export function getVapidPublicKey() {
  return config.webPush.configured ? config.webPush.publicKey : null;
}

export async function upsertPushSubscription({
  userId,
  shopId = null,
  subscription,
  userAgent = null,
}) {
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    throw new Error('invalid_push_subscription');
  }

  const result = await query(
    `INSERT INTO push_subscriptions (user_id, shop_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       shop_id = COALESCE(EXCLUDED.shop_id, push_subscriptions.shop_id),
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
       updated_at = now()
     RETURNING id, user_id, shop_id, endpoint`,
    [userId, shopId, endpoint, p256dh, auth, userAgent],
  );

  const row = result.rows?.[0];
  console.log('[web-push] subscription upserted', {
    id: row?.id,
    userId,
    shopId,
    endpoint: `${endpoint.slice(0, 64)}…`,
  });
  return row;
}

export async function deletePushSubscription({ userId, endpoint }) {
  return query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [
    userId,
    endpoint,
  ]);
}

async function listShopMemberSubscriptions(shopId) {
  return queryAll(
    `SELECT DISTINCT ON (ps.endpoint)
            ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.user_id, ps.shop_id
       FROM push_subscriptions ps
       INNER JOIN shop_members m ON m.user_id = ps.user_id
      WHERE m.shop_id = $1
         OR ps.shop_id = $1
      ORDER BY ps.endpoint, ps.updated_at DESC`,
    [shopId],
  );
}

function endpointHint(endpoint) {
  return String(endpoint || '').slice(0, 72);
}

/**
 * Sends a Web Push to every registered device for shop members.
 * Never throws to callers — webhook intake must stay resilient.
 */
export async function notifyShopPush(shopId, { title, body, url = '/urgencias', tag = 'urgencia' } = {}) {
  if (!shopId) {
    console.warn('[web-push] skip send — missing shopId');
    return { sent: 0, skipped: true, reason: 'no_shop' };
  }
  if (!ensureConfigured()) {
    console.warn('[web-push] skip send — VAPID not configured');
    return { sent: 0, skipped: true, reason: 'not_configured' };
  }

  const rows = await listShopMemberSubscriptions(shopId);
  if (!rows.length) {
    console.warn('[web-push] skip send — no subscriptions for shop', { shopId, title });
    return { sent: 0, skipped: true, reason: 'no_subscriptions' };
  }

  const payload = JSON.stringify({
    title: title || 'DerteApp',
    body: body || '',
    url,
    tag,
  });

  console.log('[web-push] sending', {
    shopId,
    title,
    tag,
    recipients: rows.length,
  });

  let sent = 0;
  const stale = [];
  const failures = [];

  await Promise.all(
    rows.map(async (row) => {
      try {
        const response = await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          payload,
          { urgency: 'high', TTL: 60 * 60 },
        );
        const status = response?.statusCode || 201;
        sent += 1;
        console.log('[web-push] send ok', {
          status,
          endpoint: endpointHint(row.endpoint),
          userId: row.user_id,
        });
      } catch (error) {
        const status = error?.statusCode || error?.status || null;
        const detail = {
          status,
          endpoint: endpointHint(row.endpoint),
          userId: row.user_id,
          message: error?.message || String(error),
          body: typeof error?.body === 'string' ? error.body.slice(0, 240) : undefined,
        };
        console.error('[web-push] send failed', detail);
        failures.push(detail);

        if (status === 404 || status === 410) {
          console.warn('[web-push] pruning stale subscription (410/404 Gone)', {
            endpoint: endpointHint(row.endpoint),
          });
          stale.push(row.endpoint);
        } else if (status === 401 || status === 403) {
          console.error(
            '[web-push] unauthorized (401/403) — check VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT match the keys used at subscribe time',
          );
        }
      }
    }),
  );

  if (stale.length) {
    await query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])`, [stale]);
    console.log('[web-push] pruned stale subscriptions', { count: stale.length });
  }

  console.log('[web-push] send summary', {
    shopId,
    title,
    sent,
    failed: failures.length,
    pruned: stale.length,
  });

  return { sent, pruned: stale.length, failed: failures.length };
}

export async function notifyNuevaUrgencia(shopId, urgencia = {}) {
  const who = urgencia.customer_name || urgencia.customer_phone_display || 'Cliente';
  const vehicle = [urgencia.vehicle?.make, urgencia.vehicle?.model].filter(Boolean).join(' ');
  const detail = [who, vehicle, urgencia.reason].filter(Boolean).join(' · ');
  return notifyShopPush(shopId, {
    title: '¡NUEVA URGENCIA RECIBIDA!',
    body: detail || 'Hay una nueva urgencia en DerteApp.',
    url: urgencia.id ? `/urgencias/${urgencia.id}` : '/urgencias',
    tag: `urgencia-${urgencia.id || 'new'}`,
  });
}

/** Web Push for new confirmed bookings (manual, web form, Retell, etc.). */
export async function notifyNuevaReserva(shopId, appointment = {}, { timezone = 'Europe/Madrid' } = {}) {
  const when = appointment.scheduled_at
    ? formatInZone(new Date(appointment.scheduled_at), appointment.timezone || timezone, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const detail = [appointment.customer_name, when, appointment.service_type].filter(Boolean).join(' · ');
  return notifyShopPush(shopId, {
    title: 'Nueva reserva confirmada',
    body: detail || 'Hay una nueva reserva en DerteApp.',
    url: appointment.id ? `/appointments/${appointment.id}` : '/appointments',
    tag: `reserva-${appointment.id || 'new'}`,
  });
}

export default {
  getVapidPublicKey,
  upsertPushSubscription,
  deletePushSubscription,
  notifyShopPush,
  notifyNuevaUrgencia,
  notifyNuevaReserva,
};
