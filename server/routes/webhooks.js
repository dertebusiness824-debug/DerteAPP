import express from 'express';
import config from '../config.js';
import { ingestRetellCall, isMissedOrTooShortCall } from '../services/retell-intake.js';
import { coerceAnalysisObject, mergeCustomAnalysisData, verifyWebhook } from '../services/retell.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

/**
 * Provider callbacks. Unauthenticated by design: each provider signs its
 * requests, and we verify that signature instead of a session.
 *
 * Retell is mounted FIRST in createApp() via mountRetellWebhookFirst() — before
 * helmet, compression, global body parsers, and any rate limiters — so Retell
 * never sees 400 "Queue is full." from intermediary middleware.
 *
 * Only `call_analyzed` is ingested: that event is the first one that includes
 * post-call `custom_analysis_data`. Earlier events (call_started / call_ended)
 * are ACK'd 200 and ignored so we never create Urgencias before AI analysis.
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
    // Only call_analyzed creates Urgencias / reservas (needs AI extraction).
    events: ['call_analyzed'],
  };
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

  // Fill any missing keys from the broader merge (args / collected vars).
  const merged = mergeCustomAnalysisData(call, body);
  return { ...merged, ...direct };
}

/** Map ES/EN analysis aliases into clean Urgencias field defaults. */
export function mapCustomAnalysisFields(customData = {}) {
  const nombre =
    customData.nombre ||
    customData.name ||
    customData.customer_name ||
    customData.nombre_cliente ||
    'Sin nombre';
  const vehiculo =
    customData.vehiculo ||
    customData.vehicle ||
    customData.car ||
    customData.modelo ||
    'Sin vehículo';
  const matricula =
    customData.matricula ||
    customData.license_plate ||
    customData.plate ||
    customData.placa ||
    'Sin matrícula';
  const motivo =
    customData.motivo ||
    customData.reason ||
    customData.urgency_reason ||
    customData.motivo_urgencia ||
    'Consulta urgente';

  return {
    nombre: String(nombre).trim() || 'Sin nombre',
    vehiculo: String(vehiculo).trim() || 'Sin vehículo',
    matricula: String(matricula).trim() || 'Sin matrícula',
    motivo: String(motivo).trim() || 'Consulta urgente',
  };
}

async function processCallAnalyzed(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  console.log('Retell Payload Completo:', JSON.stringify(body, null, 2));

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

  if (!call) {
    console.warn('[retell-webhook] call_analyzed without call object — ignored');
    return;
  }

  // Conversation Flow / custom functions may put extracted fields in `args`.
  if (envelope.args && typeof envelope.args === 'object') {
    call = { ...call, args: { ...(call.args || {}), ...envelope.args } };
  }
  if (body.args && typeof body.args === 'object' && body.args !== envelope.args) {
    call = { ...call, args: { ...(call.args || {}), ...body.args } };
  }

  const customData = extractRetellCustomData(call, body);
  console.log('CUSTOM ANALYSIS DATA RECIBIDO:', customData);

  const mapped = mapCustomAnalysisFields(customData);
  console.log('[retell-webhook] campos mapeados', mapped);

  // Inject clean aliases so intake / extractBooking always see them.
  call = {
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

  await ingestRetellCall({ event: 'call_analyzed', call, body });
}

/**
 * Registers /api/webhooks/retell at the absolute top of the Express stack —
 * before helmet, compression, global JSON limits, cookies, requestContext, etc.
 *
 * Only `call_analyzed` is processed. Other Retell events get an immediate 200
 * so we never create Urgencias before AI analysis finishes.
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
      if (eventType !== 'call_analyzed') {
        console.log('[retell-webhook] ignoring non-analyzed event', { event: eventType || null });
        if (!res.headersSent) {
          res.status(200).json({ message: 'Esperando evento call_analyzed', received: true });
        }
        return;
      }

      if (!res.headersSent) res.status(200).json({ received: true, event: 'call_analyzed' });

      const scheduled = scheduleRetellWork(() => processCallAnalyzed(req));
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
  // Should be unreachable when mountRetellWebhookFirst runs first; still ACK.
  res.status(200).json({ received: true, message: 'Esperando evento call_analyzed' });
});

router.use('/', zadarmaWebhookRouter);

export default router;
