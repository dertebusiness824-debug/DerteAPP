/**
 * Matriculas.org plate lookup.
 *
 * Talks to the RapidAPI host from the server. The Super Admin panel is the
 * only caller: workshop routes never import this module, so a shop owner or a
 * customer cannot spend the quota even if they guess the URL.
 *
 * Failures never throw past `lookupPlate`: the UI needs a reason it can show
 * ("not in the register", "quota exhausted", "upstream down"), not a 500.
 */
import config from '../config.js';
import { query, queryAll, queryOne } from '../db/index.js';
import { formatPlate, parsePlate } from '../lib/plates.js';
import { photoForBody, searchCatalog } from '../lib/vehicle-catalog.js';

export const PROVIDER = 'matriculas.org';

export const REASONS = {
  not_configured: 'La API de matrículas no está configurada. Añade MATRICULAS_API_KEY en el servidor.',
  invalid_plate: 'Introduce una matrícula española válida.',
  not_found: 'Esa matrícula no aparece en el registro oficial.',
  quota_exceeded: 'Se ha agotado la cuota de consultas de Matriculas.org. Prueba más tarde o revisa el plan.',
  timeout: 'La consulta al registro oficial ha tardado demasiado. Inténtalo de nuevo.',
  upstream_error: 'No se ha podido contactar con el registro de matrículas. Inténtalo de nuevo.',
};

const BODY_ALIASES = [
  { match: /suv|crossover|4x4|todo.?terreno|tout.?terrain/i, body: 'suv' },
  { match: /wagon|break|familiar|estate|touring/i, body: 'wagon' },
  { match: /van|mpv|monovolumen|combi|minivan/i, body: 'van' },
  { match: /sedan|berlina|berline|saloon/i, body: 'sedan' },
  { match: /hatch|compact|utilitario/i, body: 'hatchback' },
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

function flattenAwn(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const out = { ...source };
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith('AWN_')) continue;
    const plain = key.slice(4);
    if (out[plain] === undefined) out[plain] = value;
  }
  return out;
}

/** The RapidAPI payload has worn several shapes; unwrap the object that holds the car. */
export function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const nested =
    payload.vehicle ??
    payload.data ??
    payload.result ??
    payload.car ??
    payload.respuesta ??
    payload;
  return flattenAwn(nested && typeof nested === 'object' ? nested : payload);
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

function looksLikeQuota(status, message) {
  if (status === 429) return true;
  const text = String(message || '').toLowerCase();
  return /quota|rate.?limit|exceeded|l[ií]mite|agotad/.test(text);
}

function looksLikeNotFound(status, payload, message) {
  if (status === 404) return true;
  if (payload?.found === false || payload?.error === true) return true;
  const text = String(message || '').toLowerCase();
  return /not found|no encontr|desconocid|unknown plate|sin resultado/.test(text);
}

/**
 * Turns any Matriculas.org / RapidAPI JSON blob into the fields the vehicle
 * card already knows how to paint.
 */
