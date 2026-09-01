/**
 * APIVehículo (apivehiculo.com) plate lookup.
 *
 * Server-only. The key never leaves this process: Super Admin Ajustes can
 * store it, `API_VEHICULO_KEY` is the env fallback, and both the workshop
 * “Identificar vehículo” path and the Super Admin plate tool consume it.
 *
 * Failures never throw past `lookupPlate`: the UI needs a reason it can show
 * ("not in the register", "quota exhausted", "upstream down"), not a 500.
 */
import config from '../config.js';
import { query, queryAll, queryOne } from '../db/index.js';
import { formatPlate, parsePlate } from '../lib/plates.js';
import { photoForBody, searchCatalog } from '../lib/vehicle-catalog.js';

export const PROVIDER = 'apivehiculo.com';
export const SOURCE = 'apivehiculo';

const SETTINGS_KEY = 'apivehiculo_api_key';
let storedKey = '';
let hydrated = false;

export const REASONS = {
  not_configured:
    'La API de vehículos no está configurada. Pega la clave en Ajustes o añade API_VEHICULO_KEY en el servidor.',
  invalid_key: 'La API key de APIVehículo no es válida. Revísala en Ajustes.',
  invalid_plate: 'Introduce una matrícula española válida.',
  not_found: 'Esa matrícula no aparece en el registro oficial.',
  quota_exceeded: 'Se ha agotado la cuota de consultas de APIVehículo. Prueba más tarde o revisa el plan.',
  timeout: 'La consulta al registro oficial ha tardado demasiado. Inténtalo de nuevo.',
  upstream_error: 'No se ha podido contactar con APIVehículo. Inténtalo de nuevo.',
};

const BODY_ALIASES = [
  { match: /suv|crossover|4x4|todo.?terreno|tout.?terrain/i, body: 'suv' },
  { match: /wagon|break|familiar|estate|touring/i, body: 'wagon' },
  { match: /van|mpv|monovolumen|combi|minivan/i, body: 'van' },
  { match: /sedan|berlina|berline|saloon/i, body: 'sedan' },
  { match: /hatch|compact|utilitario/i, body: 'hatchback' },
];

const FUEL_ALIASES = [
  { match: /^(gasoline|petrol|essence|nafta)$/i, fuel: 'gasolina' },
  { match: /^(diesel|gasoil|gasóleo)$/i, fuel: 'diésel' },
  { match: /electric/i, fuel: 'eléctrico' },
  { match: /hybrid|h[ií]brid/i, fuel: 'híbrido' },
  { match: /lpg|glp|autogas/i, fuel: 'GLP' },
];

const catalogSpecs = (entry) =>
  entry
    ? {
        ...entry.specs,
        catalog_key: entry.key,
        catalog_version: entry.version,
        year_from: entry.year_from,
        year_to: entry.year_to,
      }
    : {};

/** First non-empty value among a list of candidate keys (dot paths allowed). */
export function pick(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    const value = String(key)
      .split('.')
      .reduce((cursor, part) => (cursor == null ? cursor : cursor[part]), source);
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      const first = value.find((item) => item !== undefined && item !== null && item !== '');
      if (first !== undefined) return first;
      continue;
    }
    return value;
  }
  return null;
}

const asText = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  return text || null;
};

const asYear = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  const match = text.match(/(19|20)\d{2}/);
  if (!match) return null;
  const year = Number(match[0]);
  return year >= 1900 && year <= 2100 ? year : null;
};

const asInt = (value, { min = 0, max = 1_000_000 } = {}) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  return rounded >= min && rounded <= max ? rounded : null;
};

/** Official JSON is `{ code, message, data }`; also accept a flat vehicle object. */
export function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const nested = payload.data ?? payload.vehicle ?? payload.result ?? payload.car ?? payload.respuesta ?? payload;
  return nested && typeof nested === 'object' ? nested : payload;
}

