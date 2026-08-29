/**
 * Global Zadarma + Retell credentials for Super Admin CLIENTES lead capture.
 * Stored in platform_settings (same table as the Matriculas.org key). Env vars
 * remain the fallback so existing .env installs keep working.
 */
import config from '../config.js';
import { query, queryOne } from '../db/index.js';

export const KEYS = {
  zadarmaKey: 'zadarma_api_key',
  zadarmaSecret: 'zadarma_api_secret',
  zadarmaSip: 'zadarma_sip',
  zadarmaDid: 'zadarma_did',
  retellApiKey: 'retell_api_key',
  retellWebhookSecret: 'retell_webhook_secret',
  retellAgentId: 'retell_platform_agent_id',
  retellDid: 'retell_platform_did',
};

const stored = {
  zadarmaKey: '',
  zadarmaSecret: '',
  zadarmaSip: '',
  zadarmaDid: '',
  retellApiKey: '',
  retellWebhookSecret: '',
  retellAgentId: '',
  retellDid: '',
};

let hydrated = false;

const trim = (value) => String(value ?? '').trim();

async function readSetting(key) {
  const row = await queryOne('SELECT value FROM platform_settings WHERE key = $1', [key]);
  return trim(row?.value);
}

export async function hydratePlatformTelephony() {
  try {
    stored.zadarmaKey = await readSetting(KEYS.zadarmaKey);
    stored.zadarmaSecret = await readSetting(KEYS.zadarmaSecret);
    stored.zadarmaSip = await readSetting(KEYS.zadarmaSip);
    stored.zadarmaDid = await readSetting(KEYS.zadarmaDid);
    stored.retellApiKey = await readSetting(KEYS.retellApiKey);
    stored.retellWebhookSecret = await readSetting(KEYS.retellWebhookSecret);
    stored.retellAgentId = await readSetting(KEYS.retellAgentId);
    stored.retellDid = await readSetting(KEYS.retellDid);
  } catch {
    // Migrations may not have run yet in some boot paths.
  }
  hydrated = true;
  return snapshot();
}

async function writeSetting(key, value, userId) {
  await query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
    [key, value, userId],
  );
}

/** Empty strings are no-ops so Ajustes can save one field without wiping others. */
export async function savePlatformTelephony(fields = {}, { userId = null } = {}) {
  await hydratePlatformTelephony();
  const next = {
    zadarmaKey: trim(fields.zadarma_key),
    zadarmaSecret: trim(fields.zadarma_secret),
    zadarmaSip: trim(fields.zadarma_sip),
    zadarmaDid: trim(fields.zadarma_did),
    retellApiKey: trim(fields.retell_api_key),
    retellWebhookSecret: trim(fields.retell_webhook_secret),
    retellAgentId: trim(fields.retell_agent_id),
    retellDid: trim(fields.retell_did),
  };
  const writes = [];
  if (next.zadarmaKey) writes.push(['zadarmaKey', KEYS.zadarmaKey, next.zadarmaKey]);
  if (next.zadarmaSecret) writes.push(['zadarmaSecret', KEYS.zadarmaSecret, next.zadarmaSecret]);
  if (Object.prototype.hasOwnProperty.call(fields, 'zadarma_sip') && next.zadarmaSip) {
    writes.push(['zadarmaSip', KEYS.zadarmaSip, next.zadarmaSip]);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'zadarma_did') && next.zadarmaDid) {
    writes.push(['zadarmaDid', KEYS.zadarmaDid, next.zadarmaDid]);
  }
  if (next.retellApiKey) writes.push(['retellApiKey', KEYS.retellApiKey, next.retellApiKey]);
  if (next.retellWebhookSecret) {
    writes.push(['retellWebhookSecret', KEYS.retellWebhookSecret, next.retellWebhookSecret]);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'retell_agent_id') && next.retellAgentId) {
    writes.push(['retellAgentId', KEYS.retellAgentId, next.retellAgentId]);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'retell_did') && next.retellDid) {
    writes.push(['retellDid', KEYS.retellDid, next.retellDid]);
  }

  for (const [storeKey, dbKey, value] of writes) {
    await writeSetting(dbKey, value, userId);
    stored[storeKey] = value;
  }

  return { unchanged: writes.length === 0, ...(await publicStatus()) };
}

