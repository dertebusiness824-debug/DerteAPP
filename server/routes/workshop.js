/**
 * Workshop tools: vehicle identification, the diagnostic assistant and the
 * spare-parts inventory.
 *
 * Every route is scoped to one shop by `requireShopAccess`, so a Super Admin
 * works inside a shop exactly as its owner does.
 */
import express from 'express';
import { queryAll } from '../db/index.js';
import { asyncHandler, forbidden, notFound } from '../lib/errors.js';
import { INVENTORY_CATEGORIES, CATEGORY_KEYS } from '../lib/inventory-catalog.js';
import { attachUser, requireAuth, requireShopAccess } from '../middleware/auth.js';
import { booleanish, optionalText, text, validate, z } from '../middleware/validate.js';
import { diagnose, saveDiagnosticQuery } from '../services/diagnostics.js';
import * as inventory from '../services/inventory.js';
import { pendingReminders, runShopReminders } from '../services/inventory-notifications.js';
import { decodeImagePayload, storeImage, toDataUrl } from '../services/uploads.js';
import * as vehicles from '../services/vehicles.js';

const router = express.Router();
router.use(attachUser, requireAuth);

const imagePayload = z
  .object({
    data_url: z.string().max(9_000_000).optional(),
    image_base64: z.string().max(9_000_000).optional(),
    content_type: optionalText(80),
    shop_id: z.string().uuid().optional(),
  })
  .passthrough();

// --- vehicles ---------------------------------------------------------------

router.get(
  '/vehicles',
  requireShopAccess,
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      search: optionalText(120),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { search, limit, offset } = req.validatedQuery;
    const rows = await vehicles.listVehicles({ shopId: req.shop.id, search, limit, offset });
    res.json({
      vehicles: rows.map(vehicles.serializeVehicle),
      count: rows.length,
    });
  }),
);

/** Plate → vehicle from the shop file, then APIVehículo. */
router.post(
  '/vehicles/identify/plate',
  requireShopAccess,
  validate(z.object({ shop_id: z.string().uuid().optional(), plate: text(16, { min: 4 }) })),
  asyncHandler(async (req, res) => {
    const result = await vehicles.identifyByPlate({
      shopId: req.shop.id,
      plate: req.body.plate,
      userId: req.user?.id ?? null,
    });
    res.json(result);
  }),
);

/** Photo → candidate vehicle, using the vision model when one is configured. */
router.post(
  '/vehicles/identify/photo',
  requireShopAccess,
  validate(imagePayload),
  asyncHandler(async (req, res) => {
    const image = decodeImagePayload(req.body);
    const result = await vehicles.identifyByPhoto({ dataUrl: toDataUrl(image) });
    res.json(result);
  }),
);

/** Makes, models and versions for the manual path. */
router.get(
  '/vehicles/catalog',
  requireShopAccess,
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      q: optionalText(120),
      make: optionalText(60),
      model: optionalText(60),
      year: z.coerce.number().int().min(1900).max(2100).optional(),
      limit: z.coerce.number().int().min(1).max(40).default(8),
    }),
    'query',
  ),
  // The catalog is in memory, so this one handler has nothing to await.
  asyncHandler((req, res) => {
    const { q, make, model, year, limit } = req.validatedQuery;
    res.json(vehicles.searchVehicleCatalog({ text: q ?? '', make, model, year, limit }));
  }),
);

const vehicleInput = z.object({
  shop_id: z.string().uuid().optional(),
  plate: optionalText(16),
  make: optionalText(60),
  model: optionalText(60),
  version: optionalText(120),
  catalog_key: optionalText(120),
  year: z.coerce.number().int().min(1900).max(2100).nullish(),
  fuel: optionalText(40),
  engine: optionalText(80),
  power_hp: z.coerce.number().int().min(1).max(2000).nullish(),
  body: optionalText(40),
  photo_url: optionalText(600),
  identified_by: z.enum(['plate', 'photo', 'manual', 'catalog', 'history']).optional(),
  confidence: z.coerce.number().min(0).max(1).nullish(),
  customer_name: optionalText(120),
  customer_phone: optionalText(32),
  notes: optionalText(600),
});

router.post(
  '/vehicles',
  requireShopAccess,
  validate(vehicleInput),
  asyncHandler(async (req, res) => {
    const row = await vehicles.saveVehicle({
      shopId: req.shop.id,
      input: req.body,
      userId: req.user.id,
    });
    res.status(201).json({ vehicle: vehicles.serializeVehicle(row) });
  }),
);

router.get(
  '/vehicles/:vehicleId',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const row = await vehicles.getVehicle(req.shop.id, req.params.vehicleId);
    if (!row) throw notFound('Vehículo no encontrado');
    res.json({ vehicle: vehicles.serializeVehicle(row) });
  }),
);

