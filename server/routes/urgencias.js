import express from 'express';
import { asyncHandler, notFound } from '../lib/errors.js';
import { attachUser, requireAuth, requireShopAccess } from '../middleware/auth.js';
import { validate, z } from '../middleware/validate.js';
import {
  getUrgencia,
  listUrgencias,
  serializeUrgencia,
} from '../services/urgencias.js';

const router = express.Router();
router.use(attachUser, requireAuth);

const listQuerySchema = z.object({
  // Optional: when omitted, list across all shops (fixes Retell shop_id mismatch).
  shop_id: z.string().uuid().optional(),
  scope: z.enum(['active', 'history', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { scope, limit, offset, shop_id: shopId } = req.validatedQuery;
    // Direct query by time window — do not require session shop_id match.
    // If a shop_id is sent it is used as a soft filter only.
    const rows = await listUrgencias({
      shopId: shopId || null,
      scope,
      limit,
      offset,
    });
    const timezone = req.user?.timezone || 'Europe/Madrid';
    res.json({
      scope,
      shop_id: shopId || null,
      window_hours: scope === 'active' ? 24 : null,
      count: rows.length,
      urgencias: rows.map((row) => serializeUrgencia(row, { timezone })),
    });
  }),
);

router.get(
  '/:id',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const row = await getUrgencia(req.shop.id, req.params.id);
    if (!row) throw notFound('Urgencia no encontrada');
    res.json({
      urgencia: serializeUrgencia(row, { timezone: req.shop.timezone }),
    });
  }),
);

export default router;
