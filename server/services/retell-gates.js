/**
 * Strict Retell Urgencias gates: analysis (or transcript vehicle fallback),
 * duration > 40s, and a real vehicle — evaluated BEFORE "Sin vehículo" fallbacks.
 */
import {
  coerceAnalysisObject,
  extractNameFromSummary,
  extractTranscript,
  unwrapAnalysisScalar,
} from './retell.js';

/** Placeholder vehicle strings that must NOT create an Urgencia. */
const INVALID_VEHICLE_PLACEHOLDERS = new Set([
  '',
  '-',
  '—',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'desconocido',
  'unknown',
  'sin vehículo',
  'sin vehiculo',
  'sin marca',
  'sin modelo',
]);

/**
 * Common car brands (ES market) for transcript fallback detection.
 * Longer / multi-word names first so the regex prefers them.
 */
export const TRANSCRIPT_CAR_BRANDS = [
  'Mercedes-Benz',
  'Mercedes Benz',
  'Land Rover',
  'Range Rover',
  'Alfa Romeo',
  'Volkswagen',
  'Mercedes',
  'Citroën',
  'Citroen',
  'Hyundai',
  'Renault',
  'Peugeot',
  'Toyota',
  'Nissan',
  'Suzuki',
  'Mitsubishi',
  'Chevrolet',
  'Chrysler',
  'Porsche',
  'Jaguar',
  'Subaru',
  'Lexus',
  'Honda',
  'Mazda',
  'Volvo',
  'Skoda',
  'Škoda',
  'Dacia',
  'Cupra',
  'Tesla',
  'Fiat',
  'Ford',
  'Audi',
  'Seat',
  'Opel',
  'Kia',
  'BMW',
  'MINI',
  'Mini',
  'Jeep',
  'Dodge',
  'Saab',
  'VW',
];

const MODEL_STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'un',
  'una',
  'y',
  'o',
  'que',
  'con',
  'para',
  'por',
  'en',
  'mi',
  'tu',
  'su',
  'the',
  'a',
  'an',
  'and',
  'or',
  'is',
  'my',
  'car',
  'coche',
  'vehiculo',
  'vehículo',
  'marca',
  'modelo',
  'tengo',
  'necesito',
  'quiero',
  'hola',
  'gracias',
]);

let transcriptBrandRegex = null;

function getTranscriptBrandRegex() {
  if (transcriptBrandRegex) return transcriptBrandRegex;
  const escaped = TRANSCRIPT_CAR_BRANDS.map((brand) =>
    brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
  );
  transcriptBrandRegex = new RegExp(
    `\\b(${escaped.join('|')})(?:\\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9-]{0,24}))?\\b`,
    'i',
  );
  return transcriptBrandRegex;
}

/**
 * Plain transcript text from call / payload nestings (string or transcript_object).
 */
export function resolveTranscriptText(payload = {}, call = {}) {
  const candidates = [
    call,
    payload?.call,
    payload?.data?.call,
    payload,
    payload?.data,
  ];
  for (const source of candidates) {
    if (!source || typeof source !== 'object') continue;
    const text = extractTranscript(source);
    if (text) return text;
  }
  return null;
}

/**
 * Detect a car brand (+ optional model token) inside transcript text.
 * @returns {string|null} e.g. "Seat Ibiza" or "Ford"
 */
export function extractVehicleFromTranscript(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(getTranscriptBrandRegex());
  if (!match) return null;

  const brand = String(match[1] || '').replace(/\s+/g, ' ').trim();
  if (!brand) return null;

  let model = String(match[2] || '').trim();
  if (model) {
    const normalized = model
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    if (MODEL_STOPWORDS.has(normalized) || getTranscriptBrandRegex().test(model)) {
      model = '';
    }
  }

  const label = model ? `${brand} ${model}` : brand;
  return hasValidVehicle(label) ? label : null;
}

