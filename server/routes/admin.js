import express from 'express';
import config from '../config.js';
import { query, queryAll, queryOne } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound, serviceUnavailable, tooManyRequests } from '../lib/errors.js';
import { channels, openStream } from '../lib/events.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { normalizeHttpUrl } from '../lib/urls.js';
import { attachUser, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  booleanish,
  optionalPhoneSchema,
  optionalText,
  phoneSchema,
  text,
  validate,
  z,
} from '../middleware/validate.js';
import {
  createAccountByAdmin,
  deleteAccountByAdmin,
  listAdminUsers,
  serializeAdminUser,
} from '../services/admin-users.js';
import { globalOverview } from '../services/analytics.js';
import { recordAudit } from '../services/appointments.js';
import { CATEGORY_KEYS, presetSummary } from '../lib/inventory-catalog.js';
import {
  clearPreloadedItems,
  inventorySummary,
  preloadInventory,
} from '../services/inventory.js';
import { getOrCreateSupportThread, listSupportInbox, postMessage, serializeThread } from '../services/chat.js';
import {
  createSalesRep,
  getSalesRep,
  listCommissions,
  listSalesReps,
  loadSalesRepOptions,
  markCommissionPaid,
  updateSalesRep,
} from '../services/sales-reps.js';
import {
  clearShopCoverImage,
  coverUrlFromSettings,
  purgeShopsExcept,
  setShopCoverImage,
} from '../services/shop-covers.js';
import {
  createShopPromotion,
  deleteShopPromotion,
  listShopPromotions,
  setShopMarketplaceListing,
  updateShopPromotion,
} from '../services/shop-promotions.js';
import { callStats } from '../services/telephony.js';
import {
  REASONS as MATRICULAS_REASONS,
  isConfigured as matriculasConfigured,
  listLookups,
  lookupPlate,
  lookupStatus,
  recordLookup,
  saveApiKey,
} from '../services/matriculas.js';
import { decodeImagePayload, toDataUrl } from '../services/uploads.js';
import { identifyByPhoto, saveVehicle, serializeVehicle } from '../services/vehicles.js';
import {
  countPendingLeads,
  getPlatformLead,
  listPlatformLeads,
  setLeadStatus,
} from '../services/leads.js';
import { publicStatus as platformTelephonyStatus, savePlatformTelephony } from '../services/platform-telephony.js';

const router = express.Router();
router.use(attachUser, requireAuth, requireSuperAdmin);

const STATUS_FOR_REASON = {
  invalid_plate: 400,
  not_configured: 503,
  quota_exceeded: 429,
  timeout: 503,
  upstream_error: 503,
};

/**
 * Official plate register (Matriculas.org). Super Admin only — the router
 * already ran requireSuperAdmin; the extra role check is belt and braces so a
 * future refactor cannot accidentally expose the quota.
 */
function assertSuperAdmin(req) {
  if (req.user?.role !== 'super_admin') {
    throw forbidden('Solo el Super Admin puede consultar el registro oficial de matrículas', {
      code: 'matriculas_forbidden',
    });
  }
}

router.get(
  '/vehicles/matriculas',
  asyncHandler(async (req, res) => {
    assertSuperAdmin(req);
    const [status, history] = await Promise.all([lookupStatus(), listLookups({ limit: 25 })]);
    res.json({ ...status, history });
  }),
);

