import express from 'express';
import { queryOne } from '../db/index.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { addDays, parseDateOnly, utcFromZoned, zonedDateString } from '../lib/time.js';
import { attachUser, requireAuth, requireShopAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { booleanish, datetimeSchema, isoDateSchema, optionalText, phoneSchema, text, validate, z } from '../middleware/validate.js';
import { autoCompleteShopAppointments } from '../services/auto-complete.js';
import {
  APPOINTMENT_STATUSES,
  createAppointment,
  enrichAppointmentFromNotes,
  forceConfirmLegacyAppointments,
  getAppointment,
  listAppointments,
  serializeAppointment,
  updateAppointment,
  updateStatus,
} from '../services/appointments.js';

/** Dashboard list statuses — never pending/accepted. */
const DASHBOARD_STATUSES = ['confirmed', 'completed', 'in_progress'];

const router = express.Router();
router.use(attachUser);

/**
 * Auth-bypass board for the owner PWA.
 * Uses the shop public_key + direct Postgres (no Supabase RLS / user JWT).
 * Intended as a fallback when the session token is missing or stale.
 */
router.get(
  '/board',
  rateLimit({
    name: 'appointments-board',
    limit: 120,
    windowMs: 60_000,
    message: 'Demasiadas consultas. Espera un momento.',
  }),
  validate(
    z.object({
      public_key: z.string().trim().min(8).max(120),
      date: isoDateSchema.optional(),
      from: isoDateSchema.optional(),
      to: isoDateSchema.optional(),
      status: z.string().trim().max(120).optional(),
      search: z.string().trim().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const shop = await queryOne(
      `SELECT id, name, timezone, status, public_key FROM shops WHERE public_key = $1`,
      [req.validatedQuery.public_key],
    );
    if (!shop || shop.status !== 'active') {
      // Soft empty — never force the PWA into a login wall.
      return res.json({ appointments: [], count: 0, fallback: true });
    }

    await forceConfirmLegacyAppointments().catch(() => null);
    await autoCompleteShopAppointments(shop).catch(() => null);

    const filters = req.validatedQuery;
    const range = resolveRange(
      {
        date: filters.date,
        from: filters.from,
        to: filters.to,
      },
      shop.timezone || 'Europe/Madrid',
    );

    let status = DASHBOARD_STATUSES;
    if (filters.status) {
      status = filters.status
        .split(',')
        .map((part) => part.trim())
        .filter((part) => APPOINTMENT_STATUSES.includes(part));
      if (!status.length) status = DASHBOARD_STATUSES;
    } else if (!filters.date && !filters.from) {
      status = DASHBOARD_STATUSES;
    }

    const rows = await listAppointments({
      shopId: shop.id,
      status,
      from: range.from,
      to: range.to,
      search: filters.search ?? null,
      limit: filters.limit,
      offset: 0,
    });

    res.json({
      shop: { id: shop.id, name: shop.name, timezone: shop.timezone },
      date: filters.date ?? null,
      count: rows.length,
      fallback: true,
      appointments: rows.map((row) => serializeAppointment(row, { timezone: shop.timezone })),
    });
  }),
);

router.use(requireAuth);

const statusFilterSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.includes(',')) {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return value;
}, z.union([z.enum(APPOINTMENT_STATUSES), z.array(z.enum(APPOINTMENT_STATUSES))]).optional());

const listQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
  status: statusFilterSchema,
  date: isoDateSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Turns `date`/`from`/`to` calendar filters into absolute UTC boundaries. */
function resolveRange(filters, timezone) {
  const boundary = (dateString) =>
    utcFromZoned({ ...parseDateOnly(dateString), hour: 0, minute: 0 }, timezone).toISOString();

  if (filters.date) return { from: boundary(filters.date), to: boundary(addDays(filters.date, 1)) };
  return {
    from: filters.from ? boundary(filters.from) : null,
    to: filters.to ? boundary(addDays(filters.to, 1)) : null,
  };
}

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    await forceConfirmLegacyAppointments().catch(() => null);
    // Refresh statuses before listing so the panel shows Completada near closing.
    await autoCompleteShopAppointments(req.shop).catch((error) => {
      console.warn('[appointments] auto-complete skipped', error.message);
    });

    const filters = req.validatedQuery;
    const range = resolveRange(filters, req.shop.timezone);
    // Day views (Dashboard / Hoy): confirmed / completed / in_progress only.
    const status = filters.status ?? (filters.date ? DASHBOARD_STATUSES : null);
    const rows = await listAppointments({
      shopId: req.shop.id,
      status,
      from: range.from,
      to: range.to,
      search: filters.search ?? null,
      limit: filters.limit,
      offset: filters.offset,
    });

    res.json({
      shop: { id: req.shop.id, name: req.shop.name, timezone: req.shop.timezone },
      date: filters.date ?? null,
      count: rows.length,
      appointments: rows.map((row) => serializeAppointment(row, { timezone: req.shop.timezone })),
    });
  }),
);

