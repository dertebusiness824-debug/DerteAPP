/**
 * Vehicle identification and the shop's own vehicle file.
 *
 * A plate resolves in this order:
 *   1. vehicles this shop already registered
 *   2. past bookings with the same plate
 *   3. an external lookup provider, when PLATE_LOOKUP_URL is configured
 *   4. the local catalog, once the counter adds make/model
 *
 * Nothing is invented: when none of the above knows the car, the response says
 * so and the UI asks for make/model instead of showing a guess.
 */
import config from '../config.js';
import { query, queryAll, queryOne } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { formatPlate, normalizePlate, parsePlate } from '../lib/plates.js';
import {
  CATALOG_MAKES,
  catalogEntryByKey,
  modelsForMake,
  photoForBody,
  searchCatalog,
} from '../lib/vehicle-catalog.js';
import { aiConfigured, aiJson } from './ai.js';

export function serializeVehicle(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    plate: row.plate ?? null,
    plate_display: formatPlate(row.plate),
    make: row.make ?? null,
    model: row.model ?? null,
    version: row.version ?? null,
    year: row.year ?? null,
    fuel: row.fuel ?? null,
    engine: row.engine ?? null,
    power_hp: row.power_hp ?? null,
    body: row.body ?? null,
    label: [row.make, row.model, row.version].filter(Boolean).join(' ') || null,
    specs: row.specs ?? {},
    photo_url: row.photo_url ?? (row.body ? photoForBody(row.body) : null),
    has_own_photo: Boolean(row.photo_url),
    identified_by: row.identified_by,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    customer_name: row.customer_name ?? null,
    customer_phone: row.customer_phone ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Catalog figures are factory reference values, not the car's paperwork.
    specs_are_reference: true,
  };
}

export const listVehicles = ({ shopId, search = null, limit = 50, offset = 0 }) =>
  queryAll(
    `SELECT * FROM shop_vehicles
      WHERE shop_id = $1
        AND ($2::text IS NULL
             OR make ILIKE '%' || $2 || '%'
             OR model ILIKE '%' || $2 || '%'
             OR version ILIKE '%' || $2 || '%'
             OR customer_name ILIKE '%' || $2 || '%'
             -- Plates are stored without separators, so "1234 BCD" must match too.
             OR plate ILIKE '%' || $3 || '%')
      ORDER BY updated_at DESC
      LIMIT $4 OFFSET $5`,
    [shopId, search || null, normalizePlate(search) ?? '\u0000', limit, offset],
  );

export const getVehicle = (shopId, id) =>
  queryOne(`SELECT * FROM shop_vehicles WHERE id = $1 AND shop_id = $2`, [id, shopId]);

const catalogSpecs = (entry) => ({
  ...entry.specs,
  catalog_key: entry.key,
  catalog_version: entry.version,
  year_from: entry.year_from,
  year_to: entry.year_to,
});

/** Best catalog hit for a make/model/year, used to fill in technical specs. */
export function specsFromCatalog({ make, model, version = null, year = null }) {
  const [best] = searchCatalog({ text: [make, model, version].filter(Boolean).join(' '), make, model, year, limit: 1 });
  return best ?? null;
}

async function plateFromHistory(shopId, plate) {
  const known = await queryOne(`SELECT * FROM shop_vehicles WHERE shop_id = $1 AND plate = $2`, [shopId, plate]);
  if (known) {
    return { source: 'registry', vehicle: serializeVehicle(known), confidence: 1 };
  }

  const booking = await queryOne(
    `SELECT vehicle_make, vehicle_model, vehicle_year, customer_name, customer_phone, scheduled_at
       FROM appointments
      WHERE shop_id = $1 AND upper(replace(coalesce(vehicle_plate, ''), ' ', '')) = $2
        AND (vehicle_make IS NOT NULL OR vehicle_model IS NOT NULL)
      ORDER BY scheduled_at DESC
      LIMIT 1`,
    [shopId, plate],
  );
  if (!booking) return null;

  const catalog = specsFromCatalog({
    make: booking.vehicle_make,
    model: booking.vehicle_model,
    year: booking.vehicle_year,
  });

  return {
    source: 'bookings',
    confidence: catalog ? 0.8 : 0.6,
    vehicle: serializeVehicle({
      id: null,
      shop_id: shopId,
      plate,
      make: booking.vehicle_make,
      model: booking.vehicle_model,
      version: catalog?.version ?? null,
      year: booking.vehicle_year ?? null,
      fuel: catalog?.fuel ?? null,
      engine: catalog?.engine ?? null,
      power_hp: catalog?.power_hp ?? null,
      body: catalog?.body ?? null,
      specs: catalog ? catalogSpecs(catalog) : {},
      photo_url: null,
      identified_by: 'history',
      confidence: catalog ? 0.8 : 0.6,
      customer_name: booking.customer_name ?? null,
      customer_phone: booking.customer_phone ?? null,
      notes: null,
      created_at: null,
      updated_at: null,
    }),
  };
}

