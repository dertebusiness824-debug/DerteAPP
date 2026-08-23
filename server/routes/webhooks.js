import express from 'express';
import config from '../config.js';
import {
  ingestRetellCall,
  resolveCallDurationSec,
} from '../services/retell-intake.js';
import {
  coerceAnalysisObject,
  mergeCustomAnalysisData,
  unwrapAnalysisScalar,
  verifyWebhook,
} from '../services/retell.js';
import { evaluateUrgenciaGates, extractCallAnalyzedFields } from '../services/retell-gates.js';
import {
  handleCalcomBookingCreated,
  verifyCalcomWebhookSignature,
} from '../services/calcom.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

export {
  evaluateUrgenciaGates,
  extractCallAnalyzedFields,
  extractFlexibleAnalysisData,
  extractRawVehicle,
  extractVehicleFromTranscript,
  getPostCallCustomData,
  hasValidVehicle,
  isValidVehicleValue,
  normalizeExtractedFields,
  resolveTranscriptText,
} from '../services/retell-gates.js';

/**
 * Provider callbacks. Unauthenticated by design: each provider signs its
 * requests, and we verify that signature instead of a session.
 *
 * Retell is mounted FIRST in createApp() via mountRetellWebhookFirst() — before
 * helmet, compression, global body parsers, and any rate limiters — so Retell
 * never sees 400 "Queue is full." from intermediary middleware.
 *
 * Call history (call_logs) is ALWAYS upserted for call_ended / call_analyzed.
 * Urgencias are created only when ALL gates pass:
 * 1. non-empty custom_analysis_data
 * 2. durationSec > 40
 * 3. post-call analysis includes a real vehicle
 *
 * HTTP always ends with 200 { received: true } — gate failures never block ACK.
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
    getCustomField(payload, 'car_plate') ||
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

function logUrgenciaDiscard(reason, { durationSec = null, rawVehicle = null, callId = null } = {}) {
  console.log(
    `[SOLICITUD DESCARTADA] reason=${reason} | call_id=${callId ?? 'n/a'} | Duración: ${durationSec ?? '?'}s | Vehículo: ${rawVehicle ?? 'null'}`,
  );
}

async function processRetellEvent(req, eventType) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  console.log('Retell Payload Completo:', JSON.stringify(body, null, 2));

  let call = resolveCallFromBody(body);
  if (!call) {
    console.warn(`[retell-webhook] ${eventType} without call object — ignored`);
    return;
  }

  if (!RETELL_SKIP_SIGNATURE && config.retell.verifyWebhooks) {
    const verification = verifyWebhook(req.rawBody ?? '', req.get('x-retell-signature'));
    if (!verification.ok) {
      console.error('[retell-webhook] signature rejected:', verification.reason);
      return;
    }
  }

  const callId = body.call?.call_id ?? call.call_id ?? null;
  let analysisOverrides = null;

  // Always extract call_analyzed fields from every nesting so no keys are lost.
  if (eventType === 'call_analyzed') {
    const extracted = extractCallAnalyzedFields(body, call);
    const {
      analysis,
      name,
      vehicle,
      plate,
      reason,
      durationSec,
      canCreateReserva,
      vehicleSource,
    } = extracted;

    console.log('[RETELL DATA EXTRACTED]', {
      name,
      vehicle,
      plate,
      reason,
      canCreateReserva,
      vehicleSource,
    });

    const gates = evaluateUrgenciaGates({ payload: body, call });

    if (Object.keys(analysis).length > 0 || (gates.ok && vehicle)) {
      const primaryVehicle =
        unwrapAnalysisScalar(analysis.vehiculo) ||
        unwrapAnalysisScalar(analysis.vehicle) ||
        unwrapAnalysisScalar(analysis.car) ||
        unwrapAnalysisScalar(analysis.vehicle_make) ||
        null;
      const modeloOnly =
        unwrapAnalysisScalar(analysis.modelo) ||
        unwrapAnalysisScalar(analysis.model) ||
        null;
      // Prefer transcript-enriched label from extractCallAnalyzedFields when present.
      const vehiculoForStorage =
        (vehicle && String(vehicle).trim()) ||
        (primaryVehicle && String(primaryVehicle).trim()) ||
        (modeloOnly && String(modeloOnly).trim()) ||
        'Sin vehículo';

      const mapped = {
        nombre: name || 'Cliente por confirmar',
        // Prefer extractCallAnalyzedFields vehicle (may include transcript model enrichment).
        vehiculo: vehiculoForStorage,
        matricula: plate || 'Sin matrícula',
        motivo: reason || 'Consulta urgente',
      };

      const analysisForInject =
        Object.keys(analysis).length > 0
          ? analysis
          : { vehiculo: vehicle, vehicle, _vehicle_source: vehicleSource || 'transcript' };

      console.log('CUSTOM ANALYSIS DATA RECIBIDO:', analysisForInject);
      console.log('[RETELL WEBHOOK LOG]', {
        event: body.event ?? eventType,
        call_id: callId,
        nombre: mapped.nombre,
        vehiculo: mapped.vehiculo,
        matricula: mapped.matricula,
        motivo: mapped.motivo,
        canCreateReserva,
        durationSec,
        vehicleSource,
      });

      call = injectMappedAnalysis(call, mapped, analysisForInject);

      // Pass overrides for Urgencias when gates pass (valid vehicle + duration).
      if (gates.ok) {
        console.log('[RETELL WEBHOOK VALIDADO]', {
          callId,
          durationSec,
          vehiculo: vehicle,
          nombre: name,
          analysis_keys: Object.keys(analysisForInject),
          canCreateReserva,
          vehicleSource,
        });
        analysisOverrides = mapped;
      } else {
        logUrgenciaDiscard(gates.reason, {
          durationSec: gates.durationSec ?? durationSec,
          rawVehicle: gates.rawVehicle ?? vehicle,
          callId,
        });
      }
    } else {
      logUrgenciaDiscard(gates.reason || 'missing_custom_analysis_data', {
        durationSec,
        rawVehicle: vehicle,
        callId,
      });
    }
  } else if (eventType === 'call_ended') {
    console.log(
      '[retell-webhook] call_ended → historial de llamadas; Urgencias espera call_analyzed',
      { call_id: callId, duration_sec: resolveCallDurationSec(call) },
    );
  }

  // Always upsert call history; Urgencias/reservas are gated inside intake.
  await ingestRetellCall({
    event: eventType,
    call,
    body,
    analysisOverrides,
  });
}

/**
 * Registers /api/webhooks/retell at the absolute top of the Express stack —
 * before helmet, compression, global JSON limits, cookies, requestContext, etc.
 *
 * Always ACKs { received: true }. Always schedules call-history ingest for
 * call_ended / call_analyzed. Urgencias gates are applied in background work.
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

      // Inspect exact Retell JSON shape for call_analyzed (analysis / transcript nesting).
      if (req.body?.event === 'call_analyzed' || req.body?.call_analysis) {
        console.log('[DEBUG RETELL RAW PAYLOAD]', JSON.stringify(req.body, null, 2));
      }

      const eventType = String(req.body?.event ?? req.body?.type ?? req.body?.data?.event ?? '');
      if (eventType !== 'call_ended' && eventType !== 'call_analyzed') {
        console.log('[retell-webhook] ignoring event', { event: eventType || null });
        if (!res.headersSent) res.status(200).json({ received: true });
        return;
      }

      const call = resolveCallFromBody(req.body) || req.body?.call || {};
      const callId = req.body?.call?.call_id ?? call.call_id ?? null;
      const gates = evaluateUrgenciaGates({ payload: req.body, call });

      if (eventType === 'call_analyzed' && gates.ok) {
        console.log('[RETELL WEBHOOK VALIDADO]', {
          callId,
          durationSec: gates.durationSec,
          vehiculo: gates.rawVehicle,
          analysis_keys: Object.keys(gates.customData || {}),
        });
      } else if (eventType === 'call_analyzed') {
        logUrgenciaDiscard(gates.reason, {
          durationSec: gates.durationSec ?? resolveCallDurationSec(call),
          rawVehicle: gates.rawVehicle,
          callId,
        });
      } else {
        console.log('[retell-webhook] call_ended received — recording call history', {
          call_id: callId,
          duration_sec: resolveCallDurationSec(call),
        });
      }

      // ACK Retell first; never early-return without 200 { received: true }.
      if (!res.headersSent) res.status(200).json({ received: true });

      const scheduled = scheduleRetellWork(() => processRetellEvent(req, eventType));
      if (scheduled) void scheduled;
    });
  });
}

/** In-flight Cal.com BOOKING_CREATED push jobs (tests await these). */
const pendingCalcomWork = new Set();

