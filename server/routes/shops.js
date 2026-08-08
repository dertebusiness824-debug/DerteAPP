import express from 'express';
import config from '../config.js';
import { query, queryAll, queryOne, transaction } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import { randomToken } from '../lib/ids.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { normalizeHttpUrl } from '../lib/urls.js';
import { isValidTimeZone, utcFromZoned, parseDateOnly, zonedDateString, addDays } from '../lib/time.js';
import { attachUser, requireAuth, requireShopAccess } from '../middleware/auth.js';
import { booleanish, isoDateSchema, optionalPhoneSchema, optionalText, phoneSchema, text, timeSchema, validate, z } from '../middleware/validate.js';
import { autoCompleteShopAppointments } from '../services/auto-complete.js';
import { shopAnalytics, shopToday, shopYearlyHistory } from '../services/analytics.js';
import { createShop, hashPassword, listAccessibleShops, publicUser, assertStrongPassword, revokeAllSessions } from '../services/auth.js';
import { recordAudit } from '../services/appointments.js';
import { getShopContact } from '../services/chat.js';
import {
  deleteException,
  getAvailability,
  getOpenState,
  getWeeklyHours,
  listExceptions,
  replaceWeeklyHours,
  upsertException,
} from '../services/schedule.js';
import { embedSnippet } from '../lib/embed-snippet.js';
import {
  buildConnectUrl,
  completeOAuthConnect,
  disconnectCalendar,
  parseOAuthState,
  processCalendarWebhookNotification,
  saveCalendarId,
  serializeGoogleCalendarStatus,
  syncShopFromGoogleCalendar,
} from '../services/google-calendar.js';
import {
  assignShopSalesRep,
  ensureFirstPaymentCommission,
  setShopFirstPayment,
} from '../services/sales-reps.js';

const router = express.Router();

function serializeShop(shop, { extra = {} } = {}) {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    public_key: shop.public_key,
    site_url: shop.site_url ?? null,
    website_url: shop.website_url ?? null,
    site_domains: shop.site_domains ?? [],
    phone: shop.phone ?? null,
    phone_display: shop.phone ? formatPhone(shop.phone) : null,
    tel_link: telLink(shop.phone),
    whatsapp_phone: shop.whatsapp_phone ?? null,
    whatsapp_link: whatsappLink(shop.whatsapp_phone ?? shop.phone),
    email: shop.email ?? null,
    address: shop.address ?? null,
    city: shop.city ?? null,
    country_code: shop.country_code ?? null,
    timezone: shop.timezone,
    slot_minutes: shop.slot_minutes,
    capacity: shop.capacity,
    min_notice_minutes: shop.min_notice_minutes,
    booking_horizon_days: shop.booking_horizon_days,
    services: shop.services ?? [],
    zadarma_sip: shop.zadarma_sip ?? null,
    zadarma_did: shop.zadarma_did ?? null,
    retell_agent_id: shop.retell_agent_id ?? null,
    retell_did: shop.retell_did ?? null,
    // Never echo the raw key; clients only need to know whether one is stored.
    retell_api_key_set: Boolean(shop.retell_api_key),
    google_calendar: serializeGoogleCalendarStatus(shop),
    settings: shop.settings ?? {},
    status: shop.status,
    sales_rep_id: shop.sales_rep_id ?? null,
    sales_rep: shop.sales_rep_name
      ? {
          id: shop.sales_rep_id,
          name: shop.sales_rep_name,
          referral_code: shop.sales_rep_code ?? null,
        }
      : null,
    first_payment_at: shop.first_payment_at ?? null,
    first_payment_paid: Boolean(shop.first_payment_at),
    created_at: shop.created_at,
    ...extra,
  };
}

/**
 * Google Calendar push notifications (events.watch).
 * Must stay public — Google cannot send session cookies. Acknowledge quickly
 * and process the incremental sync asynchronously.
 */
router.post(
  '/google-calendar/webhook',
  asyncHandler(async (req, res) => {
    const channelId = req.get('x-goog-channel-id') || req.get('X-Goog-Channel-ID') || '';
    const resourceState = req.get('x-goog-resource-state') || req.get('X-Goog-Resource-State') || '';
    const channelToken = req.get('x-goog-channel-token') || req.get('X-Goog-Channel-Token') || '';
    const resourceId = req.get('x-goog-resource-id') || req.get('X-Goog-Resource-ID') || '';

    // Always ACK — Google retries aggressively on non-2xx.
    res.status(200).json({ ok: true });

    setImmediate(() => {
      void processCalendarWebhookNotification({
        channelId,
        resourceState,
        channelToken,
        resourceId,
      }).catch((error) => {
        console.error('[google-calendar] webhook processing failed', error.message);
      });
    });
  }),
);

