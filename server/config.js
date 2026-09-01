import './load-env.js';
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

// Prefer DATABASE_URL for the app pool. DIRECT_URL (Supabase/Prisma-style) is
// the non-pooled connection used for migrations when both are set.
const databaseUrl =
  (isTest ? process.env.TEST_DATABASE_URL : null) ??
  process.env.DATABASE_URL ??
  process.env.DIRECT_URL ??
  'postgres://postgres:postgres@127.0.0.1:5432/derteapp';

const directDatabaseUrl =
  (isTest ? process.env.TEST_DATABASE_URL : null) ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  databaseUrl;

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  // Ephemeral secret keeps local development running; every restart invalidates
  // existing sessions, which is fine outside production.
  jwtSecret = crypto.randomBytes(48).toString('base64url');
}

/** Canonical DerteApp bootstrap Super Admin (overridable via SUPER_ADMIN_*). */
export const DEFAULT_SUPER_ADMIN = {
  email: 'dertebusiness824@gmail.com',
  password: 'Marron1*',
  phone: '+34605686509',
  name: 'Super Admin',
};

export const config = {
  env,
  isProduction,
  isTest,
  appName: process.env.APP_NAME ?? 'DerteApp',
  appUrl: (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  port: int(process.env.PORT, 3000),

  db: {
    url: databaseUrl,
    /** Direct (non-pooled) URL for DDL / migrations. */
    directUrl: directDatabaseUrl,
    ssl: ['require', 'true', '1'].includes(String(process.env.DATABASE_SSL ?? '').toLowerCase())
      ? { rejectUnauthorized: false }
      : false,
    poolMax: int(process.env.DATABASE_POOL_MAX, 25),
    /** Kill hung queries so a stuck statement cannot pin a pool client. */
    statementTimeoutMs: int(process.env.DATABASE_STATEMENT_TIMEOUT_MS, 15_000),
  },

  auth: {
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
    cookieName: 'derte_session',
    bcryptRounds: isTest ? 4 : 12,
  },

  google: {
    // Google Identity Services (Sign in with Google) web Client ID.
    clientId: (process.env.GOOGLE_CLIENT_ID ?? '').trim(),
    get configured() {
      return Boolean(this.clientId);
    },
  },

  googleCalendar: {
    // OAuth2 web client for Calendar API (can reuse GIS client id + secret).
    clientId: (
      process.env.GOOGLE_CALENDAR_CLIENT_ID ??
      process.env.GOOGLE_CLIENT_ID ??
      ''
    ).trim(),
    clientSecret: (
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET ??
      process.env.GOOGLE_CLIENT_SECRET ??
      ''
    ).trim(),
    redirectUri: (
      process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
      `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/shops/google-calendar/callback`
    ).trim(),
    // Optional service-account fallback: shops share their calendar with this email.
    serviceAccountEmail: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim(),
    serviceAccountPrivateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '')
      .replace(/\\n/g, '\n')
      .trim(),
    get oauthConfigured() {
      return Boolean(this.clientId && this.clientSecret);
    },
    get serviceAccountConfigured() {
      return Boolean(this.serviceAccountEmail && this.serviceAccountPrivateKey);
    },
    get configured() {
      return this.oauthConfigured || this.serviceAccountConfigured;
    },
  },

  cors: {
    origins: list(process.env.CORS_ORIGINS),
  },

  rateLimit: {
    // Off by default under NODE_ENV=test so suites can hammer the auth routes.
    disabled: bool(process.env.RATE_LIMIT_DISABLED, isTest),
  },

  webhooks: {
    // Shared ingest cap for Retell + Cal.com background work (3–5).
    ingestConcurrency: Math.min(5, Math.max(3, int(process.env.WEBHOOK_INGEST_CONCURRENCY, 4))),
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
    // Defaults keep Render/local bootstraps working without manual seed.
    // Override any field with SUPER_ADMIN_* in the environment.
    phone: (process.env.SUPER_ADMIN_PHONE ?? DEFAULT_SUPER_ADMIN.phone).trim(),
    email: (process.env.SUPER_ADMIN_EMAIL ?? DEFAULT_SUPER_ADMIN.email).trim().toLowerCase(),
    password: process.env.SUPER_ADMIN_PASSWORD ?? DEFAULT_SUPER_ADMIN.password,
    name: process.env.SUPER_ADMIN_NAME ?? DEFAULT_SUPER_ADMIN.name,
    /** True when SUPER_ADMIN_PASSWORD was set explicitly (not only the code default). */
    passwordFromEnv: Boolean(process.env.SUPER_ADMIN_PASSWORD),
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

  retell: {
    // Retell signs webhooks with the API key itself; RETELL_WEBHOOK_SECRET is
    // only needed if you rotate a dedicated signing key.
    apiKey: process.env.RETELL_API_KEY ?? '',
    webhookSecret: process.env.RETELL_WEBHOOK_SECRET ?? process.env.RETELL_API_KEY ?? '',
    verifyWebhooks: bool(process.env.RETELL_VERIFY_WEBHOOKS, true),
    // Fallback tenant for single-shop deployments where the agent sends no
    // routing hints. Leave empty on multi-tenant installs.
    defaultShopId: process.env.RETELL_DEFAULT_SHOP_ID ?? '',
    // Dedicated receptionist for DerteApp sales (Super Admin → CLIENTES).
    platformAgentId: (process.env.RETELL_PLATFORM_AGENT_ID ?? '').trim(),
    platformDid: (process.env.RETELL_PLATFORM_DID ?? '').trim(),
    get configured() {
      return Boolean(this.webhookSecret);
    },
  },

  /**
   * Web Push (VAPID). Required for iOS/Android PWA alerts such as nueva urgencia.
   * Generate with: npx web-push generate-vapid-keys
   */
  webPush: {
    publicKey: (process.env.VAPID_PUBLIC_KEY || '').trim(),
    privateKey: (process.env.VAPID_PRIVATE_KEY || '').trim(),
    subject: (() => {
      let subject = (process.env.VAPID_SUBJECT || process.env.APP_URL || 'mailto:dertebusiness824@gmail.com').trim();
      // Common typo from dashboards: mailto@email → mailto:email
      if (/^mailto@/i.test(subject)) subject = `mailto:${subject.slice('mailto@'.length)}`;
      else if (subject && !/^mailto:/i.test(subject) && !/^https?:\/\//i.test(subject) && subject.includes('@')) {
        subject = `mailto:${subject}`;
      }
      return subject;
    })(),
    get configured() {
      return Boolean(this.publicKey && this.privateKey);
    },
  },

  /**
   * Cal.com API — block slots when accepting Urgencias.
   * Primary env names: CAL_API_KEY + CAL_EVENT_TYPE_ID (CALCOM_* aliases also work).
   * Default API is v1 (start/end + responses) as used by most Cal.com installs.
   */
  calcom: {
    apiKey: (process.env.CAL_API_KEY || process.env.CALCOM_API_KEY || '').trim(),
    apiUrl: (process.env.CAL_API_URL || process.env.CALCOM_API_URL || 'https://api.cal.com')
      .trim()
      .replace(/\/$/, ''),
    apiVersion: (() => {
      const raw = (process.env.CAL_API_VERSION || process.env.CALCOM_API_VERSION || 'v1')
        .trim()
        .toLowerCase();
      return raw === 'v2' ? 'v2' : 'v1';
    })(),
    apiVersionHeader: (
      process.env.CALCOM_API_VERSION_HEADER ||
      process.env.CAL_API_VERSION_HEADER ||
      '2024-08-13'
    ).trim(),
    eventTypeId: (() => {
      const raw = (process.env.CAL_EVENT_TYPE_ID || process.env.CALCOM_EVENT_TYPE_ID || '').trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    })(),
    eventTypeSlug: (process.env.CALCOM_EVENT_TYPE_SLUG || process.env.CAL_EVENT_TYPE_SLUG || '').trim(),
    username: (process.env.CALCOM_USERNAME || process.env.CAL_USERNAME || '').trim(),
    timeZone: (
      process.env.CAL_TIMEZONE ||
      process.env.CALCOM_TIMEZONE ||
      'Atlantic/Canary'
    ).trim(),
    defaultAttendeeEmail: (
      process.env.CAL_DEFAULT_ATTENDEE_EMAIL ||
      process.env.CALCOM_DEFAULT_ATTENDEE_EMAIL ||
      'sin-email@derteapp.com'
    ).trim(),
    webhookSecret: (
      process.env.CAL_WEBHOOK_SECRET ||
      process.env.CALCOM_WEBHOOK_SECRET ||
      ''
    ).trim(),
    get configured() {
      return Boolean(this.apiKey && this.eventTypeId);
    },
  },

  /**
   * Assistant model used by the diagnostic helper and by photo recognition.
   * Any OpenAI-compatible /chat/completions endpoint works. Without a key the
   * server answers from its own rule base instead of failing.
   */
  ai: {
    apiKey: (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim(),
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, ''),
    model: (process.env.AI_MODEL || 'gpt-4o-mini').trim(),
    visionModel: (process.env.AI_VISION_MODEL || process.env.AI_MODEL || 'gpt-4o-mini').trim(),
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 20_000),
    get configured() {
      return Boolean(this.apiKey);
    },
  },

  /**
   * APIVehículo (apivehiculo.com) — official plate → vehicle lookup.
   * Server-only. Super Admin Ajustes can override the env key; workshop
   * “Identificar vehículo” consumes the same credential without exposing it.
   *
   * Names accepted, in order: API_VEHICULO_KEY, then APIVEHICULO_API_KEY.
   */
  apivehiculo: {
    get apiKey() {
      return (process.env.API_VEHICULO_KEY || process.env.APIVEHICULO_API_KEY || '').trim();
    },
    get url() {
      // Marketing copy says /v1/lookup; the live API serves GET /v1/vehicles/lookup.
      return (process.env.API_VEHICULO_URL || 'https://api.apivehiculo.com/v1/vehicles/lookup').trim();
    },
    get country() {
      return (process.env.API_VEHICULO_COUNTRY || 'ES').trim() || 'ES';
    },
    timeoutMs: int(process.env.API_VEHICULO_TIMEOUT_MS, 8000),
    get configured() {
      return Boolean(this.apiKey);
    },
  },

  /**
   * Supabase project credentials.
   * Public URL + anon/publishable key may be sent to the browser.
   * Service role stays server-only (never expose via /api/public/*).
   */
  mail: {
    from: (process.env.MAIL_FROM || process.env.SMTP_FROM || '').trim(),
    resendApiKey: (process.env.RESEND_API_KEY || '').trim(),
    smtpUrl: (process.env.SMTP_URL || '').trim(),
    get configured() {
      return Boolean(
        this.resendApiKey ||
          this.smtpUrl ||
          (process.env.SMTP_HOST && process.env.SMTP_USER),
      );
    },
  },

  supabase: {
    url: (
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      ''
    ).trim().replace(/\/$/, ''),
    anonKey: (
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ''
    ).trim(),
    serviceRoleKey: (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      ''
    ).trim(),
    get configured() {
      return Boolean(this.url && this.anonKey);
    },
    get adminConfigured() {
      return Boolean(this.url && this.serviceRoleKey);
    },
  },
};

export default config;
