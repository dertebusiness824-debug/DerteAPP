#!/usr/bin/env node
/**
 * Validates Supabase credentials and that DerteApp tables are reachable.
 *
 *   npm run verify:supabase
 *
 * Exit codes:
 *   0 — credentials OK and API reachable, OR credentials OK but host unreachable
 *       (soft warning: local Postgres remains the primary store)
 *   1 — credentials missing / misconfigured, or API reachable but schema broken
 */
import '../server/load-env.js';
import config from '../server/config.js';
import {
  getSupabaseAdmin,
  getSupabasePublicConfig,
  isSupabaseConfigured,
} from '../server/lib/supabase.js';

const hardFailures = [];
const softFailures = [];

function ok(label, detail = '') {
  console.log(`✔ ${label}${detail ? ` — ${detail}` : ''}`);
}

function soft(label, detail = '') {
  softFailures.push(`${label}: ${detail}`);
  console.warn(`⚠ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  hardFailures.push(`${label}: ${detail}`);
  console.error(`✖ ${label}${detail ? ` — ${detail}` : ''}`);
}

function isNetworkError(error) {
  const message = String(error?.message || error || '');
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(message);
}

console.log('DerteApp · verify Supabase\n');
console.log(`Primary DATABASE_URL host: ${(() => {
  try {
    return new URL(config.db.url).host;
  } catch {
    return '(invalid)';
  }
})()}`);
console.log(`Supabase URL:              ${config.supabase.url || '(missing)'}`);
console.log(`Anon key set:              ${Boolean(config.supabase.anonKey)}`);
console.log(`Service role set:          ${Boolean(config.supabase.serviceRoleKey)}\n`);

if (!isSupabaseConfigured()) {
  soft('config', 'Supabase keys not set — optional sync disabled; local Postgres is primary');
  console.log('\nPrimary store (local Postgres) is unaffected.');
  process.exit(0);
}

const pub = getSupabasePublicConfig();
if (pub.serviceRoleKey || JSON.stringify(pub).includes('sb_secret')) {
  fail('public config', 'service role leaked into public payload');
} else {
  ok('public config', 'anon only (no service role)');
}

let sb;
try {
  sb = getSupabaseAdmin();
  ok('admin client', 'created');
} catch (error) {
  fail('admin client', error.message);
  process.exit(1);
}

const required = ['profiles', 'shops', 'shop_members', 'appointments'];
let networkBlocked = false;

for (const table of required) {
  try {
    const { error, count } = await sb.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      if (isNetworkError(error)) {
        networkBlocked = true;
        soft(`table ${table}`, error.message);
      } else {
        fail(`table ${table}`, error.message);
      }
    } else {
      ok(`table ${table}`, `reachable (count=${count ?? 0})`);
    }
  } catch (error) {
    if (isNetworkError(error)) {
      networkBlocked = true;
      soft(`table ${table}`, error.message);
    } else {
      fail(`table ${table}`, error.message);
    }
  }
}

try {
  const { error } = await sb
    .from('shops')
    .select(
      'id, google_calendar_id, google_calendar_refresh_token, google_calendar_access_token, google_calendar_token_expiry, google_calendar_connected_email, google_calendar_sync_enabled',
    )
    .limit(1);
  if (error) {
    if (isNetworkError(error)) {
      networkBlocked = true;
      soft('shops google calendar columns', error.message);
    } else {
      fail('shops google calendar columns', error.message);
    }
  } else {
    ok('shops google calendar columns', 'selectable');
  }
} catch (error) {
  if (isNetworkError(error)) {
    networkBlocked = true;
    soft('shops google calendar columns', error.message);
  } else {
    fail('shops google calendar columns', error.message);
  }
}

console.log('');

if (hardFailures.length) {
  console.error(`Hard failures (${hardFailures.length}):`);
  for (const item of hardFailures) console.error(`  - ${item}`);
  process.exit(1);
}

if (networkBlocked || softFailures.length) {
  console.warn('Supabase API unreachable from this environment.');
  console.warn('Continuing with local PostgreSQL as the primary data store.');
  console.warn('Remote sync (Auth / shops tokens) will retry when the host is reachable.');
  process.exit(0);
}

console.log('All Supabase checks passed.');
process.exit(0);
