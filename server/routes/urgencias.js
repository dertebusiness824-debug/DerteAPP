import express from 'express';
import { asyncHandler, notFound } from '../lib/errors.js';
import { attachUser, requireAuth, requireShopAccess } from '../middleware/auth.js';
import { validate, z } from '../middleware/validate.js';
import {
  acceptUrgencia,
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

const shopQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
});

const acceptBodySchema = z
  .object({
    shop_id: z.string().uuid().optional(),
    scheduled_at: z.string().trim().min(1).optional(),
    scheduled_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduled_date must be YYYY-MM-DD')
      .optional(),
    scheduled_time: z
      .string()
      .trim()
      .regex(/^\d{1,2}:\d{2}$/, 'scheduled_time must be HH:MM')
      .optional(),
  })
  .superRefine((value, ctx) => {
    const hasPair = Boolean(value.scheduled_date) !== Boolean(value.scheduled_time);
    if (hasPair) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scheduled_date and scheduled_time must be sent together',
        path: ['scheduled_date'],
      });
    }
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
  validate(shopQuerySchema, 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const row = await getUrgencia(req.shop.id, req.params.id);
    if (!row) throw notFound('Urgencia no encontrada');
    res.json({
      urgencia: serializeUrgencia(row, { timezone: req.shop.timezone }),
    });
  }),
);

router.post(
  '/:id/accept',
  validate(acceptBodySchema),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const result = await acceptUrgencia({
      shop: req.shop,
      urgenciaId: req.params.id,
      actorUserId: req.user?.id ?? null,
      scheduledAt: req.body.scheduled_at ?? null,
      scheduledDate: req.body.scheduled_date ?? null,
      scheduledTime: req.body.scheduled_time ?? null,
    });
    res.json(result);
  }),
);

export default router;
