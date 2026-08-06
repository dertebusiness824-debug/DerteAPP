import express from 'express';
import { queryOne } from '../db/index.js';
import { asyncHandler, forbidden, notFound } from '../lib/errors.js';
import { channels, openStream } from '../lib/events.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { attachUser, requireAuth, requireShopAccess } from '../middleware/auth.js';
import { text, validate, z } from '../middleware/validate.js';
import {
  findThreadById,
  getOrCreateSupportThread,
  getShopContact,
  listMessages,
  listThreadsForShop,
  markRead,
  postMessage,
  serializeMessage,
  serializeThread,
} from '../services/chat.js';

const router = express.Router();
router.use(attachUser, requireAuth);

/** Loads the thread and verifies the caller may see this tenant's conversation. */
const loadThread = asyncHandler(async (req, _res, next) => {
  const thread = await findThreadById(req.params.threadId);
  if (!thread) return next(notFound('Conversation not found'));

  if (req.user.role !== 'super_admin') {
    const membership = await queryOne('SELECT role FROM shop_members WHERE shop_id = $1 AND user_id = $2', [
      thread.shop_id,
      req.user.id,
    ]);
    if (!membership) return next(forbidden('You do not have access to this conversation'));
    req.shopRole = membership.role;
  } else {
    req.shopRole = 'super_admin';
  }

  if (thread.kind !== 'support') {
    return next(
      forbidden('Messaging is only between the shop owner and DerteApp support. Contact customers by phone from the booking.'),
    );
  }

  req.thread = thread;
  req.shop = await queryOne('SELECT * FROM shops WHERE id = $1', [thread.shop_id]);
  // Super Admin is the counterparty on support threads; shop staff act as "shop".
  req.chatSide = req.user.role === 'super_admin' ? 'other' : 'shop';
  return next();
});

router.get(
  '/threads',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    // Chat is support-only: Super Admin ↔ shop owner. Customer messaging was removed.
    const rows = await listThreadsForShop(req.shop.id, { kind: 'support' });
    const contact = await getShopContact(req.shop.id);
    res.json({
      shop: { id: req.shop.id, name: req.shop.name },
      contact,
      threads: rows.map((row) => serializeThread(row)),
    });
  }),
);

/** Shop owner's private line to the Super Admin. Created on first open. */
router.get(
  '/support',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const thread = await getOrCreateSupportThread(req.shop.id);
    const [messages, contact] = await Promise.all([listMessages(thread.id), getShopContact(req.shop.id)]);
    await markRead(thread.id, req.user.role === 'super_admin' ? 'other' : 'shop');
    res.json({ thread: serializeThread(thread), contact, messages });
  }),
);

router.get(
  '/threads/:threadId',
  loadThread,
  asyncHandler(async (req, res) => {
    const [messages, contact] = await Promise.all([listMessages(req.thread.id), getShopContact(req.thread.shop_id)]);
    await markRead(req.thread.id, req.chatSide);

    const appointment = req.thread.appointment_id
      ? await queryOne(
          `SELECT id, reference, scheduled_at, status, service_type, vehicle_make, vehicle_model, vehicle_plate
             FROM appointments WHERE id = $1`,
          [req.thread.appointment_id],
        )
      : null;

    res.json({
      thread: serializeThread(req.thread, { includeToken: true }),
      // Header contact card: the shop owner's registered phone number, tappable.
      contact,
      appointment,
      messages,
    });
  }),
);

router.get(
  '/threads/:threadId/messages',
  loadThread,
  validate(z.object({ after_id: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const messages = await listMessages(req.thread.id, {
      afterId: req.validatedQuery.after_id ?? null,
      limit: req.validatedQuery.limit ?? 200,
    });
    res.json({ messages });
  }),
);

router.post(
  '/threads/:threadId/messages',
  loadThread,
  validate(z.object({ body: text(4000, { min: 1 }) })),
  asyncHandler(async (req, res) => {
    const isAdminSide = req.chatSide === 'other';
    const message = await postMessage({
      thread: req.thread,
      senderType: isAdminSide ? 'admin' : 'shop',
      senderUserId: req.user.id,
      senderName: isAdminSide ? `${req.user.full_name} · DerteApp` : req.user.full_name,
      // Carrying the sender's number keeps it visible (and tappable) inline.
      senderPhone: req.user.phone,
      body: req.body.body,
    });
    res.status(201).json({ message: serializeMessage(message) });
  }),
);

router.post(
  '/threads/:threadId/read',
  loadThread,
  asyncHandler(async (req, res) => {
    await markRead(req.thread.id, req.chatSide);
    res.json({ read: true });
  }),
);

/** Live message stream for one conversation. */
router.get('/threads/:threadId/stream', loadThread, (req, res) => {
  openStream(req, res, [channels.thread(req.thread.id)]);
});

/** Live stream of everything happening in a shop: chats, bookings, calls. */
router.get(
  '/stream',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  requireShopAccess,
  (req, res) => {
    openStream(req, res, [channels.shop(req.shop.id)]);
  },
);

router.get(
  '/unread',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const row = await queryOne(
      `SELECT COALESCE(sum(unread_for_shop), 0)::int AS total,
              COALESCE(sum(unread_for_shop) FILTER (WHERE kind = 'customer'), 0)::int AS customer,
              COALESCE(sum(unread_for_shop) FILTER (WHERE kind = 'support'), 0)::int  AS support
         FROM chat_threads WHERE shop_id = $1`,
      [req.shop.id],
    );
    res.json(row);
  }),
);

router.get(
  '/contact',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    res.json({
      contact: await getShopContact(req.shop.id),
      me: {
        phone: req.user.phone,
        phone_display: formatPhone(req.user.phone),
        tel_link: telLink(req.user.phone),
        whatsapp_link: whatsappLink(req.user.whatsapp_phone ?? req.user.phone),
      },
    });
  }),
);

export default router;
