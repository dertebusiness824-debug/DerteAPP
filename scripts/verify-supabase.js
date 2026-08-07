#!/usr/bin/env node
/**
 * Validates Supabase credentials and that DerteApp tables are reachable.
 *
 *   npm run verify:supabase
 */
import '../server/load-env.js';
import config from '../server/config.js';
import {
  getSupabaseAdmin,
  getSupabasePublicConfig,
  isSupabaseConfigured,
} from '../server/lib/supabase.js';

const failures = [];

function ok(label, detail = '') {
  console.log(`✔ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  failures.push(`${label}: ${detail}`);
  console.error(`✖ ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('DerteApp · verify Supabase\n');
console.log(`DATABASE_URL host: ${(() => {
  try {
    return new URL(config.db.url).host;
  } catch {
    return '(invalid)';
  }
})()}`);
console.log(`Supabase URL:      ${config.supabase.url || '(missing)'}`);
console.log(`Anon key set:      ${Boolean(config.supabase.anonKey)}`);
console.log(`Service role set:  ${Boolean(config.supabase.serviceRoleKey)}\n`);

if (!isSupabaseConfigured()) {
  fail('config', 'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
  process.exit(1);
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
for (const table of required) {
  try {
    const { error, count } = await sb.from(table).select('*', { count: 'exact', head: true });
    if (error) fail(`table ${table}`, error.message);
    else ok(`table ${table}`, `reachable (count=${count ?? 0})`);
  } catch (error) {
    fail(`table ${table}`, error.message);
  }
}

try {
  const { error } = await sb
    .from('shops')
    .select(
      'id, google_calendar_id, google_calendar_refresh_token, google_calendar_access_token, google_calendar_token_expiry, google_calendar_connected_email, google_calendar_sync_enabled',
    )
    .limit(1);
  if (error) fail('shops google calendar columns', error.message);
  else ok('shops google calendar columns', 'selectable');
} catch (error) {
  fail('shops google calendar columns', error.message);
}

console.log('');
if (failures.length) {
  console.error(`Failed (${failures.length}):`);
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(1);
}

console.log('All Supabase checks passed.');
process.exit(0);
