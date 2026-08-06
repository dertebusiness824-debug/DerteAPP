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
  authenticateWithGoogle,
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
import { googleConfigured, verifyGoogleCredential } from '../services/google-auth.js';
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
  rateLimit({
    name: 'otp-request',
    limit: 6,
    windowMs: 15 * 60_000,
    message: 'Demasiadas solicitudes de código. Inténtalo más tarde.',
  }),
  validate(z.object({ phone: phoneSchema, purpose: z.enum(['register', 'login', 'reset']).default('login') })),
  asyncHandler(async (req, res) => {
    const { phone, purpose } = req.body;
    const existing = await findUserByPhone(phone);

    if (purpose === 'register' && existing) {
      throw badRequest('Ese número ya está registrado. Inicia sesión.');
    }
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
    if (!user) throw unauthorized('No hay cuenta con ese número');
    if (user.status !== 'active') throw forbidden('Esta cuenta está suspendida');
    const verified = await queryOne(
      `UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE id = $1 RETURNING *`,
      [user.id],
    );
    await sessionResponse(req, res, verified);
  }),
);

// --- Registration & login (email + password / Google) ------------------------

router.get('/google/config', (_req, res) => {
  res.json({
    configured: googleConfigured() && Boolean(config.google.clientId),
    client_id: config.google.clientId || null,
  });
});

router.post(
  '/register',
  rateLimit({
    name: 'register',
    limit: 8,
    windowMs: 60 * 60_000,
    message: 'Demasiados intentos de registro. Inténtalo más tarde.',
  }),
  validate(
    z.object({
      email: z.string().trim().email('Introduce un correo electrónico válido').max(180),
      password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
      phone: phoneSchema,
      full_name: text(120, { min: 2 }),
      shop_name: text(160, { min: 2 }),
      timezone: optionalText(64),
      whatsapp_phone: optionalPhoneSchema,
      site_url: optionalText(300),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (!config.registration.allowSelfRegistration) {
      throw forbidden('Los registros están cerrados. Pide una cuenta al Super Admin.', {
        code: 'registration_closed',
      });
    }

    const { user } = await registerShopOwner({
      ...req.body,
      email: req.body.email,
    });
    await sessionResponse(req, res, user, 201);
  }),
);

router.post(
  '/google',
  rateLimit({
    name: 'google-auth',
    limit: 20,
    windowMs: 15 * 60_000,
    message: 'Demasiados intentos con Google. Inténtalo más tarde.',
  }),
  validate(
    z.object({
      credential: z.string().min(10).max(12_000),
      shop_name: optionalText(160),
      phone: optionalPhoneSchema,
      full_name: optionalText(120),
      password: z.string().min(8).max(200).optional(),
      timezone: optionalText(64),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (!config.registration.allowSelfRegistration && req.body.shop_name) {
      throw forbidden('Los registros están cerrados. Pide una cuenta al Super Admin.', {
        code: 'registration_closed',
      });
    }

    const profile = await verifyGoogleCredential(req.body.credential);
    const result = await authenticateWithGoogle(profile, {
      shop_name: req.body.shop_name,
      phone: req.body.phone,
      full_name: req.body.full_name,
      password: req.body.password,
      timezone: req.body.timezone,
    });

    if (result.needs_registration) {
      return res.status(202).json({
        needs_registration: true,
        profile: result.profile,
      });
    }

    await sessionResponse(req, res, result.user, result.created ? 201 : 200);
  }),
);

/**
 * Sign in with email + password (shop owners and Super Admin).
 * `phone` is still accepted as a legacy alias of `identifier`.
 */
const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(180).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    email: z.string().trim().min(3).max(180).optional(),
    password: z.string().min(1, 'La contraseña es obligatoria').max(200),
  })
  .transform((body) => ({
    identifier: body.identifier ?? body.email ?? body.phone ?? '',
    password: body.password,
  }))
  .refine((body) => body.identifier.length >= 3, {
    message: 'Introduce tu correo electrónico',
    path: ['identifier'],
  });

router.post(
  '/login',
  rateLimit({
    name: 'login',
    limit: 15,
    windowMs: 15 * 60_000,
    message: 'Demasiados intentos de acceso. Inténtalo en unos minutos.',
  }),
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
      throw unauthorized('La contraseña actual no es correcta');
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
    if (!user) throw unauthorized('No hay cuenta con ese número');
    await query('UPDATE users SET password_hash = $2, phone_verified_at = COALESCE(phone_verified_at, now()) WHERE id = $1', [
      user.id,
      await hashPassword(req.body.new_password),
    ]);
    await revokeAllSessions(user.id);
    await sessionResponse(req, res, user);
  }),
);

export default router;
