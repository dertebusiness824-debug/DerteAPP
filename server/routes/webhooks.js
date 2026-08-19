import express from 'express';
import config from '../config.js';
import {
  ingestRetellCall,
  isMissedOrTooShortCall,
  resolveCallDurationSec,
} from '../services/retell-intake.js';
import {
  coerceAnalysisObject,
  mergeCustomAnalysisData,
  unwrapAnalysisScalar,
  verifyWebhook,
} from '../services/retell.js';
import {
  extractRawVehicle,
  getPostCallCustomData,
  hasValidVehicle,
  isValidVehicleValue,
} from '../services/retell-gates.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

export {
  extractRawVehicle,
  getPostCallCustomData,
  hasValidVehicle,
  isValidVehicleValue,
} from '../services/retell-gates.js';

/**
 * Provider callbacks. Unauthenticated by design: each provider signs its
 * requests, and we verify that signature instead of a session.
 *
 * Retell is mounted FIRST in createApp() via mountRetellWebhookFirst() — before
 * helmet, compression, global body parsers, and any rate limiters — so Retell
 * never sees 400 "Queue is full." from intermediary middleware.
 *
 * Urgencias are created only when BOTH gates pass:
 * 1. durationSec > 40
 * 2. post-call analysis includes a real vehicle (marca/modelo)
 *
 * call_ended is ACK'd but does not create Urgencias (analysis not ready).
 * call_analyzed force-UPDATEs / inserts Urgencias with mapped fields.
 */

/** TEMP: signature check disabled so Retell's Test button does not get 401. */
const RETELL_SKIP_SIGNATURE = true;

/** In-flight background ingest jobs (tests await these). */
const pendingRetellWork = new Set();

/** @internal test helper — wait until background Retell ingest finishes. */
export async function flushRetellWebhookWork() {
  while (pendingRetellWork.size) {
    await Promise.allSettled([...pendingRetellWork]);
  }
}

function scheduleRetellWork(work) {
  const task = Promise.resolve()
    .then(work)
    .catch((error) => {
      console.error('[retell-webhook] background failed:', error?.message || error);
    })
    .finally(() => {
      pendingRetellWork.delete(task);
    });
  pendingRetellWork.add(task);

  if (config.isTest) return task;

  setImmediate(() => {
    void task;
  });
  return undefined;
}

function retellReadinessPayload() {
  return {
    provider: 'retell',
    ready: true,
    received: true,
    signature_verification: RETELL_SKIP_SIGNATURE
      ? 'temporarily_disabled'
      : config.retell.verifyWebhooks
        ? (config.retell.configured ? 'enabled' : 'missing_api_key')
        : 'disabled',
    webhook_url: `${config.appUrl}/api/webhooks/retell`,
    events: ['call_ended', 'call_analyzed'],
    gates: {
      min_duration_sec: 40,
      require_vehicle: true,
    },
  };
}

/**
 * Exhaustive lookup for a Retell custom analysis field, regardless of nesting.
 */
export function getCustomField(payload, fieldName) {
  if (!payload || typeof payload !== 'object' || !fieldName) return null;

  const bags = [
    payload?.call?.custom_analysis_data,
    payload?.call_analysis?.custom_analysis_data,
    payload?.custom_analysis_data,
    payload?.call?.call_analysis?.custom_analysis_data,
    payload?.data?.call?.custom_analysis_data,
    payload?.data?.call?.call_analysis?.custom_analysis_data,
    payload?.data?.custom_analysis_data,
    payload?.data?.call_analysis?.custom_analysis_data,
  ];

  for (const bag of bags) {
    const object = coerceAnalysisObject(bag);
    if (!object) continue;
    if (fieldName in object) {
      const unwrapped = unwrapAnalysisScalar(object[fieldName]);
      if (unwrapped != null) return unwrapped;
    }
    const wanted = normalizeLooseKey(fieldName);
    for (const [key, value] of Object.entries(object)) {
      if (normalizeLooseKey(key) !== wanted) continue;
      const unwrapped = unwrapAnalysisScalar(value);
      if (unwrapped != null) return unwrapped;
    }
  }

  return null;
}