/**
 * OAuth callback from Google — must stay before auth middleware so the redirect
 * can complete even if cookie timing is awkward; we still verify the session.
 */
router.get(
  '/google-calendar/callback',
  attachUser,
  asyncHandler(async (req, res) => {
    const frontend = `${config.appUrl}/settings`;
    if (req.query.error) {
      return res.redirect(`${frontend}?google=error&reason=${encodeURIComponent(req.query.error)}`);
    }
    if (!req.user) {
      return res.redirect(`${config.appUrl}/login?next=${encodeURIComponent('/settings/shop')}`);
    }

    const state = parseOAuthState(req.query.state);
    if (!state?.shopId) {
      return res.redirect(`${frontend}?google=error&reason=state`);
    }

    const shop = await queryOne('SELECT * FROM shops WHERE id = $1', [state.shopId]);
    if (!shop) return res.redirect(`${frontend}?google=error&reason=shop`);

    if (req.user.role !== 'super_admin') {
      const membership = await queryOne(
        'SELECT 1 FROM shop_members WHERE shop_id = $1 AND user_id = $2',
        [shop.id, req.user.id],
      );
      if (!membership) return res.redirect(`${frontend}?google=error&reason=forbidden`);
    }

    try {
      const connected = await completeOAuthConnect({
        shopId: state.shopId,
        code: String(req.query.code || ''),
      });
      await recordAudit({
        actorUserId: req.user.id,
        shopId: state.shopId,
        action: 'shop.google_calendar.connect',
        ip: req.clientIp,
      });
      const sync = connected?._initialSync ?? {};
      const params = new URLSearchParams({
        google: 'connected',
        fetched: String(sync.fetched ?? 0),
        created: String(sync.created ?? 0),
        updated: String(sync.updated ?? 0),
      });
      // Land on shop settings so the owner sees the sync button + status.
      return res.redirect(`${config.appUrl}/settings/shop?${params}`);
    } catch (error) {
      console.error('[google-calendar] oauth callback failed', error.message);
      return res.redirect(`${frontend}?google=error&reason=token`);
    }
  }),
);

router.use(attachUser, requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const shops = await listAccessibleShops(req.user);
    res.json({ shops, count: shops.length });
  }),
);

// Super Admin onboarding for a new Hostinger site: creates the tenant and
// optionally links (or creates) its owner in one call.
router.post(
  '/',
  validate(
    z.object({
      name: text(160, { min: 2 }),
      timezone: optionalText(64),
      phone: optionalPhoneSchema,
      whatsapp_phone: optionalPhoneSchema,
      email: z.string().trim().email().max(180).nullish(),
      site_url: optionalText(500),
      website_url: optionalText(500),
      site_domains: z.array(z.string().trim().max(200)).max(10).optional(),
      city: optionalText(120),
      country_code: optionalText(4),
      address: optionalText(300),
      sales_rep_id: z.string().uuid().nullish(),
      owner: z
        .object({
          phone: phoneSchema,
          full_name: text(120, { min: 2 }),
          email: z.string().trim().email().max(180).optional(),
          password: z.string().min(8).max(200).optional(),
        })
        .optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'super_admin') throw forbidden('Only a Super Admin can create shops');
    if (req.body.timezone && !isValidTimeZone(req.body.timezone)) throw badRequest('Unknown timezone');

    const websiteUrl = normalizeHttpUrl(req.body.website_url, { field: 'website_url' });
    const siteUrl = normalizeHttpUrl(req.body.site_url, { field: 'site_url' });
    const createPayload = {
      ...req.body,
      website_url: websiteUrl === undefined ? null : websiteUrl,
      site_url: siteUrl === undefined ? websiteUrl ?? null : siteUrl,
      sales_rep_id: req.body.sales_rep_id || null,
    };

    const result = await transaction(async (client) => {
      const shop = await createShop(client, createPayload);
      let owner = null;
      let temporaryPassword = null;

      if (req.body.owner) {
        const existing = await client
          .query('SELECT * FROM users WHERE phone = $1', [req.body.owner.phone])
          .then(({ rows }) => rows[0]);
        if (existing) {
          owner = existing;
        } else {
          temporaryPassword = req.body.owner.password ?? `Derte${randomToken(4)}1`;
          const ownerEmail = req.body.owner.email
            ? String(req.body.owner.email).trim().toLowerCase()
            : null;
          owner = await client
            .query(
              `INSERT INTO users (phone, password_hash, full_name, email, role, whatsapp_phone)
               VALUES ($1, $2, $3, $4, 'shop_owner', $1) RETURNING *`,
              [
                req.body.owner.phone,
                await hashPassword(temporaryPassword),
                req.body.owner.full_name,
                ownerEmail,
              ],
            )
            .then(({ rows }) => rows[0]);
        }
        const { linkUserToShop } = await import('../services/shop-members.js');
        await linkUserToShop(client, {
          shopId: shop.id,
          userId: owner.id,
          role: 'owner',
          isPrimary: true,
          strict: true,
        });
      }

      return { shop, owner, temporaryPassword };
    });

    await recordAudit({ actorUserId: req.user.id, shopId: result.shop.id, action: 'shop.create', ip: req.clientIp });

    res.status(201).json({
      shop: serializeShop(result.shop),
      owner: result.owner ? publicUser(result.owner) : null,
      ...(result.temporaryPassword ? { temporary_password: result.temporaryPassword } : {}),
    });
  }),
);

