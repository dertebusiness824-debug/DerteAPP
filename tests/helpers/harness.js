import { once } from 'node:events';
import { createApp } from '../../server/app.js';
import { closePool, query } from '../../server/db/index.js';

const TABLES = [
  'audit_log',
  'notifications',
  'push_subscriptions',
  'site_events',
  'call_logs',
  'chat_messages',
  'chat_threads',
  'appointments',
  'schedule_exceptions',
  'business_hours',
  'otp_codes',
  'sessions',
  'matriculas_lookups',
  'shop_members',
  'users',
  'shops',
];

export const resetDatabase = () =>
  query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);

/** Boots the real Express app on an ephemeral port and returns a tiny client. */
export async function startTestServer() {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function request(method, path, { token, cookie, body, headers = {}, form = false } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (cookie) init.headers.cookie = cookie;
    if (body !== undefined) {
      if (form) {
        init.headers['content-type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(body).toString();
      } else if (typeof body === 'string') {
        // Already serialized: keep the exact bytes so webhook signatures match.
        init.headers['content-type'] = init.headers['content-type'] ?? 'application/json';
        init.body = body;
      } else {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }
    const response = await fetch(`${base}${path}`, init);
    const raw = await response.text();
    let payload = raw;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      // Non-JSON responses (the zd_echo handshake) are returned as text.
    }
    return { status: response.status, body: payload, headers: response.headers };
  }

  return {
    base,
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
    del: (path, options) => request('DELETE', path, options),
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

export const closeDatabase = closePool;

let phoneCounter = 0;
let emailCounter = 0;
/** Unique, valid E.164 test number. */
export const testPhone = () => `+3460${String(1_000_000 + (phoneCounter += 1)).slice(-7)}`;
/** Unique test email (Google-style). */
export const testEmail = () => `owner${(emailCounter += 1)}.test@gmail.com`;

/** Registers a shop owner (email + password + contact phone) and returns session. */
export async function createOwner(client, overrides = {}) {
  const phone = overrides.phone ?? testPhone();
  const email = overrides.email ?? testEmail();
  const password = overrides.password ?? 'TestPass123';
  const response = await client.post('/api/auth/register', {
    email,
    phone,
    password,
    full_name: overrides.full_name ?? 'Test Owner',
    shop_name: overrides.shop_name ?? 'Test Garage',
    timezone: overrides.timezone ?? 'Europe/Madrid',
  });
  if (response.status !== 201) {
    throw new Error(`createOwner failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    token: response.body.token,
    user: response.body.user,
    shop: response.body.user.shops[0],
    phone,
    email,
    password,
  };
}

/** Creates the Super Admin and signs in. */
export async function createSuperAdmin(client) {
  const { ensureSuperAdmin } = await import('../../server/db/seed.js');
  const user = await ensureSuperAdmin();
  // Prefer the email when one is configured: that is how the Super Admin signs in.
  const response = await client.post('/api/auth/login', {
    identifier: process.env.SUPER_ADMIN_EMAIL || process.env.SUPER_ADMIN_PHONE,
    password: process.env.SUPER_ADMIN_PASSWORD,
  });
  if (response.status !== 200) {
    throw new Error(`super admin login failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { token: response.body.token, user, cookie: firstCookie(response.headers) };
}

function firstCookie(headers) {
  const raw = headers.getSetCookie?.()?.[0] ?? headers.get('set-cookie');
  if (!raw) return null;
  return String(raw).split(';')[0];
}

/** Next occurrence of `weekday` (0 = Sunday), as `YYYY-MM-DD`, at least 2 days out. */
export function nextWeekday(weekday, { minDaysAhead = 2 } = {}) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + minDaysAhead);
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}
