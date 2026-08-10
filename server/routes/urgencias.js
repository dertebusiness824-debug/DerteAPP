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
  shop_id: z.string().uuid().optional(),
  scope: z.enum(['active', 'history', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const { scope, limit, offset } = req.validatedQuery;
    const rows = await listUrgencias({
      shopId: req.shop.id,
      scope,
      limit,
      offset,
    });
    res.json({
      scope,
      count: rows.length,
      urgencias: rows.map((row) => serializeUrgencia(row, { timezone: req.shop.timezone })),
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
