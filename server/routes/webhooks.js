import express from 'express';
import config from '../config.js';
import { query, queryOne } from '../db/index.js';
import { channels, hub } from '../lib/events.js';
import { asyncHandler } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { ingestRetellCall } from '../services/retell-intake.js';
import { normalizeRetellWebhookBody, verifyWebhook } from '../services/retell.js';
import { serializeUrgencia, upsertUrgencia } from '../services/urgencias.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

/**
 * Provider callbacks. Unauthenticated by design: each provider signs its
 * requests, and we verify that signature instead of a session.
 */
const router = express.Router();

/** TEMP: signature check disabled so Retell's Test button does not get 401. */
const RETELL_SKIP_SIGNATURE = true;

const DEFAULT_URGENCIA_TEXT = 'Llamada de prueba Retell';

function pickText(...candidates) {
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

/**
 * Resolve shop for Retell: explicit id from payload, else first active shop.
 */
async function resolveRetellShopId(body = {}, call = {}) {
  const explicit =
    body.shop_id ||
    body.metadata?.shop_id ||
    body.metadata?.derte_shop_id ||
    call?.metadata?.shop_id ||
    call?.metadata?.derte_shop_id ||
    null;
  if (explicit && /^[0-9a-f-]{36}$/i.test(String(explicit))) {
    const shop = await queryOne('SELECT * FROM shops WHERE id = $1', [String(explicit)]);
    if (shop) return shop;
  }
  return queryOne(
    `SELECT * FROM shops WHERE status = 'active' ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1`,
  );
}

/**
 * Always-on field extraction for Urgencias (works for analyzed / ended / Test).
 */
function extractUrgenciaInsertFields(body = {}, call = {}) {
  const analysisRoot = call?.call_analysis && typeof call.call_analysis === 'object' ? call.call_analysis : {};
  const analysisData =
    (call?.custom_analysis_data && typeof call.custom_analysis_data === 'object'
      ? call.custom_analysis_data
      : null) ||
    (analysisRoot.custom_analysis_data && typeof analysisRoot.custom_analysis_data === 'object'
      ? analysisRoot.custom_analysis_data
      : null) ||
    (body.custom_analysis_data && typeof body.custom_analysis_data === 'object'
      ? body.custom_analysis_data
      : null) ||
    {};
  const dyn =
    call?.retell_llm_dynamic_variables && typeof call.retell_llm_dynamic_variables === 'object'
      ? call.retell_llm_dynamic_variables
      : {};
  const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};

  const phone =
    pickText(
      call?.from_number,
      body?.call?.from_number,
      body?.from_number,
      call?.customer_number,
      analysisData.phone,
      args.phone,
      body?.phone,
    ) || 'Sin teléfono';

  const name =
    pickText(
      analysisData.name,
      dyn.customer_name,
      args.name,
      body?.name,
      call?.custom_analysis_data?.name,
    ) || 'Cliente sin nombre';

  const vehicleOrReason =
    pickText(
      analysisData.car_model,
      analysisData.vehicle,
      analysisData.car_brand,
      analysisData.reason,
      analysisRoot.custom_analysis_data?.vehicle,
      analysisRoot.custom_analysis_data?.car_model,
      args.car_model,
      args.reason,
      body?.car_model,
      body?.reason,
    ) || DEFAULT_URGENCIA_TEXT;

  const summary =
    pickText(
      analysisRoot.call_summary,
      analysisData.summary,
      call?.transcript,
      body?.transcript,
      args.summary,
      body?.summary,
    ) || DEFAULT_URGENCIA_TEXT;

  return { name, phone, vehicleOrReason, summary };
}

/**
 * Diagnostic: insert a fake urgencia so we can validate DB → UI without Retell.
 * Available as GET (browser) and POST (button / curl).
 */
async function createTestUrgenciaHandler(_req, res) {
  console.log('--- TEST URGENCIA DISPARADO ---');

  const shop = await resolveRetellShopId({}, {});
  if (!shop) {
    return res.status(500).json({
      success: false,
      message: 'No hay shops en la base de datos',
    });
  }

  const callId = `test-urgencia-${Date.now()}`;
  const nuevaUrgencia = await upsertUrgencia({
    shopId: shop.id,
    callId,
    customerName: 'Cliente Test',
    customerPhone: '600000000',
    vehicleMake: 'Audi',
    vehicleModel: 'A4',
    reason: 'Cliente Test - Audi A4 - 600000000',
    summary: 'Cliente Test - Audi A4 - 600000000',
    calledAt: new Date(),
    source: 'retell',
    raw: { source: 'webhooks.test-urgencia', fake: true },
  });

  console.log('✅ URGENCIA GUARDADA CON ÉXITO:', nuevaUrgencia);

  const serialized = serializeUrgencia(nuevaUrgencia, { timezone: shop.timezone });
  hub.publish(channels.shop(shop.id), {
    type: 'urgencia_created',
    shop_id: shop.id,
    urgencia: serialized,
  });

  return res.json({
    success: true,
    message: 'Urgencia de prueba creada',
    shop_id: shop.id,
    urgencia: serialized,
  });
}

