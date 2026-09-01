import express from 'express';
import config from '../config.js';
import { queryOne } from '../db/index.js';
import { asyncHandler, badRequest, forbidden } from '../lib/errors.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { attachUser, requireAuth, requireShopAccess, requireSuperAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { optionalText, phoneSchema, validate, z } from '../middleware/validate.js';
import { listAccessibleShops } from '../services/auth.js';
import { recordAudit } from '../services/appointments.js';
import { callStats, ingestWebhook, listCalls, normalizeZadarmaWebhookPayload, placeCall } from '../services/telephony.js';
import zadarma from '../services/zadarma.js';

/**
 * Public webhook router — mounted before the auth middleware because Zadarma
 * authenticates with an HMAC `Signature` header, not a session.
 *
 * Mounted at:
 * - /api/telephony/webhooks
 * - /api/webhooks (via webhooks.js)
 */
export const webhookRouter = express.Router();

/**
 * Zadarma verifies a new webhook URL with GET/POST ?zd_echo=<token>.
 * The response body must be exactly that token (no JSON wrapper).
 */
function replyZdEcho(req, res) {
  if (req.query.zd_echo) return res.send(req.query.zd_echo);
  if (req.body?.zd_echo) return res.send(req.body.zd_echo);
  return null;
}

webhookRouter.get('/zadarma', (req, res) => {
  if (req.query.zd_echo) return res.send(req.query.zd_echo);
  return res.json({ ok: true, provider: 'zadarma' });
});

webhookRouter.post(
  '/zadarma',
  // No rateLimit on provider webhooks — delivery queues must not see 429/400.
  asyncHandler(async (req, res) => {
    // Handshake can also arrive as POST (query or body).
    if (replyZdEcho(req, res)) return;

    // Accept JSON, urlencoded form body, and query-string fields.
    const payload = normalizeZadarmaWebhookPayload(req);
    if (!payload.event) {
      // ACK anyway — Zadarma retries on non-2xx and may report queue pressure.
      return res.status(200).json({ ok: true, received: true, ignored: true, reason: 'missing_event' });
    }

    if (!zadarma.verifyWebhook(payload, req.get('signature'))) {
      return res.status(401).json({ error: { message: 'Invalid signature', code: 'bad_signature' } });
    }

    const result = await ingestWebhook(payload);
    return res.status(200).json({
      ok: true,
      received: true,
      event: result.event ?? payload.event,
      ignored: result.ignored ?? false,
    });
  }),
);

/** True when this shop has enough Zadarma routing data to treat as connected. */
export function isShopZadarmaLinked(shop) {
  if (!shop || typeof shop !== 'object') return false;
  const sip = String(shop.zadarma_sip ?? '').trim();
  const did = String(shop.zadarma_did ?? shop.did_zadarma ?? '').trim();
  const hasKey = Boolean(shop.zadarma_api_key);
  // Connected if SIP, DID, or per-shop API key is present.
  return Boolean(sip || did || hasKey);
}

// --- Authenticated telephony API --------------------------------------------

const router = express.Router();
router.use(attachUser, requireAuth);

router.get(
  '/status',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    let shop = null;
    const requestedId = req.validatedQuery.shop_id;

    if (requestedId) {
      shop = await queryOne('SELECT * FROM shops WHERE id = $1', [requestedId]);
      if (!shop) throw badRequest('Taller no encontrado');
      if (req.user.role !== 'super_admin') {
        const membership = await queryOne(
          'SELECT role FROM shop_members WHERE shop_id = $1 AND user_id = $2',
          [shop.id, req.user.id],
        );
        if (!membership) throw forbidden('No tienes acceso a este taller', { code: 'shop_forbidden' });
      }
    } else if (req.user.role !== 'super_admin') {
      const shops = await listAccessibleShops(req.user);
      if (shops[0]?.id) {
        shop = await queryOne('SELECT * FROM shops WHERE id = $1', [shops[0].id]);
      }
    }

    const shopLinked = isShopZadarmaLinked(shop);
    const platformConfigured = zadarma.isConfigured();
    // Prefer per-shop link; fall back to platform env only when no shop context.
    const configured = shop ? shopLinked : platformConfigured;

    res.json({
      provider: 'zadarma',
      configured,
      shop_linked: shopLinked,
      platform_configured: platformConfigured,
      shop_id: shop?.id ?? null,
      zadarma_sip: shop?.zadarma_sip ?? null,
      zadarma_did: shop?.zadarma_did ?? null,
      did_zadarma: shop?.zadarma_did ?? null,
      zadarma_api_key_set: Boolean(shop?.zadarma_api_key),
      zadarma_api_secret_set: Boolean(shop?.zadarma_api_secret),
      webhook_url: `${config.appUrl}/api/telephony/webhooks/zadarma`,
      default_sip: config.zadarma.defaultSip || null,
      fallbacks: ['tel', 'whatsapp'],
    });
  }),
);

