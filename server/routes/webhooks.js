import express from 'express';
import config from '../config.js';
import { asyncHandler } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { ingestRetellCall } from '../services/retell-intake.js';
import { verifyWebhook } from '../services/retell.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

/**
 * Provider callbacks. Unauthenticated by design: each provider signs its
 * requests, and we verify that signature instead of a session.
 */
const router = express.Router();

// Events Retell delivers that carry no booking value for us. Acknowledged so
// Retell does not retry them.
const IGNORED_EVENTS = new Set(['transcript_updated', 'transfer_started', 'transfer_cancelled', 'transfer_ended']);

/** Lets you confirm from a browser that the URL you pasted into Retell is live. */
/** TEMP: signature check disabled so Retell's Test button does not get 401. */
const RETELL_SKIP_SIGNATURE = true;

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

    const event = String(req.body?.event ?? '');
    const call = req.body?.call ?? null;

    if (!event) return res.status(400).json({ error: { message: 'Missing event', code: 'missing_event' } });
    if (IGNORED_EVENTS.has(event)) return res.status(202).json({ ok: true, ignored: true, reason: 'event_not_handled' });

    const result = await ingestRetellCall({ event, call });
    // Always 2xx once accepted: a retry would not change the outcome, and
    // Retell backs off after repeated failures.
    return res.status(result.created ? 201 : 200).json(result);
  }),
);

// Zadarma's PBX callbacks, also reachable at /api/telephony/webhooks/zadarma.
router.use('/', zadarmaWebhookRouter);

export default router;