function mapBody(raw) {
  const text = asText(raw);
  if (!text) return null;
  const known = ['hatchback', 'sedan', 'suv', 'wagon', 'van'];
  const lower = text.toLowerCase();
  if (known.includes(lower)) return lower;
  for (const alias of BODY_ALIASES) {
    if (alias.match.test(text)) return alias.body;
  }
  return null;
}

function mapFuel(raw) {
  const text = asText(raw);
  if (!text) return null;
  for (const alias of FUEL_ALIASES) {
    if (alias.match.test(text)) return alias.fuel;
  }
  return text;
}

function looksLikeQuota(status, message) {
  if (status === 429) return true;
  const text = String(message || '').toLowerCase();
  return /quota|rate.?limit|exceeded|l[ií]mite|agotad|cr[eé]dito/.test(text);
}

function looksLikeInvalidKey(status, message) {
  if (status === 401 || status === 403) return true;
  const text = String(message || '').toLowerCase();
  return /invalid.?api.?key|unauthorized|forbidden|api.?key/.test(text) && /invalid|unauthor|forbidden/.test(text);
}

function looksLikeNotFound(status, payload, message) {
  if (status === 404) return true;
  if (payload?.found === false || payload?.error === true) return true;
  const code = payload?.code;
  if (code === 404 || code === 'not_found') return true;
  const text = String(message || payload?.message || '').toLowerCase();
  return /not found|no encontr|desconocid|unknown plate|sin resultado/.test(text);
}