router.patch(
  '/vehicles/:vehicleId',
  requireShopAccess,
  validate(vehicleInput.partial()),
  asyncHandler(async (req, res) => {
    const row = await vehicles.updateVehicle({
      shopId: req.shop.id,
      vehicleId: req.params.vehicleId,
      patch: req.body,
    });
    res.json({ vehicle: vehicles.serializeVehicle(row) });
  }),
);

/** Replaces the illustration with a real photo of this car. */
router.post(
  '/vehicles/:vehicleId/photo',
  requireShopAccess,
  validate(imagePayload),
  asyncHandler(async (req, res) => {
    const image = decodeImagePayload(req.body);
    const { url } = await storeImage({
      folder: 'shop-vehicles',
      shopId: req.shop.id,
      name: req.params.vehicleId,
      image,
    });
    const row = await vehicles.updateVehicle({
      shopId: req.shop.id,
      vehicleId: req.params.vehicleId,
      patch: { photo_url: url },
    });
    res.json({ vehicle: vehicles.serializeVehicle(row) });
  }),
);

router.delete(
  '/vehicles/:vehicleId',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    res.json(await vehicles.deleteVehicle({ shopId: req.shop.id, vehicleId: req.params.vehicleId }));
  }),
);

// --- diagnostic assistant ---------------------------------------------------

/** "¿Cuál es el motivo de la consulta?" → ranked probable causes. */
router.post(
  '/diagnostics',
  requireShopAccess,
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      prompt: text(1200, { min: 4 }),
      vehicle_id: z.string().uuid().nullish(),
      make: optionalText(60),
      model: optionalText(60),
      version: optionalText(120),
      year: z.coerce.number().int().min(1900).max(2100).nullish(),
      fuel: optionalText(40),
      engine: optionalText(80),
      mileage_km: z.coerce.number().int().min(0).max(2_000_000).nullish(),
      save: booleanish(true),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body;
    let vehicle = {
      make: body.make ?? null,
      model: body.model ?? null,
      version: body.version ?? null,
      year: body.year ?? null,
      fuel: body.fuel ?? null,
      engine: body.engine ?? null,
      mileage_km: body.mileage_km ?? null,
    };

    // A saved vehicle fills in what the counter did not type.
    if (body.vehicle_id) {
      const row = await vehicles.getVehicle(req.shop.id, body.vehicle_id);
      if (row) {
        const saved = vehicles.serializeVehicle(row);
        vehicle = {
          make: vehicle.make ?? saved.make,
          model: vehicle.model ?? saved.model,
          version: vehicle.version ?? saved.version,
          year: vehicle.year ?? saved.year,
          fuel: vehicle.fuel ?? saved.fuel,
          engine: vehicle.engine ?? saved.engine,
          mileage_km: vehicle.mileage_km,
        };
      }
    }

    const result = await diagnose({ prompt: body.prompt, vehicle });
    const label = [vehicle.make, vehicle.model, vehicle.version, vehicle.year]
      .filter(Boolean)
      .join(' ') || null;

    let saved = null;
    if (body.save) {
      saved = await saveDiagnosticQuery({
        shopId: req.shop.id,
        vehicleId: body.vehicle_id ?? null,
        prompt: body.prompt,
        vehicleLabel: label,
        mileageKm: vehicle.mileage_km,
        result,
        userId: req.user.id,
      });
    }

    res.json({
      ...result,
      id: saved?.id ?? null,
      created_at: saved?.created_at ?? null,
      prompt: body.prompt,
      vehicle_label: label,
    });
  }),
);

/** Recent consultations, so the counter can reread yesterday's answer. */
router.get(
  '/diagnostics',
  requireShopAccess,
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(15),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const queries = await queryAll(
      `SELECT d.id, d.prompt, d.vehicle_label, d.mileage_km, d.provider, d.model, d.causes,
              d.created_at, u.full_name AS actor_name
         FROM diagnostic_queries d
         LEFT JOIN users u ON u.id = d.created_by
        WHERE d.shop_id = $1
        ORDER BY d.created_at DESC
        LIMIT $2`,
      [req.shop.id, req.validatedQuery.limit],
    );
    res.json({ queries });
  }),
);

// --- inventory --------------------------------------------------------------

router.get(
  '/inventory',
  requireShopAccess,
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      search: optionalText(120),
      category: z.enum(CATEGORY_KEYS).optional(),
      low_stock: booleanish(false),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { search, category, low_stock: lowStock } = req.validatedQuery;
    const [rows, summary, state, reminders, movements] = await Promise.all([
      inventory.listItems({ shopId: req.shop.id, search, category, lowStockOnly: lowStock }),
      inventory.inventorySummary(req.shop.id),
      inventory.ensureState(req.shop.id),
      pendingReminders({ shopId: req.shop.id, timeZone: req.shop.timezone }),
      inventory.listMovements({ shopId: req.shop.id, limit: 20 }),
    ]);

    res.json({
      items: rows.map(inventory.serializeItem),
      categories: INVENTORY_CATEGORIES,
      summary,
      reminders: { ...reminders, enabled: state.reminders_enabled },
      movements,
      vision_available: inventory.visionAvailable(),
    });
  }),
);