router.get(
  '/:shopId',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const shopRow =
      (await queryOne(
        `SELECT s.*, r.name AS sales_rep_name, r.referral_code AS sales_rep_code
           FROM shops s
           LEFT JOIN sales_reps r ON r.id = s.sales_rep_id
          WHERE s.id = $1`,
        [req.shop.id],
      )) ?? req.shop;

    const [openState, contact, members] = await Promise.all([
      getOpenState(shopRow),
      getShopContact(shopRow.id),
      queryAll(
        `SELECT u.id, u.full_name, u.phone, u.role AS account_role, m.role, m.is_primary
           FROM shop_members m JOIN users u ON u.id = m.user_id
          WHERE m.shop_id = $1 ORDER BY m.is_primary DESC, u.full_name`,
        [shopRow.id],
      ),
    ]);

    res.json({
      shop: serializeShop(shopRow, {
        extra: {
          open_now: openState.open_now,
          open_state_reason: openState.reason,
          today: openState.today,
          contact,
          member_role: req.shopRole,
        },
      }),
      members: members.map((member) => ({
        ...member,
        phone_display: formatPhone(member.phone),
        tel_link: telLink(member.phone),
      })),
    });
  }),
);

router.patch(
  '/:shopId',
  requireShopAccess,
  validate(
    z.object({
      name: text(160, { min: 2 }).optional(),
      phone: optionalPhoneSchema.optional(),
      whatsapp_phone: optionalPhoneSchema.optional(),
      email: z.string().trim().email().max(180).nullish(),
      address: optionalText(300),
      city: optionalText(120),
      country_code: optionalText(4),
      site_url: optionalText(500),
      website_url: optionalText(500),
      site_domains: z.array(z.string().trim().max(200)).max(10).optional(),
      timezone: z.string().trim().max(64).optional(),
      slot_minutes: z.coerce.number().int().min(5).max(480).optional(),
      capacity: z.coerce.number().int().min(1).max(100).optional(),
      min_notice_minutes: z.coerce.number().int().min(0).max(20_160).optional(),
      booking_horizon_days: z.coerce.number().int().min(1).max(365).optional(),
      services: z.array(z.string().trim().max(80)).max(40).optional(),
      zadarma_sip: optionalText(40),
      zadarma_did: optionalText(40),
      retell_agent_id: optionalText(80),
      retell_did: optionalText(40),
      retell_api_key: z.string().trim().max(200).nullish(),
      settings: z.record(z.any()).optional(),
      sales_rep_id: z.string().uuid().nullish(),
      first_payment_paid: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.body.timezone && !isValidTimeZone(req.body.timezone)) throw badRequest('Unknown timezone');
    // Telephony routing, Hostinger panel URL and the site allowlist are platform-level.
    if (req.user.role !== 'super_admin') {
      for (const restricted of [
        'zadarma_sip',
        'zadarma_did',
        'retell_agent_id',
        'retell_did',
        'retell_api_key',
        'site_domains',
        'website_url',
        'sales_rep_id',
        'first_payment_paid',
      ]) {
        if (req.body[restricted] !== undefined) {
          throw forbidden(`Only a Super Admin can change ${restricted}. Message support from the Chat tab.`);
        }
      }
    }

    if (req.body.website_url !== undefined) {
      req.body.website_url = normalizeHttpUrl(req.body.website_url, { field: 'website_url' });
    }
    if (req.body.site_url !== undefined) {
      req.body.site_url = normalizeHttpUrl(req.body.site_url, { field: 'site_url' });
    }

    const columns = [
      'name',
      'phone',
      'whatsapp_phone',
      'email',
      'address',
      'city',
      'country_code',
      'site_url',
      'website_url',
      'site_domains',
      'timezone',
      'slot_minutes',
      'capacity',
      'min_notice_minutes',
      'booking_horizon_days',
      'zadarma_sip',
      'zadarma_did',
      'retell_agent_id',
      'retell_did',
      'retell_api_key',
    ];
    const updates = [];
    const values = [req.shop.id];
    for (const column of columns) {
      if (req.body[column] === undefined) continue;
      values.push(req.body[column]);
      updates.push(`${column} = $${values.length}`);
    }
    if (req.body.services !== undefined) {
      values.push(JSON.stringify(req.body.services));
      updates.push(`services = $${values.length}::jsonb`);
    }
    if (req.body.settings !== undefined) {
      values.push(JSON.stringify(req.body.settings));
      updates.push(`settings = shops.settings || $${values.length}::jsonb`);
    }
    const attributionTouched =
      req.user.role === 'super_admin' &&
      (req.body.sales_rep_id !== undefined || req.body.first_payment_paid !== undefined);

    let shop = req.shop;
    if (updates.length > 0) {
      const { rows } = await query(`UPDATE shops SET ${updates.join(', ')} WHERE id = $1 RETURNING *`, values);
      shop = rows[0];
    } else if (!attributionTouched) {
      const enriched = await queryOne(
        `SELECT s.*, r.name AS sales_rep_name, r.referral_code AS sales_rep_code
           FROM shops s LEFT JOIN sales_reps r ON r.id = s.sales_rep_id WHERE s.id = $1`,
        [req.shop.id],
      );
      return res.json({ shop: serializeShop(enriched ?? req.shop) });
    }

    if (req.user.role === 'super_admin' && req.body.sales_rep_id !== undefined) {
      shop = await assignShopSalesRep(req.shop.id, req.body.sales_rep_id || null);
    }
    if (req.user.role === 'super_admin' && req.body.first_payment_paid !== undefined) {
      shop = await setShopFirstPayment(req.shop.id, { paid: Boolean(req.body.first_payment_paid) });
    } else if (shop.sales_rep_id && shop.first_payment_at) {
      await ensureFirstPaymentCommission(shop);
    }

    await recordAudit({
      actorUserId: req.user.id,
      shopId: req.shop.id,
      action: 'shop.update',
      metadata: { fields: Object.keys(req.body) },
      ip: req.clientIp,
    });

    const enriched =
      (await queryOne(
        `SELECT s.*, r.name AS sales_rep_name, r.referral_code AS sales_rep_code
           FROM shops s
           LEFT JOIN sales_reps r ON r.id = s.sales_rep_id
          WHERE s.id = $1`,
        [req.shop.id],
      )) ?? shop;
    return res.json({ shop: serializeShop(enriched) });
  }),
);