/** Optional third-party plate database. Never throws: a failure is just "unknown". */
async function plateFromProvider(plate) {
  if (!config.plateLookup.configured) return null;

  const url = config.plateLookup.url.includes('{plate}')
    ? config.plateLookup.url.replace('{plate}', encodeURIComponent(plate))
    : `${config.plateLookup.url}${config.plateLookup.url.includes('?') ? '&' : '?'}plate=${encodeURIComponent(plate)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.plateLookup.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: config.plateLookup.apiKey
        ? { [config.plateLookup.header]: config.plateLookup.apiKey, Accept: 'application/json' }
        : { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[plates] provider replied ${response.status}`);
      return null;
    }
    const payload = await response.json();
    const data = payload?.vehicle ?? payload?.data ?? payload;
    const make = data?.make ?? data?.marca ?? null;
    const model = data?.model ?? data?.modelo ?? null;
    if (!make && !model) return null;

    const year = Number(data?.year ?? data?.anio ?? data?.año) || null;
    const catalog = specsFromCatalog({ make, model, version: data?.version ?? null, year });

    return {
      source: 'provider',
      confidence: 0.95,
      vehicle: serializeVehicle({
        id: null,
        shop_id: null,
        plate,
        make,
        model,
        version: data?.version ?? catalog?.version ?? null,
        year,
        fuel: data?.fuel ?? data?.combustible ?? catalog?.fuel ?? null,
        engine: data?.engine ?? catalog?.engine ?? null,
        power_hp: Number(data?.power_hp ?? data?.potencia) || catalog?.power_hp || null,
        body: data?.body ?? catalog?.body ?? null,
        specs: catalog ? catalogSpecs(catalog) : {},
        photo_url: null,
        identified_by: 'plate',
        confidence: 0.95,
        created_at: null,
        updated_at: null,
      }),
    };
  } catch (error) {
    console.warn(`[plates] provider lookup failed: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Plate → vehicle. Always returns the parsed plate, even when unknown. */
export async function identifyByPlate({ shopId, plate: raw }) {
  const parsed = parsePlate(raw);
  if (!parsed.plate) throw badRequest('Introduce una matrícula');

  const history = await plateFromHistory(shopId, parsed.plate);
  const provider = history?.source === 'registry' ? null : await plateFromProvider(parsed.plate);
  const best = provider ?? history;

  return {
    plate: parsed,
    found: Boolean(best),
    source: best?.source ?? null,
    confidence: best?.confidence ?? null,
    vehicle: best?.vehicle ?? null,
    provider_configured: config.plateLookup.configured,
    // Nothing known about this plate: the counter completes make/model by hand.
    makes: best ? [] : CATALOG_MAKES,
  };
}

const PHOTO_SYSTEM = [
  'Identificas vehículos en fotos para un taller mecánico español.',
  'Responde SOLO con JSON: {"make":"","model":"","version":"","year":0,"body":"hatchback|sedan|suv|wagon|van","fuel":"","plate":"","confidence":0.0}.',
  'Si no distingues un campo, devuélvelo como null. "confidence" entre 0 y 1.',
  'No inventes la matrícula: solo devuélvela si se lee con claridad en la imagen.',
].join(' ');

/**
 * Photo → candidate vehicle. Uses the vision model when configured; otherwise
 * reports that recognition is unavailable so the UI offers manual entry.
 */
export async function identifyByPhoto({ dataUrl }) {
  if (!aiConfigured()) {
    return {
      recognized: false,
      reason: 'vision_not_configured',
      vehicle: null,
      makes: CATALOG_MAKES,
    };
  }

  const result = await aiJson({
    system: PHOTO_SYSTEM,
    user: 'Identifica marca, modelo y versión aproximada de este vehículo.',
    images: [dataUrl],
    maxTokens: 300,
  });

  if (!result.ok) {
    return { recognized: false, reason: result.error, vehicle: null, makes: CATALOG_MAKES };
  }

  const data = result.data ?? {};
  const make = data.make ? String(data.make).trim() : null;
  const model = data.model ? String(data.model).trim() : null;
  if (!make && !model) {
    return { recognized: false, reason: 'no_vehicle_in_photo', vehicle: null, makes: CATALOG_MAKES };
  }

  const year = Number(data.year) || null;
  const catalog = specsFromCatalog({ make, model, version: data.version ?? null, year });
  const confidence = Number(data.confidence);

  return {
    recognized: true,
    reason: null,
    model_used: result.model,
    plate: data.plate ? parsePlate(data.plate) : null,
    matches: searchCatalog({ text: [make, model].filter(Boolean).join(' '), make, model, year, limit: 5 }),
    vehicle: serializeVehicle({
      id: null,
      shop_id: null,
      plate: data.plate ? normalizePlate(data.plate) : null,
      make,
      model,
      version: data.version ? String(data.version).trim() : (catalog?.version ?? null),
      year,
      fuel: data.fuel ? String(data.fuel).trim() : (catalog?.fuel ?? null),
      engine: catalog?.engine ?? null,
      power_hp: catalog?.power_hp ?? null,
      body: data.body ? String(data.body).trim() : (catalog?.body ?? null),
      specs: catalog ? catalogSpecs(catalog) : {},
      photo_url: null,
      identified_by: 'photo',
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
      created_at: null,
      updated_at: null,
    }),
  };
}

/** Manual / catalog search used by the "introducir a mano" path. */
export function searchVehicleCatalog({ text = '', make = null, model = null, year = null, limit = 8 } = {}) {
  return {
    makes: CATALOG_MAKES,
    models: make ? modelsForMake(make) : [],
    results: searchCatalog({ text, make, model, year, limit }),
    specs_are_reference: true,
  };
}

export async function saveVehicle({ shopId, input, userId = null }) {
  const plate = normalizePlate(input.plate);
  if (!plate && !input.make && !input.model) {
    throw badRequest('Indica al menos la matrícula o la marca y el modelo');
  }

  const catalogEntry = input.catalog_key ? catalogEntryByKey(input.catalog_key) : null;
  const make = input.make ?? catalogEntry?.make ?? null;
  const model = input.model ?? catalogEntry?.model ?? null;
  const version = input.version ?? catalogEntry?.version ?? null;
  const catalog = catalogEntry ?? specsFromCatalog({ make, model, version, year: input.year });

  const row = await queryOne(
    `INSERT INTO shop_vehicles
       (shop_id, plate, make, model, version, year, fuel, engine, power_hp, body, specs,
        photo_url, identified_by, confidence, customer_name, customer_phone, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (shop_id, plate) WHERE plate IS NOT NULL DO UPDATE
        SET make = COALESCE(EXCLUDED.make, shop_vehicles.make),
            model = COALESCE(EXCLUDED.model, shop_vehicles.model),
            version = COALESCE(EXCLUDED.version, shop_vehicles.version),
            year = COALESCE(EXCLUDED.year, shop_vehicles.year),
            fuel = COALESCE(EXCLUDED.fuel, shop_vehicles.fuel),
            engine = COALESCE(EXCLUDED.engine, shop_vehicles.engine),
            power_hp = COALESCE(EXCLUDED.power_hp, shop_vehicles.power_hp),
            body = COALESCE(EXCLUDED.body, shop_vehicles.body),
            specs = CASE WHEN EXCLUDED.specs = '{}'::jsonb THEN shop_vehicles.specs ELSE EXCLUDED.specs END,
            photo_url = COALESCE(EXCLUDED.photo_url, shop_vehicles.photo_url),
            identified_by = EXCLUDED.identified_by,
            confidence = EXCLUDED.confidence,
            customer_name = COALESCE(EXCLUDED.customer_name, shop_vehicles.customer_name),
            customer_phone = COALESCE(EXCLUDED.customer_phone, shop_vehicles.customer_phone),
            notes = COALESCE(EXCLUDED.notes, shop_vehicles.notes)
     RETURNING *`,
    [
      shopId,
      plate,
      make,
      model,
      version,
      input.year ?? null,
      input.fuel ?? catalog?.fuel ?? null,
      input.engine ?? catalog?.engine ?? null,
      input.power_hp ?? catalog?.power_hp ?? null,
      input.body ?? catalog?.body ?? null,
      JSON.stringify(catalog ? catalogSpecs(catalog) : (input.specs ?? {})),
      input.photo_url ?? null,
      input.identified_by ?? 'manual',
      input.confidence ?? null,
      input.customer_name ?? null,
      input.customer_phone ?? null,
      input.notes ?? null,
      userId,
    ],
  );

  return row;
}

export async function updateVehicle({ shopId, vehicleId, patch }) {
  const current = await getVehicle(shopId, vehicleId);
  if (!current) throw notFound('Vehículo no encontrado');

  const fields = [
    'make',
    'model',
    'version',
    'year',
    'fuel',
    'engine',
    'power_hp',
    'body',
    'photo_url',
    'customer_name',
    'customer_phone',
    'notes',
  ];
  const updates = [];
  const values = [vehicleId, shopId];

  if (patch.plate !== undefined) {
    values.push(normalizePlate(patch.plate));
    updates.push(`plate = $${values.length}`);
  }
  for (const field of fields) {
    if (patch[field] === undefined) continue;
    values.push(patch[field]);
    updates.push(`${field} = $${values.length}`);
  }
  if (!updates.length) return current;

  await query(`UPDATE shop_vehicles SET ${updates.join(', ')} WHERE id = $1 AND shop_id = $2`, values);
  return getVehicle(shopId, vehicleId);
}

export async function deleteVehicle({ shopId, vehicleId }) {
  const { rowCount } = await query(`DELETE FROM shop_vehicles WHERE id = $1 AND shop_id = $2`, [vehicleId, shopId]);
  if (!rowCount) throw notFound('Vehículo no encontrado');
  return { deleted: true };
}
