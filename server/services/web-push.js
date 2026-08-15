/**
 * Web Push (VAPID) delivery for DerteApp PWA — including iOS 16.4+ home-screen apps.
 */
import webpush from 'web-push';
import config from '../config.js';
import { query, queryAll } from '../db/index.js';

let configured = false;

function ensureConfigured() {
  if (configured) return config.webPush.configured;
  if (!config.webPush.configured) return false;
  webpush.setVapidDetails(
    config.webPush.subject,
    config.webPush.publicKey,
    config.webPush.privateKey,
  );
  configured = true;
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

  return query(
    `INSERT INTO push_subscriptions (user_id, shop_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       shop_id = COALESCE(EXCLUDED.shop_id, push_subscriptions.shop_id),
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
       updated_at = now()`,
    [userId, shopId, endpoint, p256dh, auth, userAgent],
  );
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

/**
 * Sends a Web Push to every registered device for shop members.
 * Never throws to callers — webhook intake must stay resilient.
 */
export async function notifyShopPush(shopId, { title, body, url = '/urgencias', tag = 'urgencia' } = {}) {
  if (!shopId || !ensureConfigured()) {
    return { sent: 0, skipped: true, reason: config.webPush.configured ? 'no_shop' : 'not_configured' };
  }

  const rows = await listShopMemberSubscriptions(shopId);
  if (!rows.length) return { sent: 0, skipped: true, reason: 'no_subscriptions' };

  const payload = JSON.stringify({
    title: title || 'DerteApp',
    body: body || '',
    url,
    tag,
  });

  let sent = 0;
  const stale = [];

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          payload,
          { urgency: 'high', TTL: 60 * 60 },
        );
        sent += 1;
      } catch (error) {
        const status = error?.statusCode || error?.status;
        console.error('[web-push] send failed:', status || error?.message || error);
        if (status === 404 || status === 410) stale.push(row.endpoint);
      }
    }),
  );

  if (stale.length) {
    await query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])`, [stale]);
  }

  return { sent, pruned: stale.length };
}

export async function notifyNuevaUrgencia(shopId, urgencia = {}) {
  const who = urgencia.customer_name || urgencia.customer_phone_display || 'Cliente';
  const vehicle = [urgencia.vehicle?.make, urgencia.vehicle?.model].filter(Boolean).join(' ');
  const detail = [who, vehicle, urgencia.reason].filter(Boolean).join(' · ');
  return notifyShopPush(shopId, {
    title: '¡NUEVA URGENCIA RECIBIDA!',
    body: detail || 'Hay una nueva urgencia en DerteApp.',
    url: '/urgencias',
    tag: `urgencia-${urgencia.id || 'new'}`,
  });
}

export default {
  getVapidPublicKey,
  upsertPushSubscription,
  deletePushSubscription,
  notifyShopPush,
  notifyNuevaUrgencia,
};
