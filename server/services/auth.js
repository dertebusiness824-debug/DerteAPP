import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { query, queryOne, transaction } from '../db/index.js';
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from '../lib/errors.js';
import { numericCode, randomToken, safeEqual, sha256, slugify } from '../lib/ids.js';
import { normalizePhone, requirePhone } from '../lib/phone.js';
import { seedDefaultHours } from './schedule.js';

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const hashPassword = (password) => bcrypt.hash(password, config.auth.bcryptRounds);

export function assertStrongPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`, { code: 'weak_password' });
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw badRequest('La contraseña debe incluir al menos una letra y un número', { code: 'weak_password' });
  }
  return password;
}

function assertAllowedPhone(phone) {
  const prefixes = config.registration.allowedPhonePrefixes;
  if (prefixes.length > 0 && !prefixes.some((prefix) => phone.startsWith(prefix))) {
    throw forbidden('Ese prefijo de país no está habilitado en esta instancia de DerteApp', {
      code: 'phone_prefix_blocked',
    });
  }
  return phone;
}

function assertEmail(email) {
  const value = String(email ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL_SHAPE.test(value)) throw badRequest('Introduce un correo electrónico válido', { code: 'invalid_email' });
  return value;
}

/** Shape returned to clients - never exposes password hashes. */
export function publicUser(user, shops = null) {
  if (!user) return null;
  return {
    id: user.id,
    phone: user.phone,
    full_name: user.full_name,
    email: user.email ?? null,
    role: user.role,
    whatsapp_phone: user.whatsapp_phone ?? null,
    avatar_hue: user.avatar_hue ?? 210,
    locale: user.locale ?? 'es',
    phone_verified: Boolean(user.phone_verified_at),
    google_linked: Boolean(user.google_sub),
    status: user.status,
    created_at: user.created_at,
    ...(shops ? { shops } : {}),
  };
}

export function findUserByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return Promise.resolve(null);
  return queryOne('SELECT * FROM users WHERE phone = $1', [normalized]);
}

export const findUserByEmail = (email) =>
  queryOne('SELECT * FROM users WHERE lower(email) = lower($1)', [String(email ?? '').trim()]);

export const looksLikeEmail = (value) => EMAIL_SHAPE.test(String(value ?? '').trim());

/**
 * Resolves a sign-in identifier. Prefer email (Google / Super Admin / owners);
 * phone is only accepted as a legacy fallback.
 */
export function findUserByIdentifier(identifier) {
  const value = String(identifier ?? '').trim();
  if (!value) return Promise.resolve(null);
  return looksLikeEmail(value) ? findUserByEmail(value) : findUserByPhone(value);
}

export const findUserByGoogleSub = (sub) =>
  queryOne('SELECT * FROM users WHERE google_sub = $1', [String(sub ?? '')]);

export const findUserById = (id) => queryOne('SELECT * FROM users WHERE id = $1', [id]);

/** Shops the user may act on. Super Admins get every active shop. */
export function listAccessibleShops(user) {
  if (user.role === 'super_admin') {
    return query(
      `SELECT s.id, s.name, s.slug, s.timezone, s.status, s.phone, 'super_admin' AS member_role
         FROM shops s WHERE s.status <> 'archived' ORDER BY s.name`,
    ).then(({ rows }) => rows);
  }
  return query(
    `SELECT s.id, s.name, s.slug, s.timezone, s.status, s.phone, m.role AS member_role
       FROM shop_members m JOIN shops s ON s.id = m.shop_id
      WHERE m.user_id = $1 AND s.status <> 'archived'
      ORDER BY m.is_primary DESC, s.name`,
    [user.id],
  ).then(({ rows }) => rows);
}

async function uniqueSlug(client, name) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { rowCount } = await client.query('SELECT 1 FROM shops WHERE slug = $1', [candidate]);
    if (rowCount === 0) return candidate;
  }
  return `${base}-${randomToken(4)}`;
}

/** Creates a shop with default opening hours and a Super Admin support thread. */
export async function createShop(client, { name, timezone, phone, whatsapp_phone, email, site_url, site_domains, city, country_code }) {
  const shop = await client
    .query(
      `INSERT INTO shops (name, slug, public_key, timezone, phone, whatsapp_phone, email, site_url, site_domains, city, country_code, slot_minutes, capacity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        name,
        await uniqueSlug(client, name),
        `dk_${randomToken(18)}`,
        timezone ?? config.shopDefaults.timezone,
        phone ?? null,
        whatsapp_phone ?? null,
        email ?? null,
        site_url ?? null,
        site_domains ?? [],
        city ?? null,
        country_code ?? null,
        config.shopDefaults.slotMinutes,
        config.shopDefaults.capacity,
      ],
    )
    .then(({ rows }) => rows[0]);

  await seedDefaultHours(client, shop.id);
  await client.query(
    `INSERT INTO chat_threads (shop_id, kind, subject) VALUES ($1, 'support', $2)
     ON CONFLICT DO NOTHING`,
    [shop.id, `${shop.name} — DerteApp support`],
  );
  return shop;
}