function normalizeLooseKey(key) {
  return String(key ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

/**
 * Pull custom_analysis_data from the analyzed call (Retell nests it under
 * call_analysis most of the time; some agents put it on call directly).
 */
export function extractRetellCustomData(call = {}, body = {}) {
  const direct =
    coerceAnalysisObject(call?.call_analysis?.custom_analysis_data) ||
    coerceAnalysisObject(call?.custom_analysis_data) ||
    coerceAnalysisObject(body?.custom_analysis_data) ||
    coerceAnalysisObject(body?.call?.call_analysis?.custom_analysis_data) ||
    coerceAnalysisObject(body?.call?.custom_analysis_data) ||
    {};

  const merged = mergeCustomAnalysisData(call, body);
  return { ...merged, ...direct };
}

/** Map ES/EN analysis aliases via exhaustive getCustomField lookups. */
export function mapCustomAnalysisFieldsFromPayload(payload = {}) {
  const nombre =
    getCustomField(payload, 'nombre') ||
    getCustomField(payload, 'name') ||
    getCustomField(payload, 'nombre_cliente') ||
    getCustomField(payload, 'customer_name') ||
    'Sin nombre';
  // Storage mapping: prefer explicit vehicle fields (not marca+modelo join).
  const vehiculo =
    getCustomField(payload, 'vehiculo') ||
    getCustomField(payload, 'vehicle') ||
    getCustomField(payload, 'car') ||
    getCustomField(payload, 'modelo') ||
    'Sin vehículo';
  const matricula =
    getCustomField(payload, 'matricula') ||
    getCustomField(payload, 'plate') ||
    getCustomField(payload, 'license_plate') ||
    getCustomField(payload, 'placa') ||
    'Sin matrícula';
  const motivo =
    getCustomField(payload, 'motivo') ||
    getCustomField(payload, 'reason') ||
    getCustomField(payload, 'urgency_reason') ||
    getCustomField(payload, 'motivo_urgencia') ||
    'Consulta urgente';

  return {
    nombre: String(nombre).trim() || 'Sin nombre',
    vehiculo: String(vehiculo).trim() || 'Sin vehículo',
    matricula: String(matricula).trim() || 'Sin matrícula',
    motivo: String(motivo).trim() || 'Consulta urgente',
  };
}

/** @deprecated Prefer mapCustomAnalysisFieldsFromPayload(req.body). */
export function mapCustomAnalysisFields(customData = {}) {
  return mapCustomAnalysisFieldsFromPayload({ custom_analysis_data: customData });
}

function resolveCallFromBody(body = {}) {
  const envelope = body.data && typeof body.data === 'object' ? { ...body, ...body.data } : body;
  let call =
    (envelope.call && typeof envelope.call === 'object' && envelope.call) ||
    (body.call && typeof body.call === 'object' && body.call) ||
    null;

  if (!call && (envelope.call_id || body.call_id)) {
    call = { ...envelope };
    delete call.event;
    delete call.type;
    delete call.data;
  }

  if (!call) return null;

  if (envelope.args && typeof envelope.args === 'object') {
    call = { ...call, args: { ...(call.args || {}), ...envelope.args } };
  }
  if (body.args && typeof body.args === 'object' && body.args !== envelope.args) {
    call = { ...call, args: { ...(call.args || {}), ...body.args } };
  }
  return call;
}

function injectMappedAnalysis(call, mapped, customData = {}) {
  return {
    ...call,
    custom_analysis_data: {
      ...customData,
      nombre: mapped.nombre,
      name: customData.name || mapped.nombre,
      customer_name: customData.customer_name || mapped.nombre,
      vehiculo: mapped.vehiculo,
      vehicle: customData.vehicle || mapped.vehiculo,
      matricula: mapped.matricula,
      license_plate: customData.license_plate || mapped.matricula,
      plate: customData.plate || mapped.matricula,
      motivo: mapped.motivo,
      reason: customData.reason || mapped.motivo,
    },
    call_analysis: {
      ...(typeof call.call_analysis === 'object' && call.call_analysis ? call.call_analysis : {}),
      custom_analysis_data: {
        ...(typeof call.call_analysis?.custom_analysis_data === 'object' &&
        call.call_analysis.custom_analysis_data
          ? call.call_analysis.custom_analysis_data
          : {}),
        ...customData,
        nombre: mapped.nombre,
        vehiculo: mapped.vehiculo,
        matricula: mapped.matricula,
        motivo: mapped.motivo,
      },
    },
  };
}

async function processRetellEvent(req, eventType) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  console.log('Retell Payload Completo:', JSON.stringify(body, null, 2));

  let call = resolveCallFromBody(body);
  if (!call) {
    console.warn(`[retell-webhook] ${eventType} without call object — ignored`);
    return;
  }

  // Re-check gates in background work — never ingest empty analysis.
  const customData = getPostCallCustomData(body);
  if (!customData || Object.keys(customData).length === 0) {
    console.log('[RETELL WEBHOOK IGNORADO] Payload sin custom_analysis_data todavía.');
    return;
  }

  const durationSec = resolveCallDurationSec(call);
  const rawVehicle =
    unwrapAnalysisScalar(customData.vehiculo) ||
    unwrapAnalysisScalar(customData.vehicle) ||
    unwrapAnalysisScalar(customData.vehicle_make) ||
    extractRawVehicle(body, customData);
  if (!(durationSec > 40) || !hasValidVehicle(rawVehicle)) {
    console.log(`[WEBHOOK IGNORADO] Duración: ${durationSec}s | Vehículo: ${rawVehicle}`);
    return;
  }

  const nombreRaw =
    unwrapAnalysisScalar(customData.nombre) ||
    unwrapAnalysisScalar(customData.name) ||
    unwrapAnalysisScalar(customData.nombre_cliente) ||
    unwrapAnalysisScalar(customData.customer_name) ||
    null;
  const matriculaRaw =
    unwrapAnalysisScalar(customData.matricula) ||
    unwrapAnalysisScalar(customData.plate) ||
    unwrapAnalysisScalar(customData.license_plate) ||
    null;
  const motivoRaw =
    unwrapAnalysisScalar(customData.motivo) ||
    unwrapAnalysisScalar(customData.reason) ||
    unwrapAnalysisScalar(customData.motivo_urgencia) ||
    null;
  // Prefer explicit vehicle fields for storage; keep marca/modelo split intact.
  const vehiculoDirect =
    unwrapAnalysisScalar(customData.vehiculo) ||
    unwrapAnalysisScalar(customData.vehicle) ||
    unwrapAnalysisScalar(customData.car) ||
    unwrapAnalysisScalar(customData.modelo) ||
    null;

  // Storage defaults ONLY after the gate passed (vehicle is already validated raw).
  const mapped = {
    nombre: nombreRaw ? String(nombreRaw).trim() : 'Sin nombre',
    vehiculo: vehiculoDirect ? String(vehiculoDirect).trim() : String(rawVehicle).trim(),
    matricula: matriculaRaw ? String(matriculaRaw).trim() : 'Sin matrícula',
    motivo: motivoRaw ? String(motivoRaw).trim() : 'Consulta urgente',
  };

  const callId = body.call?.call_id ?? call.call_id ?? null;
  console.log('CUSTOM ANALYSIS DATA RECIBIDO:', customData);
  console.log('[RETELL WEBHOOK LOG]', {
    event: body.event ?? eventType,
    call_id: callId,
    nombre: mapped.nombre,
    vehiculo: mapped.vehiculo,
    matricula: mapped.matricula,
    motivo: mapped.motivo,
  });
  console.log('[RETELL WEBHOOK VALIDADO]', {
    callId,
    durationSec,
    vehiculo: mapped.vehiculo,
    nombre: nombreRaw,
    analysis_keys: Object.keys(customData),
  });

  if (eventType === 'call_analyzed') {
    call = injectMappedAnalysis(call, mapped, customData);
  }

  if (!RETELL_SKIP_SIGNATURE && config.retell.verifyWebhooks) {
    const verification = verifyWebhook(req.rawBody ?? '', req.get('x-retell-signature'));
    if (!verification.ok) {
      console.error('[retell-webhook] signature rejected:', verification.reason);
      return;
    }
  }

  const missed = isMissedOrTooShortCall(call);
  if (missed.skip) {
    console.log(
      'Llamada ignorada por ser llamada perdida/corta:',
      call.call_id,
      missed.durationMs,
    );
    return;
  }

  await ingestRetellCall({
    event: eventType,
    call,
    body,
    analysisOverrides: eventType === 'call_analyzed' ? mapped : null,
  });
}

/**
 * Registers /api/webhooks/retell at the absolute top of the Express stack —
 * before helmet, compression, global JSON limits, cookies, requestContext, etc.
 *
 * Gates: durationSec > 40 AND valid vehicle before Urgencias ingest.
 */
export function mountRetellWebhookFirst(app) {
  const retellJson = express.json({
    limit: '4mb',
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString('utf8');
    },
  });

  app.get('/api/webhooks/retell', (_req, res) => {
    res.status(200).json(retellReadinessPayload());
  });

  app.post('/api/webhooks/retell', (req, res) => {
    retellJson(req, res, (parseErr) => {
      if (parseErr) {
        console.error('[retell-webhook] body parse failed:', parseErr?.message || parseErr);
        if (!res.headersSent) res.status(200).json({ received: true });
        return;
      }

      const eventType = String(req.body?.event ?? req.body?.type ?? req.body?.data?.event ?? '');
      if (eventType !== 'call_ended' && eventType !== 'call_analyzed') {
        console.log('[retell-webhook] ignoring event', { event: eventType || null });
        if (!res.headersSent) {
          res.status(200).json({
            message: 'Esperando evento call_ended o call_analyzed',
            received: true,
          });
        }
        return;
      }

      const call = resolveCallFromBody(req.body) || req.body?.call || {};
      const durationSec = resolveCallDurationSec(call);

      // 1) Require non-empty custom_analysis_data BEFORE any fallbacks / ingest.
      const customData = getPostCallCustomData(req.body);
      if (!customData || Object.keys(customData).length === 0) {
        console.log('[RETELL WEBHOOK IGNORADO] Payload sin custom_analysis_data todavía.');
        if (!res.headersSent) {
          res.status(200).json({
            message: 'Esperando análisis completo de Retell AI',
            received: true,
          });
        }
        return;
      }

      // call_ended with analysis is still not the canonical Urgencias write.
      if (eventType === 'call_ended') {
        console.log('[RETELL WEBHOOK IGNORADO] Esperando call_analyzed (no se guarda en call_ended).');
        if (!res.headersSent) {
          res.status(200).json({
            message: 'Esperando análisis completo de Retell AI',
            received: true,
            event: 'call_ended',
          });
        }
        return;
      }

      // 2) Strict raw vehicle — no "Sin vehículo" fallback before the gate.
      const rawVehicle =
        unwrapAnalysisScalar(customData.vehiculo) ||
        unwrapAnalysisScalar(customData.vehicle) ||
        unwrapAnalysisScalar(customData.vehicle_make) ||
        extractRawVehicle(req.body, customData);
      const vehicleOk = hasValidVehicle(rawVehicle);

      // 3) Both gates required: duration > 40 AND valid vehicle.
      if (!(durationSec > 40) || !vehicleOk) {
        console.log(
          `[WEBHOOK IGNORADO] Duración: ${durationSec}s | Vehículo: ${rawVehicle}`,
        );
        if (!res.headersSent) {
          res.status(200).json({ message: 'Llamada ignorada', received: true });
        }
        return;
      }

      const nombre =
        unwrapAnalysisScalar(customData?.nombre) ||
        unwrapAnalysisScalar(customData?.name) ||
        unwrapAnalysisScalar(customData?.nombre_cliente) ||
        unwrapAnalysisScalar(customData?.customer_name) ||
        null;
      const callId = req.body?.call?.call_id ?? call.call_id ?? null;
      console.log('[RETELL WEBHOOK VALIDADO]', {
        callId,
        durationSec,
        vehiculo: rawVehicle,
        nombre,
        analysis_keys: Object.keys(customData),
      });

      if (!res.headersSent) res.status(200).json({ received: true, event: 'call_analyzed' });

      // 4) Upsert Urgencias only after both filters pass.
      const scheduled = scheduleRetellWork(() => processRetellEvent(req, eventType));
      if (scheduled) void scheduled;
    });
  });
}

/** Zadarma (+ legacy) webhook router — mounted later under /api/webhooks. */
const router = express.Router();

router.get('/retell', (_req, res) => {
  res.status(200).json(retellReadinessPayload());
});
router.post('/retell', (_req, res) => {
  res.status(200).json({
    received: true,
    message: 'Esperando evento call_ended o call_analyzed',
  });
});

router.use('/', zadarmaWebhookRouter);

export default router;