/**
 * The owner's kill switch for the whole reminder system.
 * Declared before `/inventory/:itemId`, or Express would read "reminders" as an id.
 */
router.patch(
  '/inventory/reminders',
  requireShopAccess,
  validate(z.object({ shop_id: z.string().uuid().optional(), enabled: booleanish(true) })),
  asyncHandler(async (req, res) => {
    const state = await inventory.setRemindersEnabled(req.shop.id, req.body.enabled);
    res.json({
      reminders: {
        enabled: state.reminders_enabled,
        last_change_at: state.last_change_at,
      },
    });
  }),
);

/**
 * Runs the reminder check for this shop on demand.
 * Super Admin only: it is the manual counterpart of the scheduled sweep.
 */
router.post(
  '/inventory/reminders/run',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'super_admin') throw forbidden('Solo el Super Admin puede lanzar el aviso');
    res.json(await runShopReminders({ shopId: req.shop.id, timeZone: req.shop.timezone }));
  }),
);

/** Recent adds and removals. Also before `/inventory/:itemId`, same reason. */
router.get(
  '/inventory/movements',
  requireShopAccess,
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    res.json({
      movements: await inventory.listMovements({
        shopId: req.shop.id,
        limit: req.validatedQuery.limit,
      }),
    });
  }),
);

/** Photo → suggested item fields. The owner confirms before anything is saved. */
router.post(
  '/inventory/recognize',
  requireShopAccess,
  validate(imagePayload),
  asyncHandler(async (req, res) => {
    const image = decodeImagePayload(req.body);
    res.json(await inventory.recognizeItemPhoto({ dataUrl: toDataUrl(image) }));
  }),
);

const itemInput = z.object({
  shop_id: z.string().uuid().optional(),
  name: text(120, { min: 2 }),
  category: z.enum(CATEGORY_KEYS).default('other'),
  brand: optionalText(80),
  spec: optionalText(120),
  quantity: z.coerce.number().min(0).max(1_000_000).default(0),
  unit: optionalText(12),
  min_quantity: z.coerce.number().min(0).max(1_000_000).default(0),
  price: z.coerce.number().min(0).max(1_000_000).nullish(),
  photo_url: optionalText(600),
  notes: optionalText(400),
  source: z.enum(['manual', 'photo']).default('manual'),
});

router.post(
  '/inventory',
  requireShopAccess,
  validate(itemInput),
  asyncHandler(async (req, res) => {
    const row = await inventory.createItem({
      shopId: req.shop.id,
      input: { ...req.body, unit: req.body.unit || 'ud' },
      userId: req.user.id,
      source: req.body.source,
    });
    res.status(201).json({ item: inventory.serializeItem(row) });
  }),
);

router.patch(
  '/inventory/:itemId',
  requireShopAccess,
  validate(itemInput.partial()),
  asyncHandler(async (req, res) => {
    const row = await inventory.updateItem({
      shopId: req.shop.id,
      itemId: req.params.itemId,
      patch: req.body,
      userId: req.user.id,
      source: req.body.source ?? 'manual',
    });
    res.json({ item: inventory.serializeItem(row) });
  }),
);

/** Relative change, which is what the +/− buttons send. */
router.post(
  '/inventory/:itemId/adjust',
  requireShopAccess,
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      delta: z.coerce.number().min(-1_000_000).max(1_000_000),
      source: z.enum(['manual', 'photo']).default('manual'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const row = await inventory.adjustQuantity({
      shopId: req.shop.id,
      itemId: req.params.itemId,
      delta: req.body.delta,
      userId: req.user.id,
      source: req.body.source,
    });
    res.json({ item: inventory.serializeItem(row) });
  }),
);

router.delete(
  '/inventory/:itemId',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    res.json(
      await inventory.deleteItem({
        shopId: req.shop.id,
        itemId: req.params.itemId,
        userId: req.user.id,
      }),
    );
  }),
);

/** Stores a photo for an item and returns its URL. */
router.post(
  '/inventory/:itemId/photo',
  requireShopAccess,
  validate(imagePayload),
  asyncHandler(async (req, res) => {
    const image = decodeImagePayload(req.body);
    const { url } = await storeImage({
      folder: 'shop-inventory',
      shopId: req.shop.id,
      name: req.params.itemId,
      image,
    });
    const row = await inventory.updateItem({
      shopId: req.shop.id,
      itemId: req.params.itemId,
      patch: { photo_url: url },
      userId: req.user.id,
      source: 'photo',
    });
    res.json({ item: inventory.serializeItem(row) });
  }),
);

export default router;