router.patch(
  '/vehicles/matriculas',
  validate(
    z.object({
      api_key: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    assertSuperAdmin(req);
    const result = await saveApiKey(req.body.api_key, { userId: req.user.id });
    if (!result.unchanged) {
      await recordAudit({
        actorUserId: req.user.id,
        action: 'admin.matriculas.key_saved',
        metadata: { configured: true },
        ip: req.clientIp,
      });
    }
    const status = await lookupStatus();
    res.json({ ...status, unchanged: result.unchanged });
  }),
);

// --- Global Zadarma + Retell (CLIENTES lead receptionist) --------------------

router.get(
  '/settings/leads-telephony',
  asyncHandler(async (_req, res) => {
    res.json(await platformTelephonyStatus());
  }),
);

router.patch(
  '/settings/leads-telephony',
  validate(
    z.object({
      zadarma_key: z.string().max(500).optional(),
      zadarma_secret: z.string().max(500).optional(),
      zadarma_sip: z.string().max(80).optional(),
      zadarma_did: z.string().max(32).optional(),
      retell_api_key: z.string().max(500).optional(),
      retell_webhook_secret: z.string().max(500).optional(),
      retell_agent_id: z.string().max(120).optional(),
      retell_did: z.string().max(32).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await savePlatformTelephony(req.body, { userId: req.user.id });
    if (!result.unchanged) {
      await recordAudit({
        actorUserId: req.user.id,
        action: 'admin.leads_telephony.saved',
        metadata: {
          assistant_status: result.assistant_status,
          zadarma_configured: result.zadarma?.configured,
          retell_configured: result.retell?.configured,
        },
        ip: req.clientIp,
      });
    }
    res.json(result);
  }),
);

router.post(
  '/vehicles/plate',
  rateLimit({
    name: 'admin-matriculas',
    limit: 40,
    windowMs: 60 * 60_000,
    keyFn: (req) => req.user?.id ?? req.clientIp,
    message: 'Demasiadas consultas al registro de matrículas. Espera un momento.',
  }),
  validate(
    z.object({
      plate: optionalText(16),
      shop_id: z.string().uuid().optional(),
      save: booleanish(false),
      data_url: z.string().max(9_000_000).optional(),
      image_base64: z.string().max(9_000_000).optional(),
      content_type: optionalText(80),
    }),
  ),
  asyncHandler(async (req, res) => {
    assertSuperAdmin(req);

    let plate = req.body.plate ?? null;
    let photo = null;

    if (req.body.data_url || req.body.image_base64) {
      const image = decodeImagePayload(req.body);
      photo = await identifyByPhoto({ dataUrl: toDataUrl(image) });
      if (!plate && photo?.plate?.plate) plate = photo.plate.plate;
    }

    if (!plate) {
      throw badRequest(
        photo ? 'No se ha leído una matrícula en la foto. Introdúcela a mano.' : 'Introduce una matrícula',
        { code: 'invalid_plate' },
      );
    }

    const result = await lookupPlate(plate);
    const attemptedUpstream = result.reason !== 'not_configured' && result.reason !== 'invalid_plate';
    if (attemptedUpstream) {
      await recordLookup({
        userId: req.user.id,
        shopId: req.body.shop_id ?? null,
        plate: result.plate?.plate ?? plate,
        found: Boolean(result.found),
        reason: result.reason,
        make: result.vehicle?.make ?? null,
        model: result.vehicle?.model ?? null,
      });
      await recordAudit({
        actorUserId: req.user.id,
        shopId: req.body.shop_id ?? null,
        action: 'admin.matriculas.lookup',
        metadata: {
          plate: result.plate?.plate ?? plate,
          found: Boolean(result.found),
          reason: result.reason,
        },
        ip: req.clientIp,
      });
    }

    if (!result.ok) {
      const status = STATUS_FOR_REASON[result.reason] ?? 503;
      if (result.reason === 'quota_exceeded') {
        throw tooManyRequests(MATRICULAS_REASONS[result.reason], { code: result.reason });
      }
      if (status === 400) {
        throw badRequest(MATRICULAS_REASONS[result.reason] ?? result.reason, { code: result.reason });
      }
      throw serviceUnavailable(MATRICULAS_REASONS[result.reason] ?? MATRICULAS_REASONS.upstream_error, {
        code: result.reason,
      });
    }

    let saved = null;
    if (req.body.save && req.body.shop_id && result.vehicle) {
      const shop = await queryOne('SELECT id, name FROM shops WHERE id = $1', [req.body.shop_id]);
      if (!shop) throw notFound('Taller no encontrado');
      const row = await saveVehicle({
        shopId: shop.id,
        userId: req.user.id,
        input: {
          plate: result.vehicle.plate,
          make: result.vehicle.make,
          model: result.vehicle.model,
          version: result.vehicle.version,
          year: result.vehicle.year,
          fuel: result.vehicle.fuel,
          engine: result.vehicle.engine,
          power_hp: result.vehicle.power_hp,
          body: result.vehicle.body,
          specs: result.vehicle.specs,
          identified_by: 'plate',
          confidence: result.vehicle.confidence,
        },
      });
      saved = serializeVehicle(row);
    }

    res.json({
      configured: matriculasConfigured(),
      found: result.found,
      reason: result.reason,
      message: result.found ? null : MATRICULAS_REASONS[result.reason] ?? MATRICULAS_REASONS.not_found,
      plate: result.plate,
      source: result.found ? 'matriculas' : photo?.recognized ? 'photo' : null,
      vehicle: result.vehicle,
      official: result.official ?? null,
      photo: photo
        ? { recognized: photo.recognized, reason: photo.reason, vehicle: photo.vehicle, plate: photo.plate }
        : null,
      saved,
    });
  }),
);

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
    // El JOIN a marketplace_shop_listings es opcional: si el SQL del marketplace
    // no está instalado, caemos al flag de shops.settings.
    const marketplaceRow = await queryOne(
      `SELECT to_regclass('public.marketplace_shop_listings') AS reg`,
    );
    const marketplaceInstalled = Boolean(marketplaceRow?.reg);

    const shops = await queryAll(
      marketplaceInstalled
        ? `SELECT DISTINCT ON (s.name, s.id)
                  s.id, s.name, s.slug, s.status, s.timezone, s.site_url, s.phone, s.public_key,
                  s.zadarma_did, s.zadarma_sip, s.created_at, s.sales_rep_id, s.first_payment_at,
                  s.settings,
                  r.name AS sales_rep_name, r.referral_code AS sales_rep_code,
                  u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
                  (SELECT count(*)::int FROM appointments a WHERE a.shop_id = s.id) AS total_bookings,
                  (SELECT count(*)::int FROM appointments a WHERE a.shop_id = s.id AND a.status IN ('confirmed', 'accepted', 'pending')) AS pending_bookings,
                  (SELECT count(*)::int FROM shop_promotions p WHERE p.shop_id = s.id AND p.is_active) AS active_promotions,
                  COALESCE(l.is_listed, COALESCE((s.settings -> 'marketplace' ->> 'is_listed')::boolean, false)) AS marketplace_listed,
                  COALESCE(
                    NULLIF(l.cover_image_url, ''),
                    NULLIF(s.settings -> 'marketplace' ->> 'cover_image_url', '')
                  ) AS cover_image_url
             FROM shops s
             LEFT JOIN sales_reps r ON r.id = s.sales_rep_id
             LEFT JOIN shop_members m ON m.shop_id = s.id AND m.role = 'owner' AND m.is_primary
             LEFT JOIN users u ON u.id = m.user_id
             LEFT JOIN marketplace_shop_listings l ON l.shop_id = s.id
            WHERE ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR s.slug ILIKE '%' || $1 || '%'
                   OR u.phone ILIKE '%' || $1 || '%' OR s.site_url ILIKE '%' || $1 || '%')
              AND ($2::text IS NULL OR s.status = $2)
            ORDER BY s.name, s.id
            LIMIT $3`
        : `SELECT DISTINCT ON (s.name, s.id)
                  s.id, s.name, s.slug, s.status, s.timezone, s.site_url, s.phone, s.public_key,
                  s.zadarma_did, s.zadarma_sip, s.created_at, s.sales_rep_id, s.first_payment_at,
                  s.settings,
                  r.name AS sales_rep_name, r.referral_code AS sales_rep_code,
                  u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
                  (SELECT count(*)::int FROM appointments a WHERE a.shop_id = s.id) AS total_bookings,
                  (SELECT count(*)::int FROM appointments a WHERE a.shop_id = s.id AND a.status IN ('confirmed', 'accepted', 'pending')) AS pending_bookings,
                  (SELECT count(*)::int FROM shop_promotions p WHERE p.shop_id = s.id AND p.is_active) AS active_promotions,
                  COALESCE((s.settings -> 'marketplace' ->> 'is_listed')::boolean, false) AS marketplace_listed,
                  NULLIF(s.settings -> 'marketplace' ->> 'cover_image_url', '') AS cover_image_url
             FROM shops s
             LEFT JOIN sales_reps r ON r.id = s.sales_rep_id
             LEFT JOIN shop_members m ON m.shop_id = s.id AND m.role = 'owner' AND m.is_primary
             LEFT JOIN users u ON u.id = m.user_id
            WHERE ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR s.slug ILIKE '%' || $1 || '%'
                   OR u.phone ILIKE '%' || $1 || '%' OR s.site_url ILIKE '%' || $1 || '%')
              AND ($2::text IS NULL OR s.status = $2)
            ORDER BY s.name, s.id
            LIMIT $3`,
      [search ?? null, status ?? null, limit],
    );
    res.json({
      count: shops.length,
      marketplace_ready: marketplaceInstalled,
      active_shop_id: null,
      shops: shops.map((shop) => ({
        ...shop,
        settings: undefined,
        marketplace_listed: Boolean(shop.marketplace_listed),
        cover_image_url: shop.cover_image_url || coverUrlFromSettings(shop.settings) || null,
        active_promotions: Number(shop.active_promotions ?? 0),
        first_payment_paid: Boolean(shop.first_payment_at),
        owner_phone_display: shop.owner_phone ? formatPhone(shop.owner_phone) : null,
        owner_tel_link: telLink(shop.owner_phone),
        owner_whatsapp_link: whatsappLink(shop.owner_phone),
      })),
    });
  }),
);