/**
 * Self-service registration: email + password (Google account) + contact phone.
 * Email is the login identity; phone is what customers tap to call.
 */
export async function registerShopOwner({
  phone,
  password,
  full_name,
  shop_name,
  email,
  timezone,
  whatsapp_phone,
  site_url,
  google_sub = null,
  otp_verified = false,
}) {
  const normalizedPhone = assertAllowedPhone(requirePhone(phone));
  const normalizedEmail = assertEmail(email);
  if (password) assertStrongPassword(password);
  else if (!google_sub) throw badRequest('La contraseña es obligatoria', { code: 'password_required' });

  if (!full_name || String(full_name).trim().length < 2) {
    throw badRequest('El nombre es obligatorio', { code: 'name_required' });
  }
  if (!shop_name || String(shop_name).trim().length < 2) {
    throw badRequest('El nombre del taller es obligatorio', { code: 'shop_name_required' });
  }

  if (await findUserByEmail(normalizedEmail)) {
    throw conflict('Ese correo ya está registrado. Inicia sesión.', { code: 'email_taken' });
  }
  if (await findUserByPhone(normalizedPhone)) {
    throw conflict('Ese teléfono ya está registrado. Inicia sesión.', { code: 'phone_taken' });
  }
  if (google_sub && (await findUserByGoogleSub(google_sub))) {
    throw conflict('Esa cuenta de Google ya está vinculada. Inicia sesión.', { code: 'google_taken' });
  }

  return transaction(async (client) => {
    const passwordHash = password ? await hashPassword(password) : null;
    const user = await client
      .query(
        `INSERT INTO users (phone, password_hash, full_name, email, role, whatsapp_phone, phone_verified_at, google_sub, locale)
         VALUES ($1, $2, $3, $4, 'shop_owner', $5, $6, $7, 'es') RETURNING *`,
        [
          normalizedPhone,
          passwordHash,
          String(full_name).trim(),
          normalizedEmail,
          normalizePhone(whatsapp_phone) ?? normalizedPhone,
          otp_verified || google_sub ? new Date() : null,
          google_sub,
        ],
      )
      .then(({ rows }) => rows[0]);

    const shop = await createShop(client, {
      name: String(shop_name).trim(),
      timezone,
      phone: normalizedPhone,
      whatsapp_phone: normalizePhone(whatsapp_phone) ?? normalizedPhone,
      email: normalizedEmail,
      site_url: site_url ?? null,
    });

    await client.query(
      `INSERT INTO shop_members (shop_id, user_id, role, is_primary) VALUES ($1, $2, 'owner', true)`,
      [shop.id, user.id],
    );

    return { user, shop };
  });
}

/**
 * Finds or creates a session for a verified Google profile.
 * New owners must still send shop_name + phone to finish registration.
 */
export async function authenticateWithGoogle(profile, registration = {}) {
  let user = (await findUserByGoogleSub(profile.sub)) ?? (await findUserByEmail(profile.email));

  if (user) {
    if (user.status !== 'active') throw forbidden('Esta cuenta está suspendida', { code: 'account_suspended' });
    if (!user.google_sub) {
      await query('UPDATE users SET google_sub = $2 WHERE id = $1 AND google_sub IS NULL', [user.id, profile.sub]);
      user = await findUserById(user.id);
    }
    return { user, created: false };
  }

  const shopName = registration.shop_name?.trim();
  const phone = registration.phone;
  const fullName = registration.full_name?.trim() || profile.name || profile.email.split('@')[0];
  if (!shopName || !phone) {
    return {
      user: null,
      created: false,
      needs_registration: true,
      profile: { email: profile.email, name: profile.name, sub: profile.sub },
    };
  }

  const { user: created } = await registerShopOwner({
    email: profile.email,
    phone,
    full_name: fullName,
    shop_name: shopName,
    timezone: registration.timezone,
    google_sub: profile.sub,
    password: registration.password || null,
  });
  return { user: created, created: true };
}

