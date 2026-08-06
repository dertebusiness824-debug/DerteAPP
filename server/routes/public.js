import express from 'express';
import config from '../config.js';
import { queryOne } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import { channels, openStream } from '../lib/events.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { addDays, parseDateOnly, utcFromZoned, zonedDateString } from '../lib/time.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { isoDateSchema, optionalText, phoneSchema, text, timeSchema, validate, z } from '../middleware/validate.js';
import { recordSiteEvent } from '../services/analytics.js';
import { createAppointment } from '../services/appointments.js';
import { findThreadByToken, getShopContact, listMessages, markRead, postMessage, serializeMessage, serializeThread } from '../services/chat.js';
import { checkBookable, getAvailability, getOpenState, getWeeklyHours, listExceptions } from '../services/schedule.js';

const router = express.Router();

/**
 * These endpoints are called from the shops' Hostinger sites, so they are
 * cross-origin by nature. When a shop has declared its domains we honour that
 * allowlist; otherwise any origin may read (never with credentials).
 */
function applyPublicCors(req, res, shop = null) {
  const origin = req.get('origin');
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '86400');

  const allowlist = shop?.site_domains ?? [];
  if (allowlist.length === 0) {
    res.set('Access-Control-Allow-Origin', origin ?? '*');
    return true;
  }
  if (!origin) return true;

  let host;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const allowed = allowlist.some((domain) => {
    const clean = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    return host === clean || host.endsWith(`.${clean}`);
  });
  if (allowed) res.set('Access-Control-Allow-Origin', origin);
  return allowed;
}

router.options('/*', (req, res) => {
  applyPublicCors(req, res);
  res.sendStatus(204);
});

/** Resolves the tenant from the public key in the URL. */
const loadPublicShop = asyncHandler(async (req, res, next) => {
  const shop = await queryOne('SELECT * FROM shops WHERE public_key = $1', [req.params.publicKey]);
  if (!shop) return next(notFound('Unknown site key. Check the DerteApp snippet on your website.'));
  if (shop.status !== 'active') return next(forbidden('This shop is not accepting online bookings right now'));
  if (!applyPublicCors(req, res, shop)) {
    return next(forbidden('This domain is not allowed to use that DerteApp key', { code: 'origin_not_allowed' }));
  }
  req.shop = shop;
  return next();
});

// --- Site configuration ------------------------------------------------------

router.get(
  '/shops/:publicKey/config',
  loadPublicShop,
  asyncHandler(async (req, res) => {
    const [weekly, exceptions, openState] = await Promise.all([
      getWeeklyHours(req.shop.id),
      listExceptions(req.shop.id, {
        from: zonedDateString(new Date(), req.shop.timezone),
        to: addDays(zonedDateString(new Date(), req.shop.timezone), req.shop.booking_horizon_days),
      }),
      getOpenState(req.shop),
    ]);

    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      shop: {
        name: req.shop.name,
        timezone: req.shop.timezone,
        phone: req.shop.phone,
        phone_display: req.shop.phone ? formatPhone(req.shop.phone) : null,
        tel_link: telLink(req.shop.phone),
        whatsapp_link: whatsappLink(req.shop.whatsapp_phone ?? req.shop.phone),
        address: req.shop.address,
        city: req.shop.city,
        services: req.shop.services ?? [],
        slot_minutes: req.shop.slot_minutes,
        min_notice_minutes: req.shop.min_notice_minutes,
        booking_horizon_days: req.shop.booking_horizon_days,
      },
      open_now: openState.open_now,
      open_state_reason: openState.reason,
      today: openState.today,
      weekly_hours: weekly,
      closed_dates: exceptions.filter((row) => row.is_closed).map((row) => row.exception_date),
      exceptions,
    });
  }),
);

// --- Schedule checks for the booking form ------------------------------------