/**
 * Super Admin sets (or resets) the primary shop owner's password.
 * Revokes that owner's sessions so they must sign in again.
 */
router.post(
  '/:shopId/owner-password',
  requireShopAccess,
  validate(z.object({ password: z.string().min(8).max(200) })),
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'super_admin') {
      throw forbidden('Only a Super Admin can reset a shop owner password');
    }
    assertStrongPassword(req.body.password);

    const owner = await queryOne(
      `SELECT u.id, u.full_name, u.email, u.phone
         FROM shop_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.shop_id = $1 AND m.role = 'owner'
        ORDER BY m.is_primary DESC, m.created_at ASC
        LIMIT 1`,
      [req.shop.id],
    );
    if (!owner) throw notFound('This shop has no owner account yet');

    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      owner.id,
      await hashPassword(req.body.password),
    ]);
    await revokeAllSessions(owner.id);
    await recordAudit({
      actorUserId: req.user.id,
      shopId: req.shop.id,
      action: 'shop.owner_password',
      entityId: owner.id,
      ip: req.clientIp,
    });

    res.json({
      updated: true,
      owner: {
        id: owner.id,
        full_name: owner.full_name,
        email: owner.email,
        phone: owner.phone,
      },
    });
  }),
);

// --- Google Calendar ---------------------------------------------------------