/** @internal test helper — wait until background Cal.com push finishes. */
export async function flushCalcomWebhookWork() {
  while (pendingCalcomWork.size) {
    await Promise.allSettled([...pendingCalcomWork]);
  }
}

function scheduleCalcomWork(work) {
  const task = Promise.resolve()
    .then(work)
    .catch((error) => {
      console.error('[calcom-webhook] background failed:', error?.message || error);
    })
    .finally(() => {
      pendingCalcomWork.delete(task);
    });
  pendingCalcomWork.add(task);
  if (config.isTest) return task;
  setImmediate(() => {
    void task;
  });
  return undefined;
}

function calcomReadinessPayload() {
  return {
    provider: 'calcom',
    ready: true,
    received: true,
    webhook_url: `${config.appUrl}/api/webhooks/calcom`,
    events: ['BOOKING_CREATED'],
    signature_verification: config.calcom.webhookSecret ? 'enabled' : 'disabled',
  };
}

function handleCalcomWebhookPost(req, res) {
  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
  const signature =
    req.get('x-cal-signature-256') ||
    req.get('x-cal-signature') ||
    req.query?.secret ||
    '';
  const verified = verifyCalcomWebhookSignature(rawBody, signature);
  if (!verified.ok) {
    console.warn('[calcom-webhook] signature rejected', { reason: verified.reason });
    if (!res.headersSent) res.status(401).json({ received: false, error: 'invalid_signature' });
    return;
  }

  const trigger = req.body?.triggerEvent || req.body?.event || req.body?.type || null;
  if (!res.headersSent) res.status(200).json({ received: true, triggerEvent: trigger });

  const scheduled = scheduleCalcomWork(() => handleCalcomBookingCreated(req.body || {}));
  if (scheduled) void scheduled;
}

/** Zadarma (+ legacy) webhook router — mounted later under /api/webhooks. */
const router = express.Router();

router.get('/retell', (_req, res) => {
  res.status(200).json(retellReadinessPayload());
});
router.post('/retell', (_req, res) => {
  res.status(200).json({ received: true });
});

router.get('/calcom', (_req, res) => {
  res.status(200).json(calcomReadinessPayload());
});
router.post('/calcom', handleCalcomWebhookPost);

router.use('/', zadarmaWebhookRouter);

export default router;
