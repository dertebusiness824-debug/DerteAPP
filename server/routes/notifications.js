import express from 'express';
import { query, queryAll, queryOne } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import { attachUser, requireAuth } from '../middleware/auth.js';
import { booleanish, validate, z } from '../middleware/validate.js';

const router = express.Router();
router.use(attachUser, requireAuth);

/** Alerts raised for this user across every shop they belong to. */
router.get(
  '/',
  validate(
    z.object({
      unread_only: booleanish(false),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { unread_only: unreadOnly, limit } = req.validatedQuery;
    const [items, counts] = await Promise.all([
      queryAll(
        `SELECT n.id, n.type, n.title, n.body, n.link, n.read_at, n.created_at,
                n.shop_id, s.name AS shop_name
           FROM notifications n
           LEFT JOIN shops s ON s.id = n.shop_id
          WHERE n.user_id = $1
            AND ($2::bool IS NOT TRUE OR n.read_at IS NULL)
          ORDER BY n.created_at DESC
          LIMIT $3`,
        [req.user.id, unreadOnly, limit],
      ),
      queryOne(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE read_at IS NULL)::int AS unread
           FROM notifications WHERE user_id = $1`,
        [req.user.id],
      ),
    ]);
    res.json({ ...counts, notifications: items });
  }),
);

/** Marks one notification read, or the whole list when no id is given. */
router.post(
  '/read',
  validate(z.object({ id: z.string().uuid().optional() })),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid IS NULL OR id = $2::uuid)`,
      [req.user.id, req.body.id ?? null],
    );
    res.json({ marked_read: rowCount });
  }),
);

export default router;
