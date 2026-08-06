import config from '../config.js';
import { query, queryAll, queryOne } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { channels, hub } from '../lib/events.js';
import { randomToken } from '../lib/ids.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';

const CUSTOMER_THREAD_TTL_DAYS = 120;

/** Public URL a customer taps to open their chat - no account needed. */
export const customerChatLink = (accessToken) => `${config.appUrl}/c/${accessToken}`;

/**
 * The contact card shown at the top of every chat: the shop owner's registered
 * phone number, always tappable. Falls back to the shop's own number when a
 * shop has no primary owner yet.
 */
export async function getShopContact(shopId) {
  const row = await queryOne(
    `SELECT s.id   AS shop_id,
            s.name AS shop_name,
            s.phone AS shop_phone,
            s.whatsapp_phone AS shop_whatsapp,
            s.timezone,
            s.address,
            u.id   AS owner_id,
            u.full_name AS owner_name,
            u.phone AS owner_phone,
            u.whatsapp_phone AS owner_whatsapp
       FROM shops s
       LEFT JOIN shop_members m ON m.shop_id = s.id AND m.role = 'owner'
       LEFT JOIN users u ON u.id = m.user_id
      WHERE s.id = $1
      ORDER BY m.is_primary DESC NULLS LAST
      LIMIT 1`,
    [shopId],
  );
  if (!row) throw notFound('Shop not found');

  const phone = row.owner_phone ?? row.shop_phone ?? null;
  const whatsapp = row.owner_whatsapp ?? row.shop_whatsapp ?? phone;
  return {
    shop_id: row.shop_id,
    shop_name: row.shop_name,
    timezone: row.timezone,
    address: row.address ?? null,
    owner_id: row.owner_id ?? null,
    owner_name: row.owner_name ?? row.shop_name,
    // Explicitly exposed so the chat UI can render a tap-to-call header.
    phone,
    phone_display: phone ? formatPhone(phone) : null,
    tel_link: telLink(phone),
    whatsapp_link: whatsappLink(whatsapp),
  };
}

export async function getOrCreateSupportThread(shopId) {
  const existing = await queryOne(`SELECT * FROM chat_threads WHERE shop_id = $1 AND kind = 'support'`, [shopId]);
  if (existing) return existing;
  const shop = await queryOne('SELECT name FROM shops WHERE id = $1', [shopId]);
  if (!shop) throw notFound('Shop not found');
  return queryOne(
    `INSERT INTO chat_threads (shop_id, kind, subject) VALUES ($1, 'support', $2) RETURNING *`,
    [shopId, `${shop.name} — DerteApp support`],
  );
}

/**
 * Opens the customer chat for an accepted appointment and returns the thread
 * with its secure link. Idempotent: re-accepting reuses the same thread.
 * Accepts an optional pg client so it can join the acceptance transaction.
 */
export async function createCustomerThread({ appointment, client = null }) {
  const run = client ? (text, params) => client.query(text, params).then(({ rows }) => rows[0] ?? null) : queryOne;

  const existing = await run('SELECT * FROM chat_threads WHERE appointment_id = $1', [appointment.id]);
  if (existing) return existing;

  return run(
    `INSERT INTO chat_threads
       (shop_id, kind, appointment_id, customer_name, customer_phone, subject, access_token, token_expires_at)
     VALUES ($1, 'customer', $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval)
     RETURNING *`,
    [
      appointment.shop_id,
      appointment.id,
      appointment.customer_name,
      appointment.customer_phone,
      `${appointment.customer_name} — ${appointment.reference}`,
      randomToken(24),
      String(CUSTOMER_THREAD_TTL_DAYS),
    ],
  );
}

export function findThreadByToken(accessToken) {
  if (!accessToken || String(accessToken).length < 16) return Promise.resolve(null);
  return queryOne(
    `SELECT * FROM chat_threads
      WHERE access_token = $1 AND (token_expires_at IS NULL OR token_expires_at > now())`,
    [accessToken],
  );
}

export const findThreadById = (id) => queryOne('SELECT * FROM chat_threads WHERE id = $1', [id]);

const MAX_BODY = 4000;

/**
 * Appends a message, keeps the thread summary/unread counters in sync and
 * publishes it to any live SSE listeners.
 */