export async function verifyPassword(user, password) {
  if (!user?.password_hash || typeof password !== 'string') return false;
  const matches = await bcrypt.compare(password, user.password_hash);
  return matches;
}

/** Password login. Generic error message on purpose: no account enumeration. */
export async function authenticate(identifier, password) {
  const user = await findUserByIdentifier(identifier);
  const ok = await verifyPassword(user, password);
  if (!user || !ok) {
    throw unauthorized('Correo o contraseña incorrectos', { code: 'invalid_credentials' });
  }
  if (user.status !== 'active') throw forbidden('Esta cuenta está suspendida', { code: 'account_suspended' });
  return user;
}

export async function createSession(user, { userAgent, ip } = {}) {
  const sessionId = randomToken(16);
  const token = jwt.sign({ sub: user.id, role: user.role, sid: sessionId }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
    issuer: 'derteapp',
  });
  const { exp } = jwt.decode(token);

  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5))`,
    [user.id, sha256(token), userAgent ?? null, ip ?? null, exp],
  );
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

  return { token, expires_at: new Date(exp * 1000).toISOString() };
}

/** Verifies the JWT and confirms the session row is still live. */
export async function resolveSession(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret, { issuer: 'derteapp' });
  } catch {
    return null;
  }

  const session = await queryOne(
    `SELECT id FROM sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  if (!session) return null;

  const user = await findUserById(payload.sub);
  if (!user || user.status !== 'active') return null;
  return { user, payload };
}

export const revokeSession = (token) =>
  query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);

export const revokeAllSessions = (userId) =>
  query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);

// --- One-time passcodes ------------------------------------------------------

/**
 * Issues an OTP for a phone number. Rate limited to one code per 45 seconds.
 * The plaintext code is only returned when OTP_DEBUG is on (development) - in
 * production wire `deliver` to an SMS/voice provider.
 */
export async function issueOtp(phone, purpose = 'login') {
  const normalizedPhone = assertAllowedPhone(requirePhone(phone));
  if (!['register', 'login', 'reset'].includes(purpose)) throw badRequest('Unsupported OTP purpose');

  const recent = await queryOne(
    `SELECT created_at FROM otp_codes
      WHERE phone = $1 AND purpose = $2 AND created_at > now() - interval '45 seconds'
      ORDER BY created_at DESC LIMIT 1`,
    [normalizedPhone, purpose],
  );
  if (recent) throw tooManyRequests('A code was just sent. Please wait a moment before asking for another.');

  const code = numericCode(config.otp.length);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [normalizedPhone, sha256(code), purpose, String(config.otp.ttlSeconds)],
  );

  // `code` is for delivery only. The route decides whether it may also be
  // echoed back to the client (development), and never does so otherwise.
  return { phone: normalizedPhone, purpose, expires_in: config.otp.ttlSeconds, code };
}

export async function verifyOtp(phone, code, purpose = 'login') {
  const normalizedPhone = requirePhone(phone);
  const record = await queryOne(
    `SELECT * FROM otp_codes
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [normalizedPhone, purpose],
  );

  if (!record) throw badRequest('No active code for this number. Request a new one.', { code: 'otp_not_found' });
  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw badRequest('That code has expired. Request a new one.', { code: 'otp_expired' });
  }
  if (record.attempts >= config.otp.maxAttempts) {
    throw tooManyRequests('Too many incorrect attempts. Request a new code.', { code: 'otp_locked' });
  }

  if (!safeEqual(sha256(String(code ?? '').trim()), record.code_hash)) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
    throw badRequest('That code is not correct', { code: 'otp_invalid' });
  }

  await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [record.id]);
  return { phone: normalizedPhone, purpose };
}