function authHeaders(apiKey) {
  const token = String(apiKey || '').replace(/^Bearer\s+/i, '').trim();
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Turns an APIVehículo JSON blob into the fields the vehicle card already paints.
 */
export function mapOfficialVehicle(payload, plate) {
  const data = unwrapPayload(payload);
  const make = asText(pick(data, ['brand', 'marca', 'make', 'manufacturer']));
  const model = asText(pick(data, ['model', 'modelo', 'modelEn']));
  if (!make && !model) return null;

  const version = asText(pick(data, ['version', 'modelEn', 'trim', 'comercial']));
  const year =
    asYear(pick(data, ['firstRegistrationDate', 'year', 'anio', 'año', 'ano'])) ??
    asYear(pick(data, ['fechaMatriculacion', 'fecha_matriculacion', 'first_registration']));
  const fuel = mapFuel(pick(data, ['fuelType', 'combustible', 'fuel', 'fuel_type']));
  const engine = asText(pick(data, ['engine', 'motor', 'engineCode', 'engine_code']));
  const powerHp = asInt(pick(data, ['powerHP', 'power_hp', 'potencia', 'cv']), { min: 1, max: 2000 });
  const powerKw = asInt(pick(data, ['powerKW', 'power_kw', 'potencia_kw', 'kw']), { min: 1, max: 2000 });
  const displacement = asInt(pick(data, ['displacement', 'cilindrada', 'displacement_cc', 'cc', 'displacementCcm']), {
    min: 50,
    max: 12000,
  });
  const gearbox = asText(pick(data, ['gearbox', 'cambio', 'transmission', 'transmision', 'gearboxType', 'transmissionType']));
  const body = mapBody(pick(data, ['bodyType', 'carroceria', 'body', 'tipo', 'vehicle_type', 'vehicleType']));
  const vin = asText(pick(data, ['vin', 'VIN', 'bastidor', 'numero_bastidor']));
  const tecdoc = asText(pick(data, ['tecdoc', 'tecDoc', 'tecdoc_id', 'kType', 'k_type']));
  const mine = asText(pick(data, ['mine', 'tipo_mine', 'kba']));
  const firstRegistered = asText(
    pick(data, ['firstRegistrationDate', 'fechaMatriculacion', 'fecha_matriculacion', 'first_registration']),
  );

  const catalog = searchCatalog({
    text: [make, model, version].filter(Boolean).join(' '),
    make,
    model,
    year,
    limit: 1,
  })[0];

  const specs = {
    ...catalogSpecs(catalog),
    ...(displacement ? { displacement_cc: displacement } : {}),
    ...(gearbox ? { gearbox } : {}),
    ...(powerKw ? { power_kw: powerKw } : {}),
    ...(vin ? { vin } : {}),
    ...(tecdoc ? { tecdoc } : {}),
    ...(mine ? { mine } : {}),
    ...(firstRegistered ? { first_registered: firstRegistered } : {}),
    provider: PROVIDER,
  };

  return {
    id: null,
    shop_id: null,
    plate,
    make,
    model,
    version: version ?? catalog?.version ?? null,
    year: year ?? catalog?.year_from ?? null,
    fuel: fuel ?? catalog?.fuel ?? null,
    engine: engine ?? catalog?.engine ?? null,
    power_hp: powerHp ?? catalog?.power_hp ?? null,
    body: body ?? catalog?.body ?? null,
    specs,
    photo_url: null,
    identified_by: 'plate',
    confidence: 0.97,
    customer_name: null,
    customer_phone: null,
    notes: null,
    created_at: null,
    updated_at: null,
    official: {
      vin,
      tecdoc,
      mine,
      first_registered: firstRegistered,
      power_kw: powerKw,
      country: asText(pick(data, ['country', 'pais'])) ?? 'ES',
      provider: PROVIDER,
    },
  };
}

export function serializeOfficialVehicle(row) {
  if (!row) return null;
  const official = row.official ?? {};
  return {
    id: row.id ?? null,
    shop_id: row.shop_id ?? null,
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
    photo_url: row.photo_url ?? (row.body ? photoForBody(row.body) : photoForBody('hatchback')),
    has_own_photo: Boolean(row.photo_url),
    identified_by: row.identified_by ?? 'plate',
    confidence: 0.97,
    official,
    specs_are_reference: false,
    source: SOURCE,
  };
}

/** DB key set from Ajustes, if any. Env is the fallback so deploys work without Ajustes. */
export const effectiveApiKey = () => (storedKey || config.apivehiculo.apiKey).trim();

export const isConfigured = () => Boolean(effectiveApiKey());

/** Unit tests call this so they never read platform_settings or a live key. */
export function resetKeyStateForTests({ stored = '', markHydrated = true } = {}) {
  storedKey = String(stored ?? '').trim();
  hydrated = markHydrated;
}

export async function hydrateStoredApiKey() {
  try {
    const row = await queryOne(`SELECT value FROM platform_settings WHERE key = $1`, [SETTINGS_KEY]);
    storedKey = (row?.value ?? '').trim();
  } catch {
    storedKey = '';
  }
  hydrated = true;
  return storedKey;
}

/**
 * Persists a new APIVehículo key. An empty value is a no-op so the Super Admin
 * can save Ajustes without wiping the secret.
 */
export async function saveApiKey(value, { userId = null } = {}) {
  const key = String(value ?? '').trim();
  if (!key) {
    if (!hydrated) await hydrateStoredApiKey();
    return { configured: isConfigured(), unchanged: true };
  }
  await query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
    [SETTINGS_KEY, key, userId],
  );
  storedKey = key;
  hydrated = true;
  return { configured: true, unchanged: false };
}

function lookupUrl(plate) {
  const url = new URL(config.apivehiculo.url);
  url.searchParams.set('plate', plate);
  url.searchParams.set('country', config.apivehiculo.country);
  return url;
}

/**
 * Calls APIVehículo. `fetchImpl` is injectable so unit tests never hit the
 * network. Never throws: every outcome is `{ ok, found, reason, vehicle }`.
 */