router.get(
  '/today',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    await forceConfirmLegacyAppointments().catch(() => null);
    await autoCompleteShopAppointments(req.shop).catch((error) => {
      console.warn('[appointments] auto-complete skipped', error.message);
    });

    const today = zonedDateString(new Date(), req.shop.timezone);
    const range = resolveRange({ date: today }, req.shop.timezone);
    const rows = await listAppointments({
      shopId: req.shop.id,
      from: range.from,
      to: range.to,
      status: DASHBOARD_STATUSES,
      limit: 100,
    });
    res.json({
      date: today,
      timezone: req.shop.timezone,
      appointments: rows.map((row) => serializeAppointment(row, { timezone: req.shop.timezone })),
    });
  }),
);

router.post(
  '/',
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      customer_name: text(120, { min: 2 }),
      customer_phone: phoneSchema,
      customer_email: z.string().trim().email().max(180).nullish(),
      vehicle_make: optionalText(60),
      vehicle_model: optionalText(60),
      vehicle_year: z.coerce.number().int().min(1900).max(2100).nullish(),
      vehicle_plate: optionalText(20),
      service_type: optionalText(80),
      notes: optionalText(2000),
      scheduled_at: datetimeSchema,
      duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
      price_estimate: z.coerce.number().min(0).max(1_000_000).nullish(),
      status: z.enum(['confirmed', 'pending', 'accepted']).default('confirmed'),
      enforce_schedule: booleanish(false),
    }),
  ),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const appointment = await createAppointment({
      shop: req.shop,
      input: { ...req.body, status: 'confirmed' },
      source: 'dashboard',
      enforceSchedule: req.body.enforce_schedule,
      actorUserId: req.user.id,
    });

    const fresh = await getAppointment(req.shop.id, appointment.id);
    res.status(201).json({
      appointment: serializeAppointment(fresh, { timezone: req.shop.timezone }),
    });
  }),
);

router.get(
  '/:id',
  validate(z.object({ shop_id: z.string().uuid().optional() }), 'query'),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    await autoCompleteShopAppointments(req.shop).catch((error) => {
      console.warn('[appointments] auto-complete skipped', error.message);
    });

    let appointment = await getAppointment(req.shop.id, req.params.id);
    if (!appointment) throw notFound('Appointment not found');
    // Backfill email / vehicle / plate from customer notes for older Google imports.
    appointment = await enrichAppointmentFromNotes(appointment);
    res.json({
      appointment: serializeAppointment(appointment, { timezone: req.shop.timezone }),
    });
  }),
);

router.patch(
  '/:id',
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      customer_name: text(120, { min: 2 }).optional(),
      customer_phone: phoneSchema.optional(),
      customer_email: z.string().trim().email().max(180).nullish(),
      vehicle_make: optionalText(60),
      vehicle_model: optionalText(60),
      vehicle_year: z.coerce.number().int().min(1900).max(2100).nullish(),
      vehicle_plate: optionalText(20),
      service_type: optionalText(80),
      notes: optionalText(2000),
      internal_notes: optionalText(4000),
      scheduled_at: datetimeSchema.optional(),
      duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
      price_estimate: z.coerce.number().min(0).max(1_000_000).nullish(),
    }),
  ),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const appointment = await updateAppointment({
      shop: req.shop,
      appointmentId: req.params.id,
      patch: req.body,
      user: req.user,
    });
    res.json({ appointment: serializeAppointment(appointment, { timezone: req.shop.timezone }) });
  }),
);

// Accept workflow removed — bookings are confirmed on create.
router.post(
  '/:id/accept',
  validate(z.object({ shop_id: z.string().uuid().optional() })),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    await forceConfirmLegacyAppointments().catch(() => null);
    const appointment = await getAppointment(req.shop.id, req.params.id);
    if (!appointment) throw notFound('Appointment not found');
    res.status(410).json({
      error: {
        message: 'Las reservas ya se confirman automáticamente. Usa Cancelar reserva si hace falta.',
        code: 'accept_removed',
      },
      appointment: serializeAppointment(appointment, { timezone: req.shop.timezone }),
    });
  }),
);

router.post(
  '/:id/status',
  validate(
    z.object({
      shop_id: z.string().uuid().optional(),
      status: z.enum(APPOINTMENT_STATUSES),
      reason: optionalText(300),
    }),
  ),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const appointment = await updateStatus({
      shop: req.shop,
      appointmentId: req.params.id,
      status: req.body.status,
      reason: req.body.reason,
      user: req.user,
    });
    res.json({ appointment: serializeAppointment(appointment, { timezone: req.shop.timezone }) });
  }),
);


export default router;