router.get(
  '/:shopId/google-calendar',
  requireShopAccess,
  asyncHandler((req, res) => {
    res.json({ google_calendar: serializeGoogleCalendarStatus(req.shop) });
  }),
);

/** Starts the Google OAuth consent screen for this shop. */
router.get(
  '/:shopId/google-calendar/connect',
  requireShopAccess,
  asyncHandler((req, res, next) => {
    if (!config.googleCalendar.oauthConfigured) {
      return next(
        badRequest('Google Calendar OAuth no está configurado en el servidor', {
          code: 'google_calendar_oauth_missing',
        }),
      );
    }
    const url = buildConnectUrl({ shopId: req.shop.id, userId: req.user.id });
    res.json({ url });
  }),
);

/** Manual Calendar ID (service-account mode) or toggle sync. */
router.post(
  '/:shopId/google-calendar',
  requireShopAccess,
  validate(
    z.object({
      calendar_id: z.string().trim().min(1).max(300).optional(),
      sync_enabled: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const calendarId = req.body.calendar_id ?? req.shop.google_calendar_id;
    if (!calendarId) throw badRequest('Indica el Calendar ID de Google');

    if (!config.googleCalendar.configured && !req.shop.google_calendar_refresh_token) {
      throw badRequest('Configura las credenciales de Google Calendar en el servidor', {
        code: 'google_calendar_not_configured',
      });
    }

    const shop = await saveCalendarId({
      shopId: req.shop.id,
      calendarId,
      enabled: req.body.sync_enabled ?? true,
    });
    await recordAudit({
      actorUserId: req.user.id,
      shopId: req.shop.id,
      action: 'shop.google_calendar.update',
      metadata: { calendar_id: calendarId },
      ip: req.clientIp,
    });
    res.json({ shop: serializeShop(shop), google_calendar: serializeGoogleCalendarStatus(shop) });
  }),
);

router.delete(
  '/:shopId/google-calendar',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const shop = await disconnectCalendar(req.shop.id);
    await recordAudit({
      actorUserId: req.user.id,
      shopId: req.shop.id,
      action: 'shop.google_calendar.disconnect',
      ip: req.clientIp,
    });
    res.json({ shop: serializeShop(shop), google_calendar: serializeGoogleCalendarStatus(shop) });
  }),
);

/**
 * Manual / forced pull from Google Calendar into DerteAPP appointments.
 * Used by the «Sincronizar ahora» button and after OAuth connect.
 */
router.post(
  '/:shopId/google-calendar/sync',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    if (!req.shop.google_calendar_sync_enabled || !req.shop.google_calendar_id) {
      throw badRequest('Google Calendar no está conectado para este taller', {
        code: 'google_calendar_not_connected',
      });
    }
    const sync = await syncShopFromGoogleCalendar(req.shop, { mode: 'initial', force: true });
    if (!sync.ok && sync.reason !== 'not_connected') {
      // Still return 200 with ok:false for soft failures (auth/list); client shows message.
      console.warn('[google-calendar] manual sync incomplete', sync);
    }
    await recordAudit({
      actorUserId: req.user.id,
      shopId: req.shop.id,
      action: 'shop.google_calendar.sync',
      metadata: {
        fetched: sync.fetched,
        created: sync.created,
        updated: sync.updated,
        cancelled: sync.cancelled,
      },
      ip: req.clientIp,
    });
    const fresh = await queryOne('SELECT * FROM shops WHERE id = $1', [req.shop.id]);
    res.json({
      ok: Boolean(sync.ok),
      fetched: sync.fetched ?? 0,
      created: sync.created ?? 0,
      updated: sync.updated ?? 0,
      cancelled: sync.cancelled ?? 0,
      skipped: sync.skipped ?? 0,
      reason: sync.reason,
      message: sync.message,
      sync,
      google_calendar: serializeGoogleCalendarStatus(fresh ?? req.shop),
    });
  }),
);

