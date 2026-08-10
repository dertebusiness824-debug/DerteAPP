import express from 'express';
import config from '../config.js';
import { queryOne } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { ingestRetellCall } from '../services/retell-intake.js';
import { normalizeRetellWebhookBody, verifyWebhook } from '../services/retell.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

/**
 * Provider callbacks. Unauthenticated by design: each provider signs its
 * requests, and we verify that signature instead of a session.
 */
const router = express.Router();

// Events Retell delivers that carry no booking value for us. Acknowledged so
// Retell does not retry them.
const IGNORED_EVENTS = new Set(['transcript_updated', 'transfer_started', 'transfer_cancelled', 'transfer_ended']);

/** TEMP: signature check disabled so Retell's Test button does not get 401. */
const RETELL_SKIP_SIGNATURE = true;

/**
 * Pull name / phone / vehicle-reason / summary from the locations Retell
 * commonly uses, with safe display fallbacks.
 */
function extractRetellUrgenciaFields(body = {}, call = {}) {
  const analysis =
    (call?.custom_analysis_data && typeof call.custom_analysis_data === 'object'
      ? call.custom_analysis_data
      : null) ||
    (call?.call_analysis?.custom_analysis_data &&
    typeof call.call_analysis.custom_analysis_data === 'object'
      ? call.call_analysis.custom_analysis_data
      : null) ||
    {};
  const dyn =
    call?.retell_llm_dynamic_variables && typeof call.retell_llm_dynamic_variables === 'object'
      ? call.retell_llm_dynamic_variables
      : {};
  const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};

  const name =
    analysis.name ||
    call?.custom_analysis_data?.name ||
    dyn.customer_name ||
    call?.retell_llm_dynamic_variables?.customer_name ||
    args.name ||
    body?.name ||
    'Cliente sin nombre';

  const phone =
    call?.from_number ||
    call?.customer_number ||
    analysis.phone ||
    args.phone ||
    body?.phone ||
    'Sin teléfono';

  const vehicleOrReason =
    analysis.car_model ||
    call?.custom_analysis_data?.car_model ||
    call?.call_analysis?.custom_analysis_data?.vehicle ||
    analysis.vehicle ||
    analysis.reason ||
    args.car_model ||
    args.reason ||
    body?.car_model ||
    body?.reason ||
    'No especificado';

  const summary =
    call?.call_analysis?.call_summary ||
    call?.transcript ||
    analysis.summary ||
    args.summary ||
    body?.summary ||
    'Sin resumen';

  return { name, phone, vehicleOrReason, summary };
}

/** Stamp extracted fields onto the call bags so ingest/extractBooking always sees them. */
function applyExtractedFieldsToCall(call, extracted) {
  const bag = {
    ...(typeof call.custom_analysis_data === 'object' && call.custom_analysis_data
      ? call.custom_analysis_data
      : {}),
    name: extracted.name,
    phone: extracted.phone,
    car_model: extracted.vehicleOrReason,
    vehicle: extracted.vehicleOrReason,
    reason: extracted.vehicleOrReason,
    summary: extracted.summary,
  };

  return {
    ...call,
    from_number: call.from_number || (extracted.phone !== 'Sin teléfono' ? extracted.phone : call.from_number),
    customer_number: call.customer_number || extracted.phone,
    custom_analysis_data: bag,
    call_analysis: {
      ...(call.call_analysis || {}),
      call_summary: call.call_analysis?.call_summary || extracted.summary,
      custom_analysis_data: {
        ...(typeof call.call_analysis?.custom_analysis_data === 'object'
          ? call.call_analysis.custom_analysis_data
          : {}),
        ...bag,
      },
    },
    metadata: { ...(call.metadata || {}) },
  };
}

/** Lets you confirm from a browser that the URL you pasted into Retell is live. */
router.get('/retell', (_req, res) => {
  res.json({
    provider: 'retell',
    ready: true,
    signature_verification: RETELL_SKIP_SIGNATURE
      ? 'temporarily_disabled'
      : config.retell.verifyWebhooks
        ? (config.retell.configured ? 'enabled' : 'missing_api_key')
        : 'disabled',
    webhook_url: `${config.appUrl}/api/webhooks/retell`,
    events: ['call_started', 'call_ended', 'call_analyzed'],
    default_shop_configured: Boolean(config.retell.defaultShopId),
  });
});

router.post(
  '/retell',
  rateLimit({ name: 'retell-webhook', limit: 600, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    // TEMPORARY: skip X-Retell-Signature verification so the Retell dashboard
    // "Test" button can reach this endpoint without a 401. Re-enable before
    // production traffic: set RETELL_SKIP_SIGNATURE = false above.
    if (!RETELL_SKIP_SIGNATURE) {
      // `req.rawBody` is captured by the dedicated parser in app.js: the
      // signature covers the exact bytes Retell sent, not a re-serialization.
      const verification = verifyWebhook(req.rawBody ?? '', req.get('x-retell-signature'));
      if (!verification.ok) {
        return res.status(401).json({
          error: {
            message: 'Invalid Retell signature',
            code: verification.reason ?? 'bad_signature',
          },
        });
      }
    }

    console.log('PAYLOAD COMPLETO DE RETELL:', JSON.stringify(req.body, null, 2));

    // Merges call / custom_analysis_data / args / flat Test fields into one call bag.
    let { event, call } = normalizeRetellWebhookBody(req.body ?? {});

    if (!event) return res.status(400).json({ error: { message: 'Missing event', code: 'missing_event' } });
    if (IGNORED_EVENTS.has(event)) return res.status(202).json({ ok: true, ignored: true, reason: 'event_not_handled' });

    const extracted = extractRetellUrgenciaFields(req.body ?? {}, call);
    call = applyExtractedFieldsToCall(call, extracted);
    console.log('RETELL CAMPOS EXTRAÍDOS:', extracted);

    // Explicit shop_id from body/metadata wins; otherwise first shop in DB.
    const explicitShopId =
      req.body?.shop_id ||
      req.body?.metadata?.shop_id ||
      req.body?.metadata?.derte_shop_id ||
      call?.metadata?.shop_id ||
      call?.metadata?.derte_shop_id ||
      null;

    if (explicitShopId && /^[0-9a-f-]{36}$/i.test(String(explicitShopId))) {
      call.metadata = { ...call.metadata, shop_id: String(explicitShopId), derte_shop_id: String(explicitShopId) };
    } else {
      const firstShop = await queryOne(
        `SELECT id FROM shops WHERE status = 'active' ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1`,
      );
      if (firstShop?.id) {
        call.metadata = {
          ...call.metadata,
          shop_id: firstShop.id,
          derte_shop_id: firstShop.id,
        };
        console.log('RETELL shop_id por defecto (primer taller):', firstShop.id);
      } else {
        console.log('RETELL: no hay shops en la base de datos para asignar shop_id');
      }
    }

    // Extracts name/phone/car_brand/car_model/reason/summary from call bags and
    // upserts into urgencias for the matched shop (or first shop fallback).
    const result = await ingestRetellCall({ event, call });
    // Always 2xx once accepted: a retry would not change the outcome, and
    // Retell backs off after repeated failures.
    return res.status(result.created ? 201 : 200).json(result);
  }),
);

// Zadarma's PBX callbacks, also reachable at /api/telephony/webhooks/zadarma.
router.use('/', zadarmaWebhookRouter);

export default router;