/**
 * Flexible post-call analysis lookup — every Retell nesting, no invented keys.
 * Prefer call.custom_analysis_data first (agent top-level), then body / call_analysis.
 * Returns `{}` when missing (never null) so callers can read aliases safely.
 */
export function extractFlexibleAnalysisData(payload = {}) {
  const candidates = [
    payload?.call?.custom_analysis_data,
    payload?.custom_analysis_data,
    payload?.call_analysis?.custom_analysis_data,
    payload?.call?.call_analysis?.custom_analysis_data,
    payload?.data?.call?.custom_analysis_data,
    payload?.data?.custom_analysis_data,
    payload?.data?.call_analysis?.custom_analysis_data,
    payload?.data?.call?.call_analysis?.custom_analysis_data,
  ];

  for (const raw of candidates) {
    const coerced = coerceAnalysisObject(raw);
    if (coerced && Object.keys(coerced).length > 0) return coerced;
  }
  return {};
}

/**
 * Post-call `custom_analysis_data` from any Retell nesting.
 * Returns `null` when missing or empty — NEVER invents fallback fields.
 */
export function getPostCallCustomData(payload = {}) {
  const data = extractFlexibleAnalysisData(payload);
  return Object.keys(data).length > 0 ? data : null;
}

/**
 * Normalize ES/EN analysis aliases without inventing "Sin …" placeholders.
 * @returns {{ name: string|null, vehicle: string|null, plate: string|null, reason: string|null }}
 */
export function normalizeExtractedFields(analysis = {}) {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = unwrapAnalysisScalar(analysis?.[key]);
      if (value == null) continue;
      const text = String(value).trim();
      if (!text || text === 'null' || text === 'undefined') continue;
      return text;
    }
    return null;
  };

  return {
    name: pick('nombre', 'name', 'customer_name', 'nombre_cliente'),
    vehicle: pick('vehiculo', 'vehicle', 'car', 'vehicle_make'),
    plate: pick('matricula', 'plate', 'license_plate', 'car_plate', 'placa'),
    reason: pick('motivo', 'reason', 'motivo_urgencia', 'urgency_reason'),
  };
}

/**
 * call_analyzed extraction + strict canCreateReserva flag (vehicle + duration > 40).
 * Vehicle falls back to transcript brand detection when analysis has none.
 * Name falls back to call_summary phrasing ("X called…").
 */
export function extractCallAnalyzedFields(payload = {}, call = {}) {
  const analysis = extractFlexibleAnalysisData(payload);
  let { name, vehicle: primaryVehicle, plate, reason } = normalizeExtractedFields(analysis);

  const summary =
    unwrapAnalysisScalar(call?.call_analysis?.call_summary) ||
    unwrapAnalysisScalar(payload?.call?.call_analysis?.call_summary) ||
    unwrapAnalysisScalar(analysis?.call_summary) ||
    unwrapAnalysisScalar(analysis?.summary) ||
    unwrapAnalysisScalar(analysis?.resumen) ||
    null;

  if (!name) {
    name = extractNameFromSummary(summary) || null;
  }

  // Secondary: marca+modelo via extractRawVehicle — never invents placeholders.
  let vehicle = primaryVehicle || extractRawVehicle(payload, analysis) || null;
  let vehicleSource = vehicle ? 'analysis' : null;

  if (!hasValidVehicle(vehicle)) {
    const transcript = resolveTranscriptText(payload, call);
    const fromTranscript = extractVehicleFromTranscript(transcript);
    if (fromTranscript) {
      vehicle = fromTranscript;
      vehicleSource = 'transcript';
      console.log('[RETELL VEHICLE FALLBACK] transcript brand detected:', vehicle);
    } else {
      vehicle = null;
      vehicleSource = null;
    }
  }

  const durationMs =
    Number(call?.duration_ms) ||
    (Number(call?.end_timestamp) && Number(call?.start_timestamp)
      ? Number(call.end_timestamp) - Number(call.start_timestamp)
      : 0) ||
    0;
  const durationSec = (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0) / 1000;

  // Vehicle (analysis or transcript) + duration > 40 unlocks reserva/urgencia intake.
  const canCreateReserva = Boolean(hasValidVehicle(vehicle) && durationSec > 40);

  return {
    analysis,
    name,
    vehicle,
    plate,
    reason,
    summary,
    durationSec,
    canCreateReserva,
    vehicleSource,
  };
}