function snapshot() {
  return { ...stored };
}

export function effectiveZadarmaKey() {
  return stored.zadarmaKey || trim(config.zadarma.key);
}

export function effectiveZadarmaSecret() {
  return stored.zadarmaSecret || trim(config.zadarma.secret);
}

export function effectiveZadarmaSip() {
  return stored.zadarmaSip || trim(config.zadarma.defaultSip);
}

export function effectiveZadarmaDid() {
  return stored.zadarmaDid;
}

export function effectiveZadarmaCredentials() {
  const key = effectiveZadarmaKey();
  const secret = effectiveZadarmaSecret();
  if (!key || !secret) return null;
  return {
    key,
    secret,
    source: stored.zadarmaKey || stored.zadarmaSecret ? 'platform' : 'env',
  };
}

export function effectiveRetellApiKey() {
  return stored.retellApiKey || trim(config.retell.apiKey);
}

export function effectiveRetellWebhookSecret() {
  return stored.retellWebhookSecret || stored.retellApiKey || trim(config.retell.webhookSecret);
}

export function effectivePlatformAgentId() {
  return stored.retellAgentId || trim(config.retell.platformAgentId);
}

export function effectivePlatformDid() {
  return stored.retellDid || trim(config.retell.platformDid);
}

export function zadarmaConfigured() {
  return Boolean(effectiveZadarmaKey() && effectiveZadarmaSecret());
}

export function retellConfigured() {
  return Boolean(effectiveRetellWebhookSecret());
}

export function platformRouteConfigured() {
  return Boolean(effectivePlatformAgentId() || effectivePlatformDid());
}

/** Voice receptionist can accept CLIENTES calls when trunk + Retell route exist. */
export function assistantOnline() {
  return zadarmaConfigured() && retellConfigured() && platformRouteConfigured();
}

export async function lastPlatformLeadAt() {
  const row = await queryOne(
    `SELECT COALESCE(called_at, created_at) AS at
       FROM platform_leads
      ORDER BY COALESCE(called_at, created_at) DESC
      LIMIT 1`,
  );
  return row?.at ?? null;
}

export async function publicStatus() {
  await hydratePlatformTelephony();
  const lastLeadAt = await lastPlatformLeadAt().catch(() => null);
  const pending = await queryOne(`SELECT count(*)::int AS n FROM platform_leads WHERE status = 'pending'`).catch(
    () => ({ n: 0 }),
  );
  const online = assistantOnline();
  return {
    assistant_online: online,
    assistant_status: online ? 'online' : 'offline',
    follow_up_minutes: 40,
    pending_leads: pending?.n ?? 0,
    last_lead_at: lastLeadAt,
    zadarma: {
      configured: zadarmaConfigured(),
      sip: effectiveZadarmaSip() || null,
      did: effectiveZadarmaDid() || null,
      sip_set: Boolean(effectiveZadarmaSip()),
      did_set: Boolean(effectiveZadarmaDid()),
      key_set: Boolean(effectiveZadarmaKey()),
      secret_set: Boolean(effectiveZadarmaSecret()),
      webhook_url: `${config.appUrl}/api/telephony/webhooks/zadarma`,
    },
    retell: {
      configured: retellConfigured(),
      key_set: Boolean(effectiveRetellApiKey()),
      platform_agent_id: effectivePlatformAgentId() || null,
      platform_did: effectivePlatformDid() || null,
      platform_agent_set: Boolean(effectivePlatformAgentId()),
      platform_did_set: Boolean(effectivePlatformDid()),
      webhook_url: `${config.appUrl}/api/webhooks/retell`,
    },
  };
}

/** Test helper: wipe the in-memory cache. */
export function resetPlatformTelephonyCache() {
  for (const key of Object.keys(stored)) stored[key] = '';
  hydrated = false;
}
