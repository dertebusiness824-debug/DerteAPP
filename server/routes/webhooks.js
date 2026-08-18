import express from 'express';
import config from '../config.js';
import { ingestRetellCall, isMissedOrTooShortCall } from '../services/retell-intake.js';
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
 * Event policy:
 * - call_ended → create a basic Urgencia stub (phone + timestamp) if missing
 * - call_analyzed → UPDATE the existing row with custom_analysis_data fields
 * - anything else → ACK 200 and ignore
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
    if (!(fieldName in object) && !(normalizeLooseKey(fieldName) in normalizeBagKeys(object))) {
      // Still try exact key first below.
    }
    if (fieldName in object) {
      const unwrapped = unwrapAnalysisScalar(object[fieldName]);
      if (unwrapped != null) return unwrapped;
    }
    // Case / accent insensitive match inside the bag.
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

function normalizeBagKeys(object) {
  const out = {};
  for (const [key, value] of Object.entries(object || {})) {
    out[normalizeLooseKey(key)] = value;
  }
  return out;
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

  console.log('CUSTOM ANALYSIS DATA RECIBIDO:', customData);
  console.log('[RETELL WEBHOOK LOG]', {
    event: body.event ?? eventType,
    call_id: body.call?.call_id ?? call.call_id ?? null,
    nombre: mapped.nombre,
    vehiculo: mapped.vehiculo,
    matricula: mapped.matricula,
    motivo: mapped.motivo,
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
 * Handles call_ended (stub) + call_analyzed (force UPDATE with analysis).
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

      if (!res.headersSent) res.status(200).json({ received: true, event: eventType });

      const scheduled = scheduleRetellWork(() => processRetellEvent(req, eventType));
      if (scheduled) void scheduled;
    });
  });
}

/** Zadarma (+ legacy) webhook router — mounted later under /api/webhooks. */
const router = express.Router();

// Retell is handled only by mountRetellWebhookFirst(app). Stub here so a
// mistaken second mount cannot re-introduce rate limits or 400s.
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