export async function lookupPlate(rawPlate, { fetchImpl = fetch } = {}) {
  const parsed = parsePlate(rawPlate);
  if (!parsed.plate) {
    return { ok: false, found: false, reason: 'invalid_plate', plate: parsed, vehicle: null };
  }
  if (!hydrated) await hydrateStoredApiKey();
  const apiKey = effectiveApiKey();
  if (!apiKey) {
    return { ok: false, found: false, reason: 'not_configured', plate: parsed, vehicle: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.apivehiculo.timeoutMs);

  try {
    const response = await fetchImpl(lookupUrl(parsed.plate), {
      method: 'GET',
      headers: authHeaders(apiKey),
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const message = payload?.message ?? payload?.error ?? payload?.detail ?? response.statusText;

    if (looksLikeInvalidKey(response.status, message)) {
      return { ok: false, found: false, reason: 'invalid_key', plate: parsed, vehicle: null };
    }
    if (looksLikeQuota(response.status, message)) {
      return { ok: false, found: false, reason: 'quota_exceeded', plate: parsed, vehicle: null };
    }
    if (!response.ok && looksLikeNotFound(response.status, payload, message)) {
      return { ok: true, found: false, reason: 'not_found', plate: parsed, vehicle: null };
    }
    if (!response.ok) {
      console.warn(`[apivehiculo] upstream ${response.status}: ${String(message).slice(0, 180)}`);
      return { ok: false, found: false, reason: 'upstream_error', plate: parsed, vehicle: null };
    }

    const mapped = mapOfficialVehicle(payload, parsed.plate);
    if (!mapped) {
      return { ok: true, found: false, reason: 'not_found', plate: parsed, vehicle: null };
    }

    return {
      ok: true,
      found: true,
      reason: null,
      plate: parsed,
      vehicle: serializeOfficialVehicle(mapped),
      official: mapped.official,
    };
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return { ok: false, found: false, reason: 'timeout', plate: parsed, vehicle: null };
    }
    console.warn(`[apivehiculo] lookup failed: ${error.message}`);
    return { ok: false, found: false, reason: 'upstream_error', plate: parsed, vehicle: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cheap connectivity check: talks to the official endpoint without requiring
 * a real plate hit. 401/403 = bad key; any other HTTP answer = reachable.
 */
export async function probeConnection({ fetchImpl = fetch } = {}) {
  if (!hydrated) await hydrateStoredApiKey();
  const apiKey = effectiveApiKey();
  if (!apiKey) {
    return { ok: false, configured: false, reason: 'not_configured', status: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.apivehiculo.timeoutMs);
  try {
    const response = await fetchImpl(lookupUrl('0000XXX'), {
      method: 'GET',
      headers: authHeaders(apiKey),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, configured: true, reason: 'invalid_key', status: response.status };
    }
    return { ok: true, configured: true, reason: null, status: response.status };
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return { ok: false, configured: true, reason: 'timeout', status: null };
    }
    return { ok: false, configured: true, reason: 'upstream_error', status: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function recordLookup({
  userId,
  shopId = null,
  plate,
  found,
  reason,
  make = null,
  model = null,
} = {}) {
  try {
    await query(
      `INSERT INTO matriculas_lookups (user_id, shop_id, plate, found, reason, make, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, shopId, plate, found, reason, make, model],
    );
  } catch (error) {
    console.warn(`[apivehiculo] audit insert failed: ${error.message}`);
  }
}

export const listLookups = ({ limit = 20 } = {}) =>
  queryAll(
    `SELECT id, plate, found, reason, make, model, shop_id, created_at
       FROM matriculas_lookups
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );

export const lookupStatus = async () => {
  if (!hydrated) await hydrateStoredApiKey();
  const today = await queryOne(
    `SELECT count(*)::int AS n FROM matriculas_lookups WHERE created_at >= date_trunc('day', now())`,
  );
  return {
    configured: isConfigured(),
    provider: PROVIDER,
    lookups_today: today?.n ?? 0,
    env_configured: Boolean(config.apivehiculo.apiKey),
    stored_configured: Boolean(storedKey),
  };
};
