import 'dotenv/config';
import crypto from 'node:crypto';

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const env = process.env.NODE_ENV ?? 'development';
const isProduction = env === 'production';
const isTest = env === 'test';

const databaseUrl =
  (isTest ? process.env.TEST_DATABASE_URL : null) ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@127.0.0.1:5432/derteapp';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  // Ephemeral secret keeps local development running; every restart invalidates
  // existing sessions, which is fine outside production.
  jwtSecret = crypto.randomBytes(48).toString('base64url');
}

export const config = {
  env,
  isProduction,
  isTest,
  appName: process.env.APP_NAME ?? 'DerteApp',
  appUrl: (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  port: int(process.env.PORT, 3000),

  db: {
    url: databaseUrl,
    ssl: ['require', 'true', '1'].includes(String(process.env.DATABASE_SSL ?? '').toLowerCase())
      ? { rejectUnauthorized: false }
      : false,
    poolMax: int(process.env.DATABASE_POOL_MAX, 10),
  },

  auth: {
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
    cookieName: 'derte_session',
    bcryptRounds: isTest ? 4 : 12,
  },

  cors: {
    origins: list(process.env.CORS_ORIGINS),
  },

  otp: {
    debug: bool(process.env.OTP_DEBUG, !isProduction),
    ttlSeconds: int(process.env.OTP_TTL_SECONDS, 300),
    length: Math.min(Math.max(int(process.env.OTP_LENGTH, 6), 4), 8),
    maxAttempts: 5,
  },

  registration: {
    allowSelfRegistration: bool(process.env.ALLOW_SELF_REGISTRATION, true),
    allowedPhonePrefixes: list(process.env.ALLOWED_PHONE_PREFIXES),
  },

  superAdmin: {
    phone: process.env.SUPER_ADMIN_PHONE ?? '',
    password: process.env.SUPER_ADMIN_PASSWORD ?? '',
    name: process.env.SUPER_ADMIN_NAME ?? 'Super Admin',
  },

  shopDefaults: {
    timezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Madrid',
    slotMinutes: int(process.env.DEFAULT_SLOT_MINUTES, 60),
    capacity: int(process.env.DEFAULT_CAPACITY, 2),
  },

  zadarma: {
    key: process.env.ZADARMA_KEY ?? '',
    secret: process.env.ZADARMA_SECRET ?? '',
    apiUrl: (process.env.ZADARMA_API_URL ?? 'https://api.zadarma.com').replace(/\/$/, ''),
    defaultSip: process.env.ZADARMA_DEFAULT_SIP ?? '',
    verifyWebhooks: bool(process.env.ZADARMA_VERIFY_WEBHOOKS, true),
    get configured() {
      return Boolean(this.key && this.secret);
    },
  },
};

export default config;
