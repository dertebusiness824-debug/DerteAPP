import express from 'express';
import config from '../config.js';
import { query, queryOne } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import { attachUser, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { optionalPhoneSchema, optionalText, phoneSchema, text, validate, z } from '../middleware/validate.js';
import {
  assertStrongPassword,
  authenticate,
  createSession,
  findUserByPhone,
  hashPassword,
  issueOtp,
  listAccessibleShops,
  publicUser,
  registerShopOwner,
  revokeAllSessions,
  revokeSession,
  verifyOtp,
  verifyPassword,
} from '../services/auth.js';
import { deliverOtpSms } from '../services/telephony.js';

const router = express.Router();

function setSessionCookie(res, token, expiresAt) {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    expires: new Date(expiresAt),
    path: '/',
  });
}

async function sessionResponse(req, res, user, status = 200) {
  const { token, expires_at } = await createSession(user, {
    userAgent: req.get('user-agent'),
    ip: req.clientIp,
  });
  setSessionCookie(res, token, expires_at);
  const shops = await listAccessibleShops(user);
  res.status(status).json({
    token,
    expires_at,
    user: publicUser(user, shops),
  });
}

// --- One-time passcodes ------------------------------------------------------

router.post(
  '/otp/request',
  rateLimit({ name: 'otp-request', limit: 6, windowMs: 15 * 60_000, message: 'Too many code requests. Try again later.' }),
  validate(z.object({ phone: phoneSchema, purpose: z.enum(['register', 'login', 'reset']).default('login') })),
  asyncHandler(async (req, res) => {
    const { phone, purpose } = req.body;
    const existing = await findUserByPhone(phone);

    if (purpose === 'register' && existing) throw badRequest('That number is already registered. Sign in instead.');
    // Login/reset codes stay silent about unknown numbers to avoid enumeration.
    if (purpose !== 'register' && !existing) {
      return res.json({ sent: true, phone, expires_in: config.otp.ttlSeconds });
    }

    const result = await issueOtp(phone, purpose);
    const delivery = await deliverOtpSms(result.phone, result.code);

    return res.json({
      sent: true,
      phone: result.phone,
      purpose: result.purpose,
      expires_in: result.expires_in,
      delivery_channel: delivery.delivered ? 'sms' : 'none',
      // Development convenience only: lets you test without an SMS provider.
      ...(config.otp.debug ? { debug_code: result.code } : {}),
    });
  }),
);

router.post(
  '/otp/login',
  rateLimit({ name: 'otp-login', limit: 12, windowMs: 15 * 60_000 }),
  validate(z.object({ phone: phoneSchema, code: text(8) })),
  asyncHandler(async (req, res) => {
    await verifyOtp(req.body.phone, req.body.code, 'login');
    const user = await findUserByPhone(req.body.phone);
    if (!user) throw unauthorized('No account for that number');
    if (user.status !== 'active') throw forbidden('This account has been suspended');
    // Re-read the row so the response reflects the number it just verified.
    const verified = await queryOne(
      `UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE id = $1 RETURNING *`,
      [user.id],
    );
    await sessionResponse(req, res, verified);
  }),
);

// --- Registration & login ----------------------------------------------------

router.post(
  '/register',
  rateLimit({ name: 'register', limit: 8, windowMs: 60 * 60_000, message: 'Too many sign-up attempts. Try again later.' }),
  validate(
    z.object({
      phone: phoneSchema,
      password: z.string().min(8, 'Password must be at least 8 characters long').max(200),
      full_name: text(120, { min: 2 }),
      shop_name: text(160, { min: 2 }),
      email: z.string().trim().email('Enter a valid email address').max(180).optional().or(z.literal('')),
      timezone: optionalText(64),
      whatsapp_phone: optionalPhoneSchema,
      site_url: optionalText(300),
      otp_code: optionalText(8),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (!config.registration.allowSelfRegistration) {
      throw forbidden('Sign-ups are closed on this DerteApp instance. Ask your Super Admin for an account.', {
        code: 'registration_closed',
      });
    }

    let otpVerified = false;
    if (req.body.otp_code) {
      await verifyOtp(req.body.phone, req.body.otp_code, 'register');
      otpVerified = true;
    }

    const { user } = await registerShopOwner({
      ...req.body,
      email: req.body.email || null,
      otp_verified: otpVerified,
    });
    await sessionResponse(req, res, user, 201);
  }),
);

/**
 * Sign in with a phone number (shop owners) or an email address (Super Admin).
 * `phone` and `email` are accepted as aliases of `identifier`.
 */
const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(180).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    email: z.string().trim().min(3).max(180).optional(),
    password: z.string().min(1, 'Password is required').max(200),
  })
  .transform((body) => ({
    identifier: body.identifier ?? body.email ?? body.phone ?? '',
    password: body.password,
  }))
  .refine((body) => body.identifier.length >= 3, {
    message: 'Enter your phone number or email address',
    path: ['identifier'],
  });

