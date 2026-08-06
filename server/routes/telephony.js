import express from 'express';
import config from '../config.js';
import { queryOne } from '../db/index.js';
import { asyncHandler, badRequest, forbidden } from '../lib/errors.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { attachUser, requireAuth, requireShopAccess, requireSuperAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { optionalText, phoneSchema, validate, z } from '../middleware/validate.js';
import { recordAudit } from '../services/appointments.js';
import { callStats, ingestWebhook, listCalls, placeCall } from '../services/telephony.js';
import zadarma from '../services/zadarma.js';

/**
 * Public webhook router — mounted before the auth middleware because Zadarma
 * authenticates with an HMAC `Signature` header, not a session.
 */
export const webhookRouter = express.Router();

const echo = (req, res, next) => {
  // Zadarma verifies a new webhook URL by calling it with ?zd_echo=<random>.
  const value = req.query.zd_echo ?? req.body?.zd_echo;
  if (value === undefined) return next();
  res.type('text/plain').send(String(value));
  return undefined;
};

webhookRouter.get('/zadarma', echo, (_req, res) => res.json({ ok: true }));

webhookRouter.post(
  '/zadarma',
  echo,
  rateLimit({ name: 'zadarma-webhook', limit: 600, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const payload = { ...(req.body ?? {}) };
    if (!payload.event) throw badRequest('Missing event');

    if (!zadarma.verifyWebhook(payload, req.get('signature'))) {
      return res.status(401).json({ error: { message: 'Invalid signature', code: 'bad_signature' } });
    }

    const result = await ingestWebhook(payload);
    return res.json({ ok: true, event: result.event ?? payload.event, ignored: result.ignored ?? false });
  }),
);

// --- Authenticated telephony API --------------------------------------------

const router = express.Router();
router.use(attachUser, requireAuth);

router.get('/status', (req, res) => {
  res.json({
    provider: 'zadarma',
    configured: zadarma.isConfigured(),
    webhook_url: `${config.appUrl}/api/telephony/webhooks/zadarma`,
    default_sip: config.zadarma.defaultSip || null,
    // Owners get device-native fallbacks even when the PBX is not wired up yet.
    fallbacks: ['tel', 'whatsapp'],
  });
});

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
  asyncHandler(async (req, res) => {
    const { phone, message } = req.validatedQuery;
    res.json({
      phone,
      phone_display: formatPhone(phone),
      tel_link: telLink(phone),
      whatsapp_link: whatsappLink(phone, message ?? undefined),
      zadarma_available: zadarma.isConfigured(),
    });
  }),
);

const callFilterSchema = z.object({
  shop_id: z.string().uuid().optional(),
  direction: z.enum(['in', 'out', 'internal']).optional(),
  status: z.string().trim().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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