// --- Team --------------------------------------------------------------------

router.post(
  '/:shopId/members',
  requireShopAccess,
  validate(
    z.object({
      phone: phoneSchema,
      full_name: text(120, { min: 2 }),
      role: z.enum(['owner', 'manager', 'mechanic']).default('mechanic'),
      password: z.string().min(8).max(200).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (!['owner', 'super_admin'].includes(req.shopRole)) throw forbidden('Only the shop owner can add team members');

    const result = await transaction(async (client) => {
      let user = await client
        .query('SELECT * FROM users WHERE phone = $1', [req.body.phone])
        .then(({ rows }) => rows[0]);
      let temporaryPassword = null;
      if (!user) {
        temporaryPassword = req.body.password ?? `Derte${randomToken(4)}1`;
        user = await client
          .query(
            `INSERT INTO users (phone, password_hash, full_name, role, whatsapp_phone)
             VALUES ($1, $2, $3, 'shop_owner', $1) RETURNING *`,
            [req.body.phone, await hashPassword(temporaryPassword), req.body.full_name],
          )
          .then(({ rows }) => rows[0]);
      }
      const { linkUserToShop } = await import('../services/shop-members.js');
      await linkUserToShop(client, {
        shopId: req.shop.id,
        userId: user.id,
        role: req.body.role,
        isPrimary: false,
        strict: true,
      });
      return { user, temporaryPassword };
    });

    res.status(201).json({
      member: { ...publicUser(result.user), role: req.body.role, phone_display: formatPhone(result.user.phone) },
      ...(result.temporaryPassword ? { temporary_password: result.temporaryPassword } : {}),
    });
  }),
);

router.delete(
  '/:shopId/members/:userId',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    if (!['owner', 'super_admin'].includes(req.shopRole)) throw forbidden('Only the shop owner can remove members');
    if (req.params.userId === req.user.id) throw badRequest('You cannot remove yourself from your own shop');
    const removed = await queryOne('DELETE FROM shop_members WHERE shop_id = $1 AND user_id = $2 RETURNING user_id', [
      req.shop.id,
      req.params.userId,
    ]);
    if (!removed) throw notFound('That member is not part of this shop');
    res.json({ removed: true });
  }),
);

// --- Opening hours -----------------------------------------------------------

const dayRuleSchema = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    is_closed: booleanish(false),
    open_time: timeSchema.nullish(),
    close_time: timeSchema.nullish(),
    break_start: timeSchema.nullish(),
    break_end: timeSchema.nullish(),
  })
  .passthrough();

router.get(
  '/:shopId/schedule',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const today = zonedDateString(new Date(), req.shop.timezone);
    const [weekly, exceptions, openState] = await Promise.all([
      getWeeklyHours(req.shop.id),
      listExceptions(req.shop.id, { from: today, to: addDays(today, 180) }),
      getOpenState(req.shop),
    ]);
    res.json({
      timezone: req.shop.timezone,
      slot_minutes: req.shop.slot_minutes,
      capacity: req.shop.capacity,
      min_notice_minutes: req.shop.min_notice_minutes,
      booking_horizon_days: req.shop.booking_horizon_days,
      open_now: openState.open_now,
      open_state_reason: openState.reason,
      weekly_hours: weekly,
      exceptions,
    });
  }),
);

router.put(
  '/:shopId/schedule',
  requireShopAccess,
  validate(z.object({ days: z.array(dayRuleSchema).min(1).max(7) })),
  asyncHandler(async (req, res) => {
    const weekly = await replaceWeeklyHours(req.shop.id, req.body.days);
    await recordAudit({ actorUserId: req.user.id, shopId: req.shop.id, action: 'schedule.update', ip: req.clientIp });
    res.json({ weekly_hours: weekly });
  }),
);

router.get(
  '/:shopId/exceptions',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    res.json({ exceptions: await listExceptions(req.shop.id, { from: req.query.from, to: req.query.to }) });
  }),
);

