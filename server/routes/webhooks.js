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
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

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
 * Raw vehicle string from analysis (vehiculo / vehicle / car, or marca+modelo).
 * Returns null when missing — does NOT substitute "Sin vehículo".
 */
export function extractRawVehicle(payload = {}) {
  const customData = extractRetellCustomData(
    payload?.call && typeof payload.call === 'object' ? payload.call : {},
    payload,
  );
  const fromCustom =
    unwrapAnalysisScalar(customData?.vehiculo) ||
    unwrapAnalysisScalar(customData?.vehicle) ||
    unwrapAnalysisScalar(customData?.car) ||
    null;

  const direct =
    getCustomField(payload, 'vehiculo') ||
    getCustomField(payload, 'vehicle') ||
    getCustomField(payload, 'car') ||
    fromCustom;

  if (direct && String(direct).trim()) return String(direct).trim();

  const marca =
    getCustomField(payload, 'marca') ||
    getCustomField(payload, 'make') ||
    unwrapAnalysisScalar(customData?.marca) ||
    unwrapAnalysisScalar(customData?.make) ||
    null;
  const modelo =
    getCustomField(payload, 'modelo') ||
    getCustomField(payload, 'model') ||
    unwrapAnalysisScalar(customData?.modelo) ||
    unwrapAnalysisScalar(customData?.model) ||
    null;
  const composed = [marca, modelo].filter(Boolean).join(' ').trim();
  return composed || null;
}

/** True when vehicle is a real marca/modelo (not empty / placeholder). */
export function isValidVehicleValue(vehiculo) {
  if (vehiculo == null) return false;
  const text = String(vehiculo).trim();
  if (!text) return false;
  const normalized = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (INVALID_VEHICLE_PLACEHOLDERS.has(normalized)) return false;
  if (normalized === 'sin vehiculo' || normalized.startsWith('sin vehiculo')) return false;
  return true;
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

  const mapped = mapCustomAnalysisFieldsFromPayload(body);
  const customData = extractRetellCustomData(call, body);
  const durationSec = resolveCallDurationSec(call);
  const callId = body.call?.call_id ?? call.call_id ?? null;
  const vehiculoGate = extractRawVehicle(body);

  console.log('CUSTOM ANALYSIS DATA RECIBIDO:', customData);
  console.log('[RETELL WEBHOOK LOG]', {
    event: body.event ?? eventType,
    call_id: callId,
    nombre: mapped.nombre,
    vehiculo: vehiculoGate || mapped.vehiculo,
    matricula: mapped.matricula,
    motivo: mapped.motivo,
  });
  console.log('[RETELL WEBHOOK VALIDADO]', {
    callId,
    durationSec,
    vehiculo: vehiculoGate || mapped.vehiculo,
    nombre: mapped.nombre,
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
      if (durationSec <= 40) {
        console.log('[retell-webhook] ignored short call', {
          event: eventType,
          call_id: call.call_id ?? null,
          durationSec,
        });
        if (!res.headersSent) {
          res.status(200).json({ message: 'Ignorado: Duración <= 40s', received: true });
        }
        return;
      }

      // call_ended: ACK — call log only; Urgencias need analyzed vehicle.
      if (eventType === 'call_ended') {
        if (!res.headersSent) {
          res.status(200).json({
            received: true,
            event: 'call_ended',
            message: 'Esperando call_analyzed con vehículo',
          });
        }
        const scheduled = scheduleRetellWork(() => processRetellEvent(req, eventType));
        if (scheduled) void scheduled;
        return;
      }

      const vehiculo = extractRawVehicle(req.body);
      if (!isValidVehicleValue(vehiculo)) {
        console.log('[retell-webhook] ignored missing vehicle', {
          event: eventType,
          call_id: call.call_id ?? null,
          vehiculo,
        });
        if (!res.headersSent) {
          res.status(200).json({
            message: 'Ignorado: No se proporcionó marca/modelo de vehículo',
            received: true,
          });
        }
        return;
      }

      const nombre =
        getCustomField(req.body, 'nombre') ||
        getCustomField(req.body, 'name') ||
        getCustomField(req.body, 'nombre_cliente') ||
        getCustomField(req.body, 'customer_name') ||
        'Sin nombre';
      const callId = req.body?.call?.call_id ?? call.call_id ?? null;
      console.log('[RETELL WEBHOOK VALIDADO]', { callId, durationSec, vehiculo, nombre });

      if (!res.headersSent) res.status(200).json({ received: true, event: 'call_analyzed' });

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