/**
 * Raw vehicle from analysis — NEVER substitutes "Sin vehículo".
 * Primary (strict): vehiculo | vehicle | vehicle_make | car
 * Secondary: marca+modelo when agents send split fields.
 */
export function extractRawVehicle(payload = {}, customData = null) {
  const data =
    customData && typeof customData === 'object' && Object.keys(customData).length
      ? customData
      : extractFlexibleAnalysisData(payload);

  const primary =
    unwrapAnalysisScalar(data?.vehiculo) ||
    unwrapAnalysisScalar(data?.vehicle) ||
    unwrapAnalysisScalar(data?.vehicle_make) ||
    unwrapAnalysisScalar(data?.car) ||
    null;

  if (primary != null && String(primary).trim() !== '') {
    return String(primary).trim();
  }

  const make =
    unwrapAnalysisScalar(data?.marca) ||
    unwrapAnalysisScalar(data?.make) ||
    null;
  const model =
    unwrapAnalysisScalar(data?.vehicle_model) ||
    unwrapAnalysisScalar(data?.modelo) ||
    unwrapAnalysisScalar(data?.model) ||
    null;
  const composed = [make, model].filter(Boolean).join(' ').trim();
  return composed || null;
}

/**
 * Strict vehicle gate — evaluates the RAW value before any storage fallback.
 */
export function hasValidVehicle(rawVehicle) {
  if (rawVehicle == null) return false;
  const text = String(rawVehicle).trim();
  if (!text) return false;
  if (text === 'Sin vehículo' || text === 'Sin vehiculo') return false;
  if (text === 'null' || text === 'undefined') return false;

  const normalized = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (INVALID_VEHICLE_PLACEHOLDERS.has(normalized)) return false;
  if (normalized.startsWith('sin vehiculo')) return false;
  return true;
}

/** @deprecated Use hasValidVehicle(extractRawVehicle(...)). */
export function isValidVehicleValue(vehiculo) {
  return hasValidVehicle(vehiculo);
}

/**
 * Urgencias eligibility: valid vehicle (analysis or transcript) + duration > 40.
 * Empty custom_analysis_data is OK when transcript fallback supplies the vehicle.
 */
export function evaluateUrgenciaGates({ payload = {}, call = {} } = {}) {
  const extracted = extractCallAnalyzedFields(payload, call);
  let customData = Object.keys(extracted.analysis).length > 0 ? { ...extracted.analysis } : null;
  const rawVehicle = extracted.vehicle || null;

  if (!(extracted.durationSec > 40)) {
    return {
      ok: false,
      reason: 'short_duration',
      customData,
      rawVehicle,
      durationSec: extracted.durationSec,
    };
  }
  if (!hasValidVehicle(rawVehicle)) {
    return {
      ok: false,
      reason: customData ? 'missing_vehicle' : 'missing_custom_analysis_data',
      customData,
      rawVehicle,
      durationSec: extracted.durationSec,
    };
  }

  // Seed minimal analysis when transcript fallback unlocked the vehicle gate.
  if (!customData) {
    customData = {
      vehiculo: rawVehicle,
      vehicle: rawVehicle,
      _vehicle_source: 'transcript',
    };
  } else if (
    !normalizeExtractedFields(customData).vehicle &&
    extracted.vehicleSource === 'transcript'
  ) {
    customData = {
      ...customData,
      vehiculo: rawVehicle,
      vehicle: rawVehicle,
      _vehicle_source: 'transcript',
    };
  }

  return {
    ok: true,
    reason: null,
    customData,
    rawVehicle,
    durationSec: extracted.durationSec,
  };
}