router.get(
  '/shops/:publicKey/availability',
  loadPublicShop,
  rateLimit({ name: 'public-availability', limit: 240, windowMs: 60_000 }),
  validate(
    z.object({
      date: isoDateSchema.optional(),
      from: isoDateSchema.optional(),
      days: z.coerce.number().int().min(1).max(62).optional(),
      duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { date, from, days, duration_minutes: duration } = req.validatedQuery;
    const availability = await getAvailability({
      shop: req.shop,
      from: date ?? from,
      days: date ? 1 : (days ?? 14),
      durationMinutes: duration,
    });

    await recordSiteEvent({
      shopId: req.shop.id,
      eventType: 'schedule_check',
      path: req.get('referer') ?? null,
      userAgent: req.get('user-agent'),
      sessionId: req.query.session_id ?? null,
      ipHash: req.clientIpHash,
      metadata: { from: availability.from, days: availability.days.length },
    });

    res.set('Cache-Control', 'no-store');
    res.json(availability);
  }),
);

/** Single-slot validation, used right before the Hostinger form submits. */
router.post(
  '/shops/:publicKey/check-slot',
  loadPublicShop,
  rateLimit({ name: 'public-check-slot', limit: 120, windowMs: 60_000 }),
  validate(
    z.object({
      date: isoDateSchema.optional(),
      time: timeSchema.optional(),
      scheduled_at: z.string().trim().optional(),
      duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const scheduledAt = resolveScheduledAt(req.body, req.shop);
    const check = await checkBookable({
      shop: req.shop,
      scheduledAt,
      durationMinutes: req.body.duration_minutes,
    });
    res.json({
      bookable: check.ok,
      reason: check.reason ?? null,
      message: check.ok ? 'That time works — the shop is open and has capacity.' : check.message,
      scheduled_at: scheduledAt.toISOString(),
      opening_hours: check.rule
        ? { open_time: check.rule.open_time ?? null, close_time: check.rule.close_time ?? null, break_start: check.rule.break_start ?? null, break_end: check.rule.break_end ?? null }
        : null,
    });
  }),
);

/** Accepts either an ISO instant or the shop-local `date` + `time` pair. */
function resolveScheduledAt(body, shop) {
  if (body.scheduled_at) {
    const parsed = new Date(body.scheduled_at);
    if (Number.isNaN(parsed.getTime())) throw badRequest('scheduled_at is not a valid date and time');
    return parsed;
  }
  const date = parseDateOnly(body.date);
  if (!date || !body.time) {
    throw badRequest('Provide either scheduled_at, or date (YYYY-MM-DD) and time (HH:MM)');
  }
  const [hour, minute] = String(body.time).split(':').map(Number);
  return utcFromZoned({ ...date, hour, minute }, shop.timezone);
}

// --- Booking submissions from Hostinger --------------------------------------

router.post(
  '/shops/:publicKey/appointments',
  loadPublicShop,
  rateLimit({
    name: 'public-booking',
    limit: 12,
    windowMs: 60 * 60_000,
    message: 'Too many booking attempts from this connection. Please call the shop instead.',
  }),
  validate(
    z.object({
      customer_name: text(120, { min: 2 }),
      customer_phone: phoneSchema,
      customer_email: z.string().trim().email('Enter a valid email address').max(180).nullish(),
      vehicle_make: optionalText(60),
      vehicle_model: optionalText(60),
      vehicle_year: z.coerce.number().int().min(1900).max(2100).nullish(),
      vehicle_plate: optionalText(20),
      service_type: optionalText(80),
      notes: optionalText(2000),
      date: isoDateSchema.optional(),
      time: timeSchema.optional(),
      scheduled_at: z.string().trim().optional(),
      duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
      source_url: optionalText(500),
      session_id: optionalText(64),
      // Hidden field: real customers never fill it in.
      trap: optionalText(200),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.body.trap) {
      // Pretend it worked so bots do not retry, but store nothing.
      return res.status(202).json({ received: true });
    }

    const scheduledAt = resolveScheduledAt(req.body, req.shop);
    const appointment = await createAppointment({
      shop: req.shop,
      input: { ...req.body, scheduled_at: scheduledAt, source_url: req.body.source_url ?? req.get('referer') },
      source: 'hostinger',
      enforceSchedule: true,
    });

    await recordSiteEvent({
      shopId: req.shop.id,
      eventType: 'form_submit',
      path: req.body.source_url ?? req.get('referer') ?? null,
      referrer: req.get('referer') ?? null,
      userAgent: req.get('user-agent'),
      sessionId: req.body.session_id ?? null,
      ipHash: req.clientIpHash,
      metadata: { appointment_id: appointment.id },
    });

    return res.status(201).json({
      booked: true,
      reference: appointment.reference,
      status: appointment.status,
      scheduled_at: appointment.scheduled_at,
      message: `Thanks ${appointment.customer_name}! Request ${appointment.reference} has been sent to ${req.shop.name}. You will get a confirmation shortly.`,
      shop: {
        name: req.shop.name,
        phone: req.shop.phone,
        tel_link: telLink(req.shop.phone),
        whatsapp_link: whatsappLink(req.shop.whatsapp_phone ?? req.shop.phone),
      },
    });
  }),
);

// --- Website analytics -------------------------------------------------------

router.post(
  '/shops/:publicKey/events',
  loadPublicShop,
  rateLimit({ name: 'public-events', limit: 300, windowMs: 60_000 }),
  validate(
    z.object({
      event_type: z.enum(['pageview', 'form_view', 'call_click', 'whatsapp_click', 'custom']),
      path: optionalText(500),
      referrer: optionalText(500),
      session_id: optionalText(64),
      metadata: z.record(z.any()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    await recordSiteEvent({
      shopId: req.shop.id,
      eventType: req.body.event_type,
      path: req.body.path,
      referrer: req.body.referrer ?? req.get('referer'),
      userAgent: req.get('user-agent'),
      sessionId: req.body.session_id,
      ipHash: req.clientIpHash,
      metadata: req.body.metadata ?? {},
    });
    res.status(202).json({ recorded: true });
  }),
);

// --- Customer chat (secure link, no account) ---------------------------------

const loadTokenThread = asyncHandler(async (req, _res, next) => {
  const thread = await findThreadByToken(req.params.token);
  if (!thread) return next(notFound('This chat link is no longer valid. Please contact the shop directly.'));
  req.thread = thread;
  return next();
});

router.get(
  '/chat/:token',
  loadTokenThread,
  asyncHandler(async (req, res) => {
    const [messages, contact, appointment] = await Promise.all([
      listMessages(req.thread.id),
      getShopContact(req.thread.shop_id),
      req.thread.appointment_id
        ? queryOne(
            `SELECT reference, scheduled_at, status, service_type, duration_minutes,
                    vehicle_make, vehicle_model, vehicle_plate
               FROM appointments WHERE id = $1`,
            [req.thread.appointment_id],
          )
        : null,
    ]);
    await markRead(req.thread.id, 'other');

    res.set('Cache-Control', 'no-store');
    res.json({
      thread: serializeThread(req.thread),
      // The shop owner's registered number, always shown at the top of the chat
      // so the customer can tap to call.
      contact,
      appointment,
      messages,
      app_name: config.appName,
    });
  }),
);

router.get(
  '/chat/:token/messages',
  loadTokenThread,
  validate(z.object({ after_id: z.coerce.number().int().min(0).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ messages: await listMessages(req.thread.id, { afterId: req.validatedQuery.after_id ?? null }) });
  }),
);

router.post(
  '/chat/:token/messages',
  loadTokenThread,
  rateLimit({ name: 'public-chat-post', limit: 60, windowMs: 5 * 60_000, message: 'Please slow down a little.' }),
  validate(z.object({ body: text(4000, { min: 1 }) })),
  asyncHandler(async (req, res) => {
    const message = await postMessage({
      thread: req.thread,
      senderType: 'customer',
      senderName: req.thread.customer_name ?? 'Customer',
      senderPhone: req.thread.customer_phone,
      body: req.body.body,
    });
    res.status(201).json({ message: serializeMessage(message) });
  }),
);

router.get('/chat/:token/stream', loadTokenThread, (req, res) => {
  openStream(req, res, [channels.thread(req.thread.id)]);
});

export default router;