router.post(
  '/login',
  rateLimit({ name: 'login', limit: 15, windowMs: 15 * 60_000, message: 'Too many sign-in attempts. Try again shortly.' }),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const user = await authenticate(req.body.identifier, req.body.password);
    await sessionResponse(req, res, user);
  }),
);

router.post(
  '/logout',
  attachUser,
  asyncHandler(async (req, res) => {
    if (req.sessionToken) await revokeSession(req.sessionToken);
    res.clearCookie(config.auth.cookieName, { path: '/' });
    res.json({ signed_out: true });
  }),
);

router.post(
  '/logout-all',
  attachUser,
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(req.user.id);
    res.clearCookie(config.auth.cookieName, { path: '/' });
    res.json({ signed_out: true, all_devices: true });
  }),
);

// --- Profile -----------------------------------------------------------------

router.get(
  '/me',
  attachUser,
  requireAuth,
  asyncHandler(async (req, res) => {
    const shops = await listAccessibleShops(req.user);
    res.json({
      user: publicUser(req.user, shops),
      // The registered number is public by design: customers and the Super
      // Admin must always be able to reach the owner in one tap.
      contact: {
        phone: req.user.phone,
        phone_display: formatPhone(req.user.phone),
        tel_link: telLink(req.user.phone),
        whatsapp_link: whatsappLink(req.user.whatsapp_phone ?? req.user.phone),
      },
    });
  }),
);

router.patch(
  '/me',
  attachUser,
  requireAuth,
  validate(
    z.object({
      full_name: text(120, { min: 2 }).optional(),
      email: z.string().trim().email().max(180).nullish(),
      whatsapp_phone: optionalPhoneSchema.optional(),
      locale: z.string().trim().max(8).optional(),
      avatar_hue: z.coerce.number().int().min(0).max(360).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const fields = ['full_name', 'email', 'whatsapp_phone', 'locale', 'avatar_hue'];
    const updates = [];
    const values = [req.user.id];
    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      values.push(req.body[field]);
      updates.push(`${field} = $${values.length}`);
    }
    if (updates.length === 0) return res.json({ user: publicUser(req.user) });

    const { rows } = await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $1 RETURNING *`, values);
    return res.json({ user: publicUser(rows[0]) });
  }),
);

router.post(
  '/password',
  attachUser,
  requireAuth,
  validate(z.object({ current_password: z.string().min(1), new_password: z.string().min(8).max(200) })),
  asyncHandler(async (req, res) => {
    if (!(await verifyPassword(req.user, req.body.current_password))) {
      throw unauthorized('Your current password is not correct');
    }
    assertStrongPassword(req.body.new_password);
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      req.user.id,
      await hashPassword(req.body.new_password),
    ]);
    await revokeAllSessions(req.user.id);
    await sessionResponse(req, res, req.user);
  }),
);

router.post(
  '/password/reset',
  rateLimit({ name: 'password-reset', limit: 10, windowMs: 60 * 60_000 }),
  validate(z.object({ phone: phoneSchema, code: text(8), new_password: z.string().min(8).max(200) })),
  asyncHandler(async (req, res) => {
    await verifyOtp(req.body.phone, req.body.code, 'reset');
    assertStrongPassword(req.body.new_password);
    const user = await findUserByPhone(req.body.phone);
    if (!user) throw unauthorized('No account for that number');
    await query('UPDATE users SET password_hash = $2, phone_verified_at = COALESCE(phone_verified_at, now()) WHERE id = $1', [
      user.id,
      await hashPassword(req.body.new_password),
    ]);
    await revokeAllSessions(user.id);
    await sessionResponse(req, res, user);
  }),
);

export default router;