router.post(
  '/:shopId/exceptions',
  requireShopAccess,
  validate(
    z.object({
      date: isoDateSchema,
      is_closed: booleanish(true),
      open_time: timeSchema.nullish(),
      close_time: timeSchema.nullish(),
      break_start: timeSchema.nullish(),
      break_end: timeSchema.nullish(),
      note: optionalText(200),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (!parseDateOnly(req.body.date)) throw badRequest('date must be formatted as YYYY-MM-DD');
    const exception = await upsertException(req.shop.id, req.body);
    res.status(201).json({ exception });
  }),
);

router.delete(
  '/:shopId/exceptions/:exceptionId',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    const removed = await deleteException(req.shop.id, req.params.exceptionId);
    if (!removed) throw notFound('Schedule exception not found');
    res.json({ removed: true });
  }),
);

router.get(
  '/:shopId/availability',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    res.json(
      await getAvailability({
        shop: req.shop,
        from: req.query.from,
        days: req.query.days ?? 7,
        durationMinutes: req.query.duration_minutes,
      }),
    );
  }),
);

// --- Dashboard data ----------------------------------------------------------

router.get(
  '/:shopId/overview',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    await autoCompleteShopAppointments(req.shop).catch((error) => {
      console.warn('[shops] auto-complete skipped', error.message);
    });

    const timezone = req.shop.timezone;
    const today = zonedDateString(new Date(), timezone);
    const dayStart = utcFromZoned({ ...parseDateOnly(today), hour: 0, minute: 0 }, timezone);
    const dayEnd = utcFromZoned({ ...parseDateOnly(addDays(today, 1)), hour: 0, minute: 0 }, timezone);

    const [stats, openState] = await Promise.all([
      shopToday({ shopId: req.shop.id, dayStart, dayEnd }),
      getOpenState(req.shop),
    ]);

    res.json({
      shop: serializeShop(req.shop),
      date: today,
      stats,
      open_now: openState.open_now,
      open_state_reason: openState.reason,
      today_hours: openState.today,
    });
  }),
);

router.get(
  '/:shopId/analytics',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    res.json(await shopAnalytics({ shopId: req.shop.id, days: req.query.days ?? 30 }));
  }),
);

router.get(
  '/:shopId/history',
  requireShopAccess,
  validate(
    z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await shopYearlyHistory({
        shopId: req.shop.id,
        year: req.validatedQuery.year,
        timezone: req.shop.timezone || 'Europe/Madrid',
      }),
    );
  }),
);

// --- Hostinger integration ---------------------------------------------------

router.get(
  '/:shopId/embed',
  requireShopAccess,
  (req, res) => {
    res.json({
      public_key: req.shop.public_key,
      api_base: `${config.appUrl}/api/public`,
      embed_script_url: `${config.appUrl}/embed/derteapp.js`,
      snippet: embedSnippet({ publicKey: req.shop.public_key, appUrl: config.appUrl }),
      endpoints: {
        config: `${config.appUrl}/api/public/shops/${req.shop.public_key}/config`,
        availability: `${config.appUrl}/api/public/shops/${req.shop.public_key}/availability`,
        booking: `${config.appUrl}/api/public/shops/${req.shop.public_key}/appointments`,
        events: `${config.appUrl}/api/public/shops/${req.shop.public_key}/events`,
      },
      allowed_domains: req.shop.site_domains ?? [],
      instructions: [
        'Open your Hostinger Website Builder project and go to Website settings → Integrations → Custom code.',
        'Paste the snippet below into the <head> section and publish the site.',
        'Add data-derte="booking-form" to your booking form, and name the fields name, phone, email, date, time, service, vehicle, notes.',
        'The snippet blocks submissions outside your opening hours and posts confirmed bookings straight into DerteApp.',
      ],
    });
  },
);

router.post(
  '/:shopId/rotate-public-key',
  requireShopAccess,
  asyncHandler(async (req, res) => {
    if (!['owner', 'super_admin'].includes(req.shopRole)) throw forbidden('Only the shop owner can rotate the key');
    const publicKey = `dk_${randomToken(18)}`;
    await query('UPDATE shops SET public_key = $2 WHERE id = $1', [req.shop.id, publicKey]);
    await recordAudit({ actorUserId: req.user.id, shopId: req.shop.id, action: 'shop.rotate_key', ip: req.clientIp });
    res.json({
      public_key: publicKey,
      snippet: embedSnippet({ publicKey, appUrl: config.appUrl }),
      warning: 'Update the snippet on your Hostinger site — the previous key stops working immediately.',
    });
  }),
);

export default router;
