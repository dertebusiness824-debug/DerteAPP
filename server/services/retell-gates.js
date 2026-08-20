/**
 * Strict Retell Urgencias gates: non-empty custom_analysis_data, duration > 40s,
 * and a real vehicle — evaluated BEFORE any "Sin vehículo" / "Sin nombre" fallbacks.
 */
import { coerceAnalysisObject, unwrapAnalysisScalar } from './retell.js';

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
    plate: pick('matricula', 'plate', 'license_plate', 'placa'),
    reason: pick('motivo', 'reason', 'motivo_urgencia', 'urgency_reason'),
  };
}

/**
 * call_analyzed extraction + strict canCreateReserva flag (vehicle + duration > 40).
 */
export function extractCallAnalyzedFields(payload = {}, call = {}) {
  const analysis = extractFlexibleAnalysisData(payload);
  const { name, vehicle: primaryVehicle, plate, reason } = normalizeExtractedFields(analysis);
  // Secondary: marca+modelo (or other aliases) via extractRawVehicle — never invents placeholders.
  const vehicle = primaryVehicle || extractRawVehicle(payload, analysis) || null;

  const durationMs =
    Number(call?.duration_ms) ||
    (Number(call?.end_timestamp) && Number(call?.start_timestamp)
      ? Number(call.end_timestamp) - Number(call.start_timestamp)
      : 0) ||
    0;
  const durationSec = (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0) / 1000;

  const canCreateReserva = Boolean(hasValidVehicle(vehicle) && durationSec > 40);

  return {
    analysis,
    name,
    vehicle,
    plate,
    reason,
    durationSec,
    canCreateReserva,
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
 * Combined Urgencias eligibility: non-empty analysis + duration > 40 + valid vehicle.
 */
export function evaluateUrgenciaGates({ payload = {}, call = {} } = {}) {
  const extracted = extractCallAnalyzedFields(payload, call);
  const customData = Object.keys(extracted.analysis).length > 0 ? extracted.analysis : null;
  if (!customData) {
    return {
      ok: false,
      reason: 'missing_custom_analysis_data',
      customData: null,
      rawVehicle: null,
      durationSec: extracted.durationSec,
    };
  }

  const rawVehicle = extracted.vehicle || extractRawVehicle(payload, customData);

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
      reason: 'missing_vehicle',
      customData,
      rawVehicle,
      durationSec: extracted.durationSec,
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
