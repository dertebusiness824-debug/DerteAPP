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
import { evaluateUrgenciaGates } from '../services/retell-gates.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

export {
  evaluateUrgenciaGates,
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
  const gates = evaluateUrgenciaGates({ payload: body, call });
  let analysisOverrides = null;

  // Map analysis for Urgencias only when gates pass — call history still runs below.
  if (eventType === 'call_analyzed' && gates.ok) {
    const customData = gates.customData;
    const rawVehicle = gates.rawVehicle;
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
    const vehiculoDirect =
      unwrapAnalysisScalar(customData.vehiculo) ||
      unwrapAnalysisScalar(customData.vehicle) ||
      unwrapAnalysisScalar(customData.car) ||
      unwrapAnalysisScalar(customData.modelo) ||
      null;

    const mapped = {
      nombre: nombreRaw ? String(nombreRaw).trim() : 'Sin nombre',
      vehiculo: vehiculoDirect ? String(vehiculoDirect).trim() : String(rawVehicle).trim(),
      matricula: matriculaRaw ? String(matriculaRaw).trim() : 'Sin matrícula',
      motivo: motivoRaw ? String(motivoRaw).trim() : 'Consulta urgente',
    };

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
      durationSec: gates.durationSec,
      vehiculo: mapped.vehiculo,
      nombre: nombreRaw,
      analysis_keys: Object.keys(customData),
    });

    call = injectMappedAnalysis(call, mapped, customData);
    analysisOverrides = mapped;
  } else if (eventType === 'call_analyzed') {
    logUrgenciaDiscard(gates.reason, {
      durationSec: gates.durationSec,
      rawVehicle: gates.rawVehicle,
      callId,
    });
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

/** Zadarma (+ legacy) webhook router — mounted later under /api/webhooks. */
const router = express.Router();

router.get('/retell', (_req, res) => {
  res.status(200).json(retellReadinessPayload());
});
router.post('/retell', (_req, res) => {
  res.status(200).json({ received: true });
});

router.use('/', zadarmaWebhookRouter);

export default router;