router.get(
  '/balance',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await zadarma.getBalance());
  }),
);

router.get(
  '/sip',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const [sip, internals] = await Promise.all([zadarma.getSipList(), zadarma.getPbxInternals()]);
    res.json({ sip, internals });
  }),
);

/** One-tap call: Zadarma rings the owner, then bridges them to the customer. */
router.post(
  '/call',
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      to: phoneSchema,
      appointment_id: z.string().uuid().nullish(),
    }),
  ),
  requireShopAccess,
  rateLimit({ name: 'place-call', limit: 40, windowMs: 15 * 60_000, keyFn: (req) => req.user.id }),
  asyncHandler(async (req, res) => {
    const result = await placeCall({
      shop: req.shop,
      user: req.user,
      to: req.body.to,
      appointmentId: req.body.appointment_id ?? null,
    });
    await recordAudit({
      actorUserId: req.user.id,
      shopId: req.shop.id,
      action: 'telephony.call',
      entityType: 'call_log',
      entityId: result.call.id,
      ip: req.clientIp,
    });
    res.status(201).json(result);
  }),
);

/**
 * Device-native contact links. The PWA falls back to these when Zadarma is not
 * configured, so the one-tap buttons always work on a phone.
 */
router.get(
  '/links',
  validate(z.object({ phone: phoneSchema, message: optionalText(300) }), 'query'),
  (req, res) => {
    const { phone, message } = req.validatedQuery;
    res.json({
      phone,
      phone_display: formatPhone(phone),
      tel_link: telLink(phone),
      whatsapp_link: whatsappLink(phone, message ?? undefined),
      zadarma_available: zadarma.isConfigured(),
    });
  },
);

const callFilterSchema = z.object({
  shop_id: z.string().uuid().optional(),
  direction: z.enum(['in', 'out', 'internal']).optional(),
  status: z.string().trim().max(20).optional(),
  // Cap the first dump; the PWA asks for 100. Admin may still raise toward 500.
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Platform-wide call log across every tenant. */
router.get(
  '/calls/all',
  requireSuperAdmin,
  validate(callFilterSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ scope: 'global', calls: await listCalls({ ...req.validatedQuery, shopId: null }) });
  }),
);

router.get(
  '/calls',
  validate(callFilterSchema, 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    res.json({
      scope: 'shop',
      shop_id: req.shop.id,
      calls: await listCalls({ ...req.validatedQuery, shopId: req.shop.id }),
    });
  }),
);

router.get(
  '/stats',
  validate(z.object({ shop_id: z.string().uuid().optional(), days: z.coerce.number().int().min(1).max(365).default(30) }), 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    res.json(await callStats({ shopId: req.shop.id, days: req.validatedQuery.days }));
  }),
);

router.get(
  '/calls/:callId/recording',
  asyncHandler(async (req, res, next) => {
    const call = await queryOne('SELECT * FROM call_logs WHERE id = $1', [req.params.callId]);
    if (!call) return next(badRequest('Unknown call'));
    if (req.user.role !== 'super_admin') {
      const membership = await queryOne('SELECT 1 FROM shop_members WHERE shop_id = $1 AND user_id = $2', [
        call.shop_id,
        req.user.id,
      ]);
      if (!membership) return next(forbidden('You do not have access to this call'));
    }
    const recordingId = String(call.recording_url ?? '').replace(/^zadarma:/, '');
    if (!recordingId) return next(badRequest('No recording is available for this call'));

    const link = await zadarma.getRecordingLink({ callId: recordingId, pbxCallId: call.pbx_call_id });
    return res.json(link);
  }),
);

export default router;
