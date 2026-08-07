import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSupabasePublicConfig, isSupabaseConfigured } from '../../server/lib/supabase.js';
import config from '../../server/config.js';

describe('Supabase public config', () => {
  it('never includes the service role key in the browser payload', () => {
    const pub = getSupabasePublicConfig();

    assert.equal(typeof pub.configured, 'boolean');
    assert.ok('url' in pub);
    assert.ok('anonKey' in pub);
    assert.ok('NEXT_PUBLIC_SUPABASE_URL' in pub);
    assert.ok('NEXT_PUBLIC_SUPABASE_ANON_KEY' in pub);

    // Service role must stay server-only.
    assert.equal(pub.serviceRoleKey, undefined);
    assert.equal(pub.SUPABASE_SERVICE_ROLE_KEY, undefined);
    const serialized = JSON.stringify(pub);
    assert.equal(serialized.includes('sb_secret'), false);
    assert.equal(serialized.includes('SERVICE_ROLE'), false);

    if (isSupabaseConfigured()) {
      assert.equal(pub.configured, true);
      assert.equal(pub.url, config.supabase.url);
      assert.equal(pub.anonKey, config.supabase.anonKey);
      assert.ok(pub.anonKey);
      assert.ok(!String(pub.anonKey).includes('secret'));
    }
  });

  it('keeps the service role only on the server config object', () => {
    // Presence is fine server-side; the public helper must not mirror it.
    if (config.supabase.adminConfigured) {
      assert.ok(config.supabase.serviceRoleKey.startsWith('sb_secret') || config.supabase.serviceRoleKey.length > 10);
    }
    assert.equal('serviceRoleKey' in getSupabasePublicConfig(), false);
  });
});