export function mapOfficialVehicle(payload, plate) {
  const data = unwrapPayload(payload);
  const make = asText(
    pick(data, ['marca', 'make', 'brand', 'AWN_marque', 'marque', 'manufacturer']),
  );
  const model = asText(
    pick(data, ['modelo', 'model', 'AWN_modele', 'modele', 'modelo_etude', 'AWN_modele_etude']),
  );
  if (!make && !model) return null;

  const version = asText(
    pick(data, ['version', 'AWN_version', 'AWN_label', 'label', 'trim', 'comercial']),
  );
  const year =
    asYear(pick(data, ['year', 'anio', 'año', 'ano', 'AWN_annee_de_debut_modele'])) ??
    asYear(pick(data, ['fechaMatriculacion', 'fecha_matriculacion', 'first_registration',
      'AWN_date_mise_en_circulation_us', 'AWN_date_mise_en_circulation']));
  const fuel = asText(
    pick(data, ['combustible', 'fuel', 'AWN_energie', 'energie', 'fuel_type']),
  );
  const engine = asText(
    pick(data, ['motor', 'engine', 'AWN_code_moteur', 'code_moteur', 'engine_code']),
  );
  const powerHp =
    asInt(pick(data, ['potencia', 'power_hp', 'cv', 'AWN_puissance_chevaux', 'puissance_chevaux']), {
      min: 1,
      max: 2000,
    });
  const powerKw = asInt(pick(data, ['potencia_kw', 'power_kw', 'AWN_puissance_KW', 'kw']), {
    min: 1,
    max: 2000,
  });
  const displacement = asInt(
    pick(data, ['cilindrada', 'displacement_cc', 'AWN_nbr_cylindre_energie', 'cc']),
    { min: 50, max: 12000 },
  );
  const gearbox = asText(
    pick(data, ['cambio', 'gearbox', 'AWN_type_embrayage', 'transmision', 'transmission']),
  );
  const body =
    mapBody(pick(data, ['carroceria', 'body', 'tipo', 'vehicle_type', 'AWN_style_carrosserie', 'style_carrosserie'])) ??
    null;
  const vin = asText(pick(data, ['vin', 'VIN', 'AWN_VIN', 'bastidor', 'numero_bastidor']));
  const tecdoc = asText(pick(data, ['tecdoc', 'tecDoc', 'tecdoc_id', 'AWN_k_type', 'k_type', 'ktype']));
  const mine = asText(pick(data, ['mine', 'tipo_mine', 'AWN_KBA', 'kba']));
  const firstRegistered = asText(
    pick(data, [
      'fechaMatriculacion',
      'fecha_matriculacion',
      'first_registration',
      'AWN_date_mise_en_circulation_us',
      'AWN_date_mise_en_circulation',
    ]),
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
      country: asText(pick(data, ['pais', 'country', 'AWN_pays'])) ?? 'ES',
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
    source: 'matriculas',
  };
}

export const isConfigured = () => config.matriculas.configured;

/**
 * Calls Matriculas.org. `fetchImpl` is injectable so unit tests never hit the
 * network. Never throws: every outcome is `{ ok, found, reason, vehicle }`.
 */
export async function lookupPlate(rawPlate, { fetchImpl = fetch } = {}) {
  const parsed = parsePlate(rawPlate);
  if (!parsed.plate) {
    return { ok: false, found: false, reason: 'invalid_plate', plate: parsed, vehicle: null };
  }
  if (!isConfigured()) {
    return { ok: false, found: false, reason: 'not_configured', plate: parsed, vehicle: null };
  }

  const url = new URL(config.matriculas.url);
  url.searchParams.set('plate', parsed.plate);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.matriculas.timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-RapidAPI-Key': config.matriculas.apiKey,
        'X-RapidAPI-Host': config.matriculas.host,
      },
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const message = payload?.message ?? payload?.error ?? payload?.detail ?? response.statusText;

    if (looksLikeQuota(response.status, message)) {
      return { ok: false, found: false, reason: 'quota_exceeded', plate: parsed, vehicle: null };
    }
    if (!response.ok && looksLikeNotFound(response.status, payload, message)) {
      return { ok: true, found: false, reason: 'not_found', plate: parsed, vehicle: null };
    }
    if (!response.ok) {
      console.warn(`[matriculas] upstream ${response.status}: ${String(message).slice(0, 180)}`);
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
    if (error?.name === 'AbortError') {
      return { ok: false, found: false, reason: 'timeout', plate: parsed, vehicle: null };
    }
    console.warn(`[matriculas] lookup failed: ${error.message}`);
    return { ok: false, found: false, reason: 'upstream_error', plate: parsed, vehicle: null };
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
    // Audit must never sink the lookup the Super Admin just paid for.
    console.warn(`[matriculas] audit insert failed: ${error.message}`);
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
  const today = await queryOne(
    `SELECT count(*)::int AS n FROM matriculas_lookups WHERE created_at >= date_trunc('day', now())`,
  );
  return {
    configured: isConfigured(),
    provider: PROVIDER,
    lookups_today: today?.n ?? 0,
  };
};
