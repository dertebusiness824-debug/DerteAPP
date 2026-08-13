import express from 'express';
import config from '../config.js';
import { ingestRetellCall } from '../services/retell-intake.js';
import { verifyWebhook } from '../services/retell.js';
import { webhookRouter as zadarmaWebhookRouter } from './telephony.js';

/**
 * Provider callbacks. Unauthenticated by design: each provider signs its
 * requests, and we verify that signature instead of a session.
 *
 * Retell is mounted FIRST in createApp() via mountRetellWebhookFirst() — before
 * helmet, compression, global body parsers, and any rate limiters — so Retell
 * never sees 400 "Queue is full." from intermediary middleware.
 */

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
    events: ['call_started', 'call_ended', 'call_analyzed'],
  };
}

async function processRetellPayload(req) {
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

  // Background: call_logs Completada (from_number / user_number) + urgencias if is_urgent.
  await ingestRetellCall({ event, call });
}

function ackRetell(res) {
  if (!res.headersSent) res.status(200).json({ received: true });
}

/**
 * Registers /api/webhooks/retell at the absolute top of the Express stack —
 * before helmet, compression, global JSON limits, cookies, requestContext, etc.
 *
 * No rateLimit / bull / p-queue / express-queue — Node ACKs 200 and ingests
 * in the background so Retell never backs up with "Queue is full."
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

  // Parse body, then ALWAYS ACK 200 — even if JSON is invalid — so Retell
  // never sees 400 from body-parser and fills its outbound delivery queue.
  app.post('/api/webhooks/retell', (req, res) => {
    retellJson(req, res, (parseErr) => {
      ackRetell(res);
      if (parseErr) {
        console.error('[retell-webhook] body parse failed:', parseErr?.message || parseErr);
        return;
      }
      const scheduled = scheduleRetellWork(() => processRetellPayload(req));
      // In tests, await ingest so flushRetellWebhookWork / assertions stay deterministic.
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
  res.status(200).json({ received: true });
});

router.use('/', zadarmaWebhookRouter);

export default router;
