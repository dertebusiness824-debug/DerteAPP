import express from 'express';
import config from '../config.js';
import { asyncHandler } from '../lib/errors.js';
import { ingestRetellCall } from '../services/retell-intake.js';
import { verifyWebhook } from '../services/retell.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

/**
 * Provider callbacks. Unauthenticated by design: each provider signs its
 * requests, and we verify that signature instead of a session.
 *
 * IMPORTANT: Retell webhooks must ACK with HTTP 200 immediately. Slow handlers
 * or rate limits cause Retell's outbound queue to fill ("Queue is full.") and
 * drop further deliveries. Never mount rateLimit / in-memory queues on these routes.
 */
const router = express.Router();

const IGNORED_EVENTS = new Set(['transcript_updated', 'transfer_started', 'transfer_cancelled', 'transfer_ended']);

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

  // Detach from the request lifecycle in production.
  setImmediate(() => {
    void task;
  });
  return undefined;
}

router.get('/retell', (_req, res) => {
  res.status(200).json({
    provider: 'retell',
    ready: true,
    received: true,
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
  // No rateLimit / queue middleware — Retell must never see 429/400 from us.
  asyncHandler(async (req, res) => {
    // Always ACK immediately so Retell's delivery queue never backs up.
    res.status(200).json({ received: true });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const envelope = body.data && typeof body.data === 'object' ? { ...body, ...body.data } : body;
    const event = String(envelope.event ?? envelope.type ?? '');
    const call =
      (envelope.call && typeof envelope.call === 'object' && envelope.call) ||
      (envelope.call_inbound && typeof envelope.call_inbound === 'object' && envelope.call_inbound) ||
      null;

    if (!event || IGNORED_EVENTS.has(event) || !call) return;

    if (!RETELL_SKIP_SIGNATURE && config.retell.verifyWebhooks) {
      const verification = verifyWebhook(req.rawBody ?? '', req.get('x-retell-signature'));
      if (!verification.ok) {
        console.error('[retell-webhook] signature rejected:', verification.reason);
        return;
      }
    }

    // Background: update call_logs (Completada) + insert urgencias when is_urgent.
    const scheduled = scheduleRetellWork(() => ingestRetellCall({ event, call }));
    if (scheduled) await scheduled;
  }),
);

// Zadarma PBX callbacks under /api/webhooks/* — also without rate limiting.
router.use('/', zadarmaWebhookRouter);

export default router;