export async function postMessage({
  thread,
  senderType,
  senderUserId = null,
  senderName,
  senderPhone = null,
  body,
  metadata = {},
}) {
  const content = String(body ?? '').trim();
  if (!content) throw badRequest('Message cannot be empty');
  if (content.length > MAX_BODY) throw badRequest(`Message is too long (max ${MAX_BODY} characters)`);
  if (thread.status === 'closed') throw badRequest('This conversation has been closed');

  const message = await queryOne(
    `INSERT INTO chat_messages (thread_id, sender_type, sender_user_id, sender_name, sender_phone, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [thread.id, senderType, senderUserId, senderName, senderPhone, content, metadata],
  );

  // The shop side is one participant; customer/admin/system count as "other".
  const fromShop = senderType === 'shop';
  await query(
    `UPDATE chat_threads
        SET last_message_at = $2,
            last_message_preview = $3,
            unread_for_shop  = CASE WHEN $4 THEN unread_for_shop  ELSE unread_for_shop + 1 END,
            unread_for_other = CASE WHEN $4 THEN unread_for_other + 1 ELSE unread_for_other END
      WHERE id = $1`,
    [thread.id, message.created_at, content.slice(0, 160), fromShop],
  );

  const payload = { type: 'chat_message', thread_id: thread.id, shop_id: thread.shop_id, message: serializeMessage(message) };
  hub.publish(channels.thread(thread.id), payload);
  hub.publish(channels.shop(thread.shop_id), payload);
  if (thread.kind === 'support') hub.publish(channels.admin(), payload);

  return message;
}

export const systemMessage = (thread, body, metadata = {}) =>
  postMessage({ thread, senderType: 'system', senderName: 'DerteApp', body, metadata });

export function serializeMessage(message) {
  return {
    id: String(message.id),
    thread_id: message.thread_id,
    sender_type: message.sender_type,
    sender_user_id: message.sender_user_id ?? null,
    sender_name: message.sender_name,
    sender_phone: message.sender_phone ?? null,
    sender_phone_display: message.sender_phone ? formatPhone(message.sender_phone) : null,
    body: message.body,
    metadata: message.metadata ?? {},
    created_at: message.created_at,
  };
}

export function listMessages(threadId, { afterId = null, limit = 200 } = {}) {
  return queryAll(
    `SELECT * FROM chat_messages
      WHERE thread_id = $1 AND ($2::bigint IS NULL OR id > $2::bigint)
      ORDER BY id ASC LIMIT $3`,
    [threadId, afterId, Math.min(Math.max(Number(limit) || 200, 1), 500)],
  ).then((rows) => rows.map(serializeMessage));
}

export async function markRead(threadId, side) {
  const column = side === 'shop' ? 'unread_for_shop' : 'unread_for_other';
  await query(`UPDATE chat_threads SET ${column} = 0 WHERE id = $1`, [threadId]);
  await query(
    `UPDATE chat_messages SET read_at = now()
      WHERE thread_id = $1 AND read_at IS NULL AND sender_type ${side === 'shop' ? '<>' : '='} 'shop'`,
    [threadId],
  );
}

export function serializeThread(thread, { includeToken = false, extra = {} } = {}) {
  return {
    id: thread.id,
    shop_id: thread.shop_id,
    shop_name: thread.shop_name ?? null,
    kind: thread.kind,
    appointment_id: thread.appointment_id ?? null,
    appointment_reference: thread.appointment_reference ?? null,
    subject: thread.subject ?? null,
    customer_name: thread.customer_name ?? null,
    customer_phone: thread.customer_phone ?? null,
    customer_phone_display: thread.customer_phone ? formatPhone(thread.customer_phone) : null,
    customer_tel_link: telLink(thread.customer_phone),
    customer_whatsapp_link: whatsappLink(thread.customer_phone),
    status: thread.status,
    last_message_at: thread.last_message_at ?? null,
    last_message_preview: thread.last_message_preview ?? null,
    unread_for_shop: thread.unread_for_shop ?? 0,
    unread_for_other: thread.unread_for_other ?? 0,
    created_at: thread.created_at,
    ...(includeToken && thread.access_token
      ? { access_token: thread.access_token, chat_link: customerChatLink(thread.access_token) }
      : {}),
    ...extra,
  };
}

export function listThreadsForShop(shopId, { kind = null, status = null, limit = 100 } = {}) {
  return queryAll(
    `SELECT t.*, s.name AS shop_name, a.reference AS appointment_reference, a.scheduled_at
       FROM chat_threads t
       JOIN shops s ON s.id = t.shop_id
       LEFT JOIN appointments a ON a.id = t.appointment_id
      WHERE t.shop_id = $1
        AND ($2::text IS NULL OR t.kind = $2)
        AND ($3::text IS NULL OR t.status = $3)
      ORDER BY t.last_message_at DESC NULLS LAST, t.created_at DESC
      LIMIT $4`,
    [shopId, kind, status, Math.min(Math.max(Number(limit) || 100, 1), 200)],
  );
}

/** Super Admin support inbox across every tenant. */
export function listSupportInbox({ limit = 100, onlyUnread = false } = {}) {
  return queryAll(
    `SELECT t.*, s.name AS shop_name, s.status AS shop_status,
            u.full_name AS owner_name, u.phone AS owner_phone
       FROM chat_threads t
       JOIN shops s ON s.id = t.shop_id
       LEFT JOIN shop_members m ON m.shop_id = s.id AND m.role = 'owner' AND m.is_primary
       LEFT JOIN users u ON u.id = m.user_id
      WHERE t.kind = 'support'
        AND ($2::bool IS NOT TRUE OR t.unread_for_other > 0)
      ORDER BY t.last_message_at DESC NULLS LAST, s.name
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 200), onlyUnread],
  ).then((rows) =>
    rows.map((row) =>
      serializeThread(row, {
        extra: {
          shop_status: row.shop_status,
          owner_name: row.owner_name,
          owner_phone: row.owner_phone,
          owner_phone_display: row.owner_phone ? formatPhone(row.owner_phone) : null,
          owner_tel_link: telLink(row.owner_phone),
          owner_whatsapp_link: whatsappLink(row.owner_phone),
        },
      }),
    ),
  );
}
