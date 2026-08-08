import express from 'express';
import { asyncHandler, notFound } from '../lib/errors.js';
import { addDays, parseDateOnly, utcFromZoned, zonedDateString } from '../lib/time.js';
import { attachUser, requireAuth, requireShopAccess } from '../middleware/auth.js';
import { booleanish, datetimeSchema, isoDateSchema, optionalText, phoneSchema, text, validate, z } from '../middleware/validate.js';
import { autoCompleteShopAppointments } from '../services/auto-complete.js';
import {
  APPOINTMENT_STATUSES,
  acceptAppointment,
  createAppointment,
  enrichAppointmentFromNotes,
  getAppointment,
  listAppointments,
  serializeAppointment,
  updateAppointment,
  updateStatus,
} from '../services/appointments.js';

const router = express.Router();
router.use(attachUser, requireAuth);

const listQuerySchema = z.object({
  shop_id: z.string().uuid().optional(),
  status: z
    .union([z.enum(APPOINTMENT_STATUSES), z.array(z.enum(APPOINTMENT_STATUSES))])
    .optional(),
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
    // Refresh statuses before listing so the panel shows Completada near closing.
    await autoCompleteShopAppointments(req.shop).catch((error) => {
      console.warn('[appointments] auto-complete skipped', error.message);
    });

    const filters = req.validatedQuery;
    const range = resolveRange(filters, req.shop.timezone);
    const rows = await listAppointments({
      shopId: req.shop.id,
      status: filters.status ?? null,
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
    await autoCompleteShopAppointments(req.shop).catch((error) => {
      console.warn('[appointments] auto-complete skipped', error.message);
    });

    const today = zonedDateString(new Date(), req.shop.timezone);
    const range = resolveRange({ date: today }, req.shop.timezone);
    const rows = await listAppointments({ shopId: req.shop.id, from: range.from, to: range.to, limit: 100 });
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

router.post(
  '/:id/accept',
  validate(z.object({ shop_id: z.string().uuid().optional() })),
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const result = await acceptAppointment({ shop: req.shop, appointmentId: req.params.id, user: req.user });
    res.json({
      appointment: serializeAppointment(result.appointment, { timezone: req.shop.timezone }),
      confirmed: Boolean(result.confirmed),
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