router.get('/test-urgencia', asyncHandler(createTestUrgenciaHandler));
router.post('/test-urgencia', asyncHandler(createTestUrgenciaHandler));

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
    test_urgencia_url: `${config.appUrl}/api/webhooks/test-urgencia`,
    events: ['call_started', 'call_ended', 'call_analyzed', 'generic'],
    default_shop_configured: Boolean(config.retell.defaultShopId),
  });
});

// Log every Retell POST before rate-limit / signature so Render always shows traffic.
router.post('/retell', (req, _res, next) => {
  console.log('RETELL HEADERS:', req.headers);
  console.log('RETELL BODY:', req.body);
  next();
});

router.post(
  '/retell',
  rateLimit({ name: 'retell-webhook', limit: 600, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    if (!RETELL_SKIP_SIGNATURE) {
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

    // No rigid event filter: call_analyzed, call_ended, or generic Test payloads all proceed.
    let { event, call } = normalizeRetellWebhookBody(req.body ?? {});
    if (!event) event = 'call_analyzed';
    if (!call || typeof call !== 'object') {
      call = { call_id: `retell-inbound-${Date.now()}`, metadata: {} };
    }
    if (!call.call_id) {
      call.call_id = req.body?.call_id || req.body?.callId || `retell-inbound-${Date.now()}`;
    }

    const shop = await resolveRetellShopId(req.body ?? {}, call);
    if (!shop) {
      console.log('RETELL: no hay shops en la base de datos; no se puede guardar urgencia');
      return res.status(200).json({ ok: false, reason: 'no_shop' });
    }

    call.metadata = {
      ...(call.metadata || {}),
      shop_id: shop.id,
      derte_shop_id: shop.id,
    };

    const extracted = extractUrgenciaInsertFields(req.body ?? {}, call);
    console.log('RETELL CAMPOS EXTRAÍDOS:', { event, shop_id: shop.id, ...extracted });

    const existing = await queryOne('SELECT id FROM urgencias WHERE external_ref = $1', [
      `retell:${call.call_id}`,
    ]);

    const nuevaUrgencia = await upsertUrgencia({
      shopId: shop.id,
      callId: call.call_id,
      customerName: extracted.name,
      customerPhone: extracted.phone,
      vehicleModel: extracted.vehicleOrReason,
      reason: extracted.vehicleOrReason,
      summary: extracted.summary,
      transcript: typeof call.transcript === 'string' ? call.transcript : null,
      calledAt: call.start_timestamp
        ? new Date(call.start_timestamp)
        : call.end_timestamp
          ? new Date(call.end_timestamp)
          : new Date(),
      source: 'retell',
      raw: {
        event,
        source: 'webhooks.retell.direct',
        from_number: call.from_number || req.body?.from_number || null,
        call_analysis: call.call_analysis || null,
        custom_analysis_data: call.custom_analysis_data || null,
      },
    });

    console.log('✅ URGENCIA GUARDADA CON ÉXITO:', nuevaUrgencia);

    const serialized = serializeUrgencia(nuevaUrgencia, { timezone: shop.timezone });
    if (!existing) {
      await query(
        `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
         SELECT m.user_id, $1, 'urgencia', $2, $3, $4 FROM shop_members m WHERE m.shop_id = $1`,
        [
          shop.id,
          'Nueva urgencia',
          `${nuevaUrgencia.customer_name} · ${nuevaUrgencia.reason || nuevaUrgencia.summary || DEFAULT_URGENCIA_TEXT}`,
          '/urgencias',
        ],
      );
      hub.publish(channels.shop(shop.id), {
        type: 'urgencia_created',
        shop_id: shop.id,
        urgencia: serialized,
      });
    }

    // Keep appointment/intake side-effects for analyzed calls (skip duplicate urgencia write).
    let intake = null;
    try {
      intake = await ingestRetellCall({ event, call, skipUrgencia: true });
    } catch (error) {
      console.log('RETELL ingest (non-fatal):', error?.message || error);
    }

    return res.status(existing ? 200 : 201).json({
      ok: true,
      created: !existing,
      updated: Boolean(existing),
      shop_id: shop.id,
      matched_by: 'webhook_direct',
      urgencia: serialized,
      intake,
    });
  }),
);

// Zadarma's PBX callbacks, also reachable at /api/telephony/webhooks/zadarma.
router.use('/', zadarmaWebhookRouter);

export default router;