/** Sube / reemplaza la foto de portada del taller (Supabase Storage o disco local). */
router.post(
  '/shops/:shopId/cover',
  validate(
    z.object({
      data_url: optionalText(7_000_000),
      image_base64: optionalText(7_000_000),
      content_type: optionalText(64),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (!req.body.data_url && !req.body.image_base64) {
      throw badRequest('Envía data_url o image_base64 con la foto de portada');
    }
    const result = await setShopCoverImage(req.params.shopId, req.body);
    await recordAudit({
      actorUserId: req.user.id,
      shopId: result.shop.id,
      action: 'shop.cover.upload',
      metadata: { storage: result.storage, cover_image_url: result.shop.cover_image_url },
      ip: req.clientIp,
    });
    res.json(result);
  }),
);

router.delete(
  '/shops/:shopId/cover',
  asyncHandler(async (req, res) => {
    const result = await clearShopCoverImage(req.params.shopId);
    await recordAudit({
      actorUserId: req.user.id,
      shopId: result.shop.id,
      action: 'shop.cover.clear',
      metadata: {},
      ip: req.clientIp,
    });
    res.json(result);
  }),
);

/**
 * Carga inicial del inventario de un taller.
 *
 * Crea el catálogo de recambios y consumibles habituales con cantidad 0, para
 * que el dueño solo tenga que contar lo que hay en la estantería. Es
 * idempotente: lo que ya existe no se toca, así que repetirla nunca duplica.
 */
router.get(
  '/shops/:shopId/inventory',
  asyncHandler(async (req, res) => {
    const shop = await queryOne('SELECT id, name FROM shops WHERE id = $1', [req.params.shopId]);
    if (!shop) throw notFound('Taller no encontrado');
    res.json({
      shop: { id: shop.id, name: shop.name },
      summary: await inventorySummary(shop.id),
      preset: presetSummary(),
    });
  }),
);

router.post(
  '/shops/:shopId/inventory/preload',
  validate(z.object({ categories: z.array(z.enum(CATEGORY_KEYS)).max(20).optional() })),
  asyncHandler(async (req, res) => {
    const shop = await queryOne('SELECT id, name FROM shops WHERE id = $1', [req.params.shopId]);
    if (!shop) throw notFound('Taller no encontrado');

    const result = await preloadInventory({
      shopId: shop.id,
      categories: req.body.categories ?? null,
      userId: req.user.id,
    });
    await recordAudit({
      actorUserId: req.user.id,
      shopId: shop.id,
      action: 'shop.inventory.preload',
      metadata: result,
      ip: req.clientIp,
    });
    res.json({ ...result, summary: await inventorySummary(shop.id) });
  }),
);

/** Deshace la carga inicial: borra solo lo precargado que sigue a cero. */
router.delete(
  '/shops/:shopId/inventory/preload',
  asyncHandler(async (req, res) => {
    const result = await clearPreloadedItems({ shopId: req.params.shopId });
    await recordAudit({
      actorUserId: req.user.id,
      shopId: req.params.shopId,
      action: 'shop.inventory.preload_clear',
      metadata: result,
      ip: req.clientIp,
    });
    res.json({ ...result, summary: await inventorySummary(req.params.shopId) });
  }),
);

/**
 * Borra TODOS los talleres excepto el indicado (el taller «activo» del panel).
 * Requiere confirm: "ELIMINAR". Irreversible (CASCADE).
 */
router.post(
  '/shops/purge-except',
  validate(
    z.object({
      keep_shop_id: z.string().uuid(),
      confirm: text(20, { min: 8 }),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await purgeShopsExcept(req.body.keep_shop_id, { confirm: req.body.confirm });
    await recordAudit({
      actorUserId: req.user.id,
      shopId: result.kept.id,
      action: 'shop.purge_except',
      metadata: {
        kept_shop_id: result.kept.id,
        deleted_count: result.deleted_count,
        deleted_ids: result.deleted.map((shop) => shop.id),
      },
      ip: req.clientIp,
    });
    res.json(result);
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

/** Publica / retira el taller en la PWA de clientes (marketplace B2C). */
router.patch(
  '/shops/:shopId/marketplace',
  validate(z.object({ is_listed: z.boolean() })),
  asyncHandler(async (req, res) => {
    const result = await setShopMarketplaceListing(req.params.shopId, {
      isListed: req.body.is_listed,
    });
    await recordAudit({
      actorUserId: req.user.id,
      shopId: result.shop.id,
      action: 'shop.marketplace',
      metadata: { is_listed: req.body.is_listed },
      ip: req.clientIp,
    });
    res.json(result);
  }),
);

router.get(
  '/shops/:shopId/promotions',
  asyncHandler(async (req, res) => {
    const shop = await queryOne('SELECT id, name FROM shops WHERE id = $1', [req.params.shopId]);
    if (!shop) throw notFound('Shop not found');
    const promotions = await listShopPromotions(shop.id, { includeInactive: true });
    res.json({ shop, count: promotions.length, promotions });
  }),
);

router.post(
  '/shops/:shopId/promotions',
  validate(
    z.object({
      title: text(120, { min: 2 }),
      description: optionalText(800),
      badge_label: optionalText(40),
      discount_percent: z.coerce.number().min(0).max(100).nullable().optional(),
      price_from: z.coerce.number().min(0).nullable().optional(),
      price_to: z.coerce.number().min(0).nullable().optional(),
      currency: optionalText(8),
      service_name: optionalText(120),
      starts_at: z.union([z.string().trim().min(1), z.null()]).optional(),
      ends_at: z.union([z.string().trim().min(1), z.null()]).optional(),
      is_active: z.boolean().optional(),
      sort_order: z.coerce.number().int().min(0).max(9999).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const promotion = await createShopPromotion(req.params.shopId, req.body);
    await recordAudit({
      actorUserId: req.user.id,
      shopId: req.params.shopId,
      action: 'shop.promotion.create',
      metadata: { promotion_id: promotion.id, title: promotion.title },
      ip: req.clientIp,
    });
    res.status(201).json({ promotion });
  }),
);

router.patch(
  '/promotions/:promotionId',
  validate(
    z.object({
      title: text(120, { min: 2 }).optional(),
      description: optionalText(800),
      badge_label: optionalText(40),
      discount_percent: z.coerce.number().min(0).max(100).nullable().optional(),
      price_from: z.coerce.number().min(0).nullable().optional(),
      price_to: z.coerce.number().min(0).nullable().optional(),
      currency: optionalText(8),
      service_name: optionalText(120),
      starts_at: z.union([z.string().trim().min(1), z.null()]).optional(),
      ends_at: z.union([z.string().trim().min(1), z.null()]).optional(),
      is_active: z.boolean().optional(),
      sort_order: z.coerce.number().int().min(0).max(9999).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const promotion = await updateShopPromotion(req.params.promotionId, req.body);
    await recordAudit({
      actorUserId: req.user.id,
      shopId: promotion.shop_id,
      action: 'shop.promotion.update',
      metadata: { promotion_id: promotion.id },
      ip: req.clientIp,
    });
    res.json({ promotion });
  }),
);

router.delete(
  '/promotions/:promotionId',
  asyncHandler(async (req, res) => {
    // Necesitamos el shop_id para la auditoría antes de borrar.
    const existing = await queryOne('SELECT id, shop_id, title FROM shop_promotions WHERE id = $1', [
      req.params.promotionId,
    ]);
    if (!existing) throw notFound('Oferta no encontrada');
    await deleteShopPromotion(req.params.promotionId);
    await recordAudit({
      actorUserId: req.user.id,
      shopId: existing.shop_id,
      action: 'shop.promotion.delete',
      metadata: { promotion_id: existing.id, title: existing.title },
      ip: req.clientIp,
    });
    res.json({ ok: true });
  }),
);

// --- CLIENTES: platform sales leads (Retell receptionist) --------------------

router.get(
  '/clientes',
  validate(
    z.object({
      scope: z.enum(['active', 'history']).default('active'),
      limit: z.coerce.number().int().min(1).max(200).default(80),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const leads = await listPlatformLeads({
      scope: req.validatedQuery.scope,
      limit: req.validatedQuery.limit,
    });
    res.json({ count: leads.length, leads, pending: await countPendingLeads() });
  }),
);

router.get(
  '/clientes/status',
  asyncHandler(async (_req, res) => {
    res.json({ pending: await countPendingLeads() });
  }),
);

router.get('/clientes/stream', (req, res) => {
  openStream(req, res, [channels.admin()]);
});

router.patch(
  '/clientes/:id',
  validate(z.object({ status: z.enum(['pending', 'contacted', 'closed']) })),
  asyncHandler(async (req, res) => {
    const lead = await getPlatformLead(req.params.id);
    if (!lead) throw notFound('Lead no encontrado');
    const updated = await setLeadStatus(req.params.id, req.body.status);
    await recordAudit({
      actorUserId: req.user.id,
      shopId: null,
      action: `admin.clientes.${req.body.status}`,
      metadata: { lead_id: updated.id, shop_name: updated.shop_name, island: updated.island },
      ip: req.clientIp,
    });
    res.json({ lead: updated });
  }),
);

// --- Central support inbox ---------------------------------------------------

router.get(
  '/inbox',
  validate(z.object({ unread_only: booleanish(false), limit: z.coerce.number().int().min(1).max(200).default(100) }), 'query'),
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

// --- Users (Super Admin only — enforced by router.use above) -----------------

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
    const users = await listAdminUsers(req.validatedQuery);
    res.json({
      count: users.length,
      users: users.map((user) => serializeAdminUser(user)),
    });
  }),
);

/** Create a shop-owner account (email + password hashed) and its workshop. */
router.post(
  '/users',
  validate(
    z
      .object({
        email: z.string().trim().email('Introduce un correo válido').max(180),
        password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
        full_name: text(120, { min: 2 }),
        // Either create a new shop by name, or attach to an existing shop_id.
        shop_name: optionalText(160),
        // Empty string / null from the UI must not be treated as a UUID.
        shop_id: z.preprocess(
          (value) => (value === '' || value === null || value === undefined ? undefined : value),
          z.string().uuid('El código de referencia del taller no existe.').optional(),
        ),
        create_shop: booleanish(true),
        phone: phoneSchema,
        timezone: optionalText(64),
        address: optionalText(300),
        city: optionalText(120),
        site_url: optionalText(500),
        website_url: optionalText(500),
        whatsapp_phone: optionalPhoneSchema,
        sales_rep_id: z.string().uuid().nullish(),
      })
      .superRefine((body, ctx) => {
        if (body.shop_id) return;
        if (body.create_shop === false) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Selecciona un taller existente o marca «Crear nuevo taller».',
            path: ['shop_id'],
          });
          return;
        }
        if (!body.shop_name || String(body.shop_name).trim().length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'El nombre del taller es obligatorio',
            path: ['shop_name'],
          });
        }
      }),
  ),
  asyncHandler(async (req, res) => {
    try {
      const websiteUrl = normalizeHttpUrl(req.body.website_url, { field: 'website_url' });
      const siteUrl = normalizeHttpUrl(req.body.site_url, { field: 'site_url' });
      const created = await createAccountByAdmin({
        ...req.body,
        shop_id: req.body.shop_id || null,
        create_shop: req.body.create_shop !== false && !req.body.shop_id,
        website_url: websiteUrl === undefined ? null : websiteUrl,
        site_url: siteUrl === undefined ? websiteUrl ?? null : siteUrl,
        actorUserId: req.user.id,
        ip: req.clientIp,
      });
      return res.status(201).json(created);
    } catch (error) {
      // HttpError / Zod already handled upstream; enrich unexpected DB failures.
      if (error?.status) throw error;
      console.error('[admin/users] create failed:', error?.code || '', error?.message, error?.detail || '');
      if (error?.code === '23503') {
        throw badRequest('El código de referencia del taller no existe.', {
          code: 'shop_reference_not_found',
          details: { constraint: error.constraint ?? null, detail: error.detail ?? null },
        });
      }
      throw badRequest(error?.message || 'No se pudo crear la cuenta', {
        code: error?.code ? `db_${error.code}` : 'create_user_failed',
        details: config.isProduction
          ? undefined
          : { pg: error?.code ?? null, detail: error?.detail ?? null },
      });
    }
  }),
);

router.patch(
  '/users/:userId',
  validate(z.object({ status: z.enum(['active', 'suspended']).optional(), full_name: text(120, { min: 2 }).optional() })),
  asyncHandler(async (req, res) => {
    if (req.params.userId === req.user.id && req.body.status === 'suspended') {
      throw badRequest('No puedes suspender tu propia cuenta de Super Admin');
    }
    const updates = [];
    const values = [req.params.userId];
    for (const field of ['status', 'full_name']) {
      if (req.body[field] === undefined) continue;
      values.push(req.body[field]);
      updates.push(`${field} = $${values.length}`);
    }
    if (updates.length === 0) throw badRequest('Nada que actualizar');

    const user = await queryOne(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $1 RETURNING id, phone, full_name, role, status, email`,
      values,
    );
    if (!user) throw notFound('Usuario no encontrado');
    if (req.body.status === 'suspended') {
      await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
    }
    await recordAudit({ actorUserId: req.user.id, action: 'user.update', entityId: user.id, metadata: req.body });
    res.json({ user: serializeAdminUser(user) });
  }),
);

/** Permanently delete a shop-owner account (and empty shops). */
router.delete(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    const deleted = await deleteAccountByAdmin({
      userId: req.params.userId,
      actorUserId: req.user.id,
      ip: req.clientIp,
    });
    res.json({ deleted: true, user: deleted });
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

// --- Sales reps / affiliates -------------------------------------------------

router.get(
  '/sales-reps',
  validate(z.object({ status: z.enum(['active', 'suspended', 'archived']).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const reps = await listSalesReps({ status: req.validatedQuery.status ?? null });
    res.json({ count: reps.length, sales_reps: reps });
  }),
);

router.get('/sales-reps/options', asyncHandler(async (_req, res) => {
  const options = await loadSalesRepOptions();
  res.json({ options });
}));

router.post(
  '/sales-reps',
  validate(
    z.object({
      name: text(160, { min: 2 }),
      phone: optionalPhoneSchema,
      email: z.string().trim().email().max(180).nullish(),
      notes: optionalText(1000),
    }),
  ),
  asyncHandler(async (req, res) => {
    const sales_rep = await createSalesRep(req.body);
    await recordAudit({
      actorUserId: req.user.id,
      action: 'sales_rep.create',
      entityId: sales_rep.id,
      metadata: { referral_code: sales_rep.referral_code },
      ip: req.clientIp,
    });
    res.status(201).json({ sales_rep });
  }),
);

router.get(
  '/sales-reps/:repId',
  asyncHandler(async (req, res) => {
    const sales_rep = await getSalesRep(req.params.repId);
    if (!sales_rep) throw notFound('Comercial no encontrado');
    res.json({ sales_rep });
  }),
);

router.patch(
  '/sales-reps/:repId',
  validate(
    z.object({
      name: text(160, { min: 2 }).optional(),
      phone: optionalPhoneSchema.optional(),
      email: z.string().trim().email().max(180).nullish(),
      status: z.enum(['active', 'suspended', 'archived']).optional(),
      notes: optionalText(1000),
    }),
  ),
  asyncHandler(async (req, res) => {
    const sales_rep = await updateSalesRep(req.params.repId, req.body);
    await recordAudit({
      actorUserId: req.user.id,
      action: 'sales_rep.update',
      entityId: sales_rep.id,
      metadata: req.body,
      ip: req.clientIp,
    });
    res.json({ sales_rep });
  }),
);

router.get(
  '/commissions',
  validate(
    z.object({
      status: z.enum(['pending', 'paid', 'cancelled', 'all']).default('pending'),
      sales_rep_id: z.string().uuid().optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const status = req.validatedQuery.status === 'all' ? null : req.validatedQuery.status;
    const commissions = await listCommissions({
      status,
      salesRepId: req.validatedQuery.sales_rep_id ?? null,
    });
    const pendingTotal = commissions
      .filter((row) => row.status === 'pending')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    res.json({ count: commissions.length, pending_total: pendingTotal, commissions });
  }),
);

router.post(
  '/commissions/:commissionId/pay',
  asyncHandler(async (req, res) => {
    const commission = await markCommissionPaid(req.params.commissionId, {
      actorUserId: req.user.id,
    });
    await recordAudit({
      actorUserId: req.user.id,
      shopId: commission.shop_id,
      action: 'sales_rep.commission_paid',
      entityId: commission.id,
      metadata: { amount: commission.amount, sales_rep_id: commission.sales_rep_id },
      ip: req.clientIp,
    });
    res.json({ commission });
  }),
);

export default router;
