import express from 'express';
import { query, queryAll, queryOne } from '../db/index.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { channels, openStream } from '../lib/events.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { attachUser, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { optionalText, text, validate, z } from '../middleware/validate.js';
import { globalOverview } from '../services/analytics.js';
import { recordAudit } from '../services/appointments.js';
import { getOrCreateSupportThread, listSupportInbox, postMessage, serializeThread } from '../services/chat.js';
import { callStats } from '../services/telephony.js';

const router = express.Router();
router.use(attachUser, requireAuth, requireSuperAdmin);

/** Master dashboard: one payload with global metrics and the per-shop table. */
router.get(
  '/overview',
  validate(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), 'query'),
  asyncHandler(async (req, res) => {
    const days = req.validatedQuery.days;
    const [overview, calls] = await Promise.all([globalOverview({ days }), callStats({ shopId: null, days })]);
    res.json({ ...overview, calls });
  }),
);

router.get(
  '/shops',
  validate(
    z.object({
      search: z.string().trim().max(120).optional(),
      status: z.enum(['active', 'suspended', 'archived']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { search, status, limit } = req.validatedQuery;
    const shops = await queryAll(
      `SELECT s.id, s.name, s.slug, s.status, s.timezone, s.site_url, s.phone, s.public_key,
              s.zadarma_did, s.zadarma_sip, s.created_at,
              u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
              (SELECT count(*)::int FROM appointments a WHERE a.shop_id = s.id) AS total_bookings,
              (SELECT count(*)::int FROM appointments a WHERE a.shop_id = s.id AND a.status = 'pending') AS pending_bookings
         FROM shops s
         LEFT JOIN shop_members m ON m.shop_id = s.id AND m.role = 'owner' AND m.is_primary
         LEFT JOIN users u ON u.id = m.user_id
        WHERE ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR s.slug ILIKE '%' || $1 || '%'
               OR u.phone ILIKE '%' || $1 || '%' OR s.site_url ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR s.status = $2)
        ORDER BY s.name
        LIMIT $3`,
      [search ?? null, status ?? null, limit],
    );
    res.json({
      count: shops.length,
      shops: shops.map((shop) => ({
        ...shop,
        owner_phone_display: shop.owner_phone ? formatPhone(shop.owner_phone) : null,
        owner_tel_link: telLink(shop.owner_phone),
        owner_whatsapp_link: whatsappLink(shop.owner_phone),
      })),
    });
  }),
);

router.patch(
  '/shops/:shopId/status',
  validate(z.object({ status: z.enum(['active', 'suspended', 'archived']), reason: optionalText(300) })),
  asyncHandler(async (req, res) => {
    const shop = await queryOne('UPDATE shops SET status = $2 WHERE id = $1 RETURNING id, name, status', [
      req.params.shopId,
      req.body.status,
    ]);
    if (!shop) throw notFound('Shop not found');
    await recordAudit({
      actorUserId: req.user.id,
      shopId: shop.id,
      action: 'shop.status',
      metadata: { status: req.body.status, reason: req.body.reason ?? null },
      ip: req.clientIp,
    });
    res.json({ shop });
  }),
);

// --- Central support inbox ---------------------------------------------------

router.get(
  '/inbox',
  validate(z.object({ unread_only: z.coerce.boolean().default(false), limit: z.coerce.number().int().min(1).max(200).default(100) }), 'query'),
  asyncHandler(async (req, res) => {
    const threads = await listSupportInbox({
      limit: req.validatedQuery.limit,
      onlyUnread: req.validatedQuery.unread_only,
    });
    res.json({ count: threads.length, threads });
  }),
);

/** Live feed of support messages arriving from any shop. */
router.get('/inbox/stream', (req, res) => {
  openStream(req, res, [channels.admin()]);
});

/** Opens (or creates) the support conversation for one shop. */
router.get(
  '/inbox/:shopId',
  asyncHandler(async (req, res) => {
    const shop = await queryOne('SELECT * FROM shops WHERE id = $1', [req.params.shopId]);
    if (!shop) throw notFound('Shop not found');
    const thread = await getOrCreateSupportThread(shop.id);
    res.json({
      thread: serializeThread(thread),
      redirect: `/api/chat/threads/${thread.id}`,
    });
  }),
);

/** Announcement pushed into every (or selected) shop's support thread. */
router.post(
  '/broadcast',
  validate(
    z.object({
      body: text(2000, { min: 2 }),
      shop_ids: z.array(z.string().uuid()).max(200).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const shops = req.body.shop_ids?.length
      ? await queryAll(`SELECT id FROM shops WHERE id = ANY($1::uuid[]) AND status <> 'archived'`, [req.body.shop_ids])
      : await queryAll(`SELECT id FROM shops WHERE status = 'active'`);
    if (shops.length === 0) throw badRequest('No matching shops to message');

    let delivered = 0;
    for (const shop of shops) {
      const thread = await getOrCreateSupportThread(shop.id);
      await postMessage({
        thread,
        senderType: 'admin',
        senderUserId: req.user.id,
        senderName: `${req.user.full_name} · DerteApp`,
        senderPhone: req.user.phone,
        body: req.body.body,
      });
      delivered += 1;
    }

    await recordAudit({ actorUserId: req.user.id, action: 'admin.broadcast', metadata: { shops: delivered } });
    res.status(201).json({ delivered });
  }),
);

// --- Users -------------------------------------------------------------------

router.get(
  '/users',
  validate(
    z.object({
      search: z.string().trim().max(120).optional(),
      role: z.enum(['shop_owner', 'super_admin']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { search, role, limit } = req.validatedQuery;
    const users = await queryAll(
      `SELECT u.id, u.phone, u.full_name, u.email, u.role, u.status, u.last_login_at, u.created_at,
              COALESCE(json_agg(json_build_object('id', s.id, 'name', s.name, 'role', m.role)
                       ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS shops
         FROM users u
         LEFT JOIN shop_members m ON m.user_id = u.id
         LEFT JOIN shops s ON s.id = m.shop_id
        WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.phone ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR u.role = $2)
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT $3`,
      [search ?? null, role ?? null, limit],
    );
    res.json({
      count: users.length,
      users: users.map((user) => ({ ...user, phone_display: formatPhone(user.phone), tel_link: telLink(user.phone) })),
    });
  }),
);

router.patch(
  '/users/:userId',
  validate(z.object({ status: z.enum(['active', 'suspended']).optional(), full_name: text(120, { min: 2 }).optional() })),
  asyncHandler(async (req, res) => {
    if (req.params.userId === req.user.id && req.body.status === 'suspended') {
      throw badRequest('You cannot suspend your own Super Admin account');
    }
    const updates = [];
    const values = [req.params.userId];
    for (const field of ['status', 'full_name']) {
      if (req.body[field] === undefined) continue;
      values.push(req.body[field]);
      updates.push(`${field} = $${values.length}`);
    }
    if (updates.length === 0) throw badRequest('Nothing to update');

    const user = await queryOne(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $1 RETURNING id, phone, full_name, role, status`,
      values,
    );
    if (!user) throw notFound('User not found');
    if (req.body.status === 'suspended') {
      await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
    }
    await recordAudit({ actorUserId: req.user.id, action: 'user.update', entityId: user.id, metadata: req.body });
    res.json({ user: { ...user, phone_display: formatPhone(user.phone) } });
  }),
);

router.get(
  '/audit',
  validate(z.object({ shop_id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), 'query'),
  asyncHandler(async (req, res) => {
    const entries = await queryAll(
      `SELECT l.id, l.action, l.entity_type, l.entity_id, l.metadata, l.created_at,
              u.full_name AS actor_name, u.phone AS actor_phone, s.name AS shop_name
         FROM audit_log l
         LEFT JOIN users u ON u.id = l.actor_user_id
         LEFT JOIN shops s ON s.id = l.shop_id
        WHERE ($1::uuid IS NULL OR l.shop_id = $1)
        ORDER BY l.created_at DESC
        LIMIT $2`,
      [req.validatedQuery.shop_id ?? null, req.validatedQuery.limit],
    );
    res.json({ entries });
  }),
);

export default router;
