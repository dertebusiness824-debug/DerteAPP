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
 * Post-call `custom_analysis_data` from any Retell nesting.
 * Returns `null` when missing or empty — NEVER invents fallback fields.
 * Includes `call.call_analysis.custom_analysis_data` (Retell's real path).
 */
export function getPostCallCustomData(payload = {}) {
  const candidates = [
    payload?.call?.call_analysis?.custom_analysis_data,
    payload?.call?.custom_analysis_data,
    payload?.custom_analysis_data,
    payload?.call_analysis?.custom_analysis_data,
    payload?.data?.call?.call_analysis?.custom_analysis_data,
    payload?.data?.call?.custom_analysis_data,
    payload?.data?.custom_analysis_data,
    payload?.data?.call_analysis?.custom_analysis_data,
  ];

  for (const raw of candidates) {
    const coerced = coerceAnalysisObject(raw);
    if (coerced && Object.keys(coerced).length > 0) return coerced;
  }
  return null;
}

/**
 * Raw vehicle from analysis — NEVER substitutes "Sin vehículo".
 * Primary (strict): vehiculo | vehicle | vehicle_make
 * Secondary: car, or marca+modelo when agents send split fields.
 */
export function extractRawVehicle(payload = {}, customData = null) {
  const data =
    customData && typeof customData === 'object' && Object.keys(customData).length
      ? customData
      : getPostCallCustomData(payload) || {};

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
  const customData = getPostCallCustomData(payload);
  if (!customData || Object.keys(customData).length === 0) {
    return {
      ok: false,
      reason: 'missing_custom_analysis_data',
      customData: null,
      rawVehicle: null,
      durationSec: null,
    };
  }

  const durationMs =
    Number(call.duration_ms) ||
    (Number(call.end_timestamp) && Number(call.start_timestamp)
      ? Number(call.end_timestamp) - Number(call.start_timestamp)
      : 0) ||
    0;
  const durationSec = (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0) / 1000;

  const rawVehicle =
    unwrapAnalysisScalar(customData.vehiculo) ||
    unwrapAnalysisScalar(customData.vehicle) ||
    unwrapAnalysisScalar(customData.vehicle_make) ||
    extractRawVehicle(payload, customData);

  if (!(durationSec > 40)) {
    return { ok: false, reason: 'short_duration', customData, rawVehicle, durationSec };
  }
  if (!hasValidVehicle(rawVehicle)) {
    return { ok: false, reason: 'missing_vehicle', customData, rawVehicle, durationSec };
  }

  return { ok: true, reason: null, customData, rawVehicle, durationSec };
}
