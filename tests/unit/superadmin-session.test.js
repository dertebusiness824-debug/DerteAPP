import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSessionToken } from '../../server/middleware/auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const store = readFileSync(path.join(root, 'public/js/store.js'), 'utf8');
const api = readFileSync(path.join(root, 'public/js/api.js'), 'utf8');
const shell = readFileSync(path.join(root, 'public/js/shell.js'), 'utf8');
const supabase = readFileSync(path.join(root, 'public/js/supabase.js'), 'utf8');
const sw = readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const admin = readFileSync(path.join(root, 'public/js/views/admin.js'), 'utf8');

function fakeReq({ cookie, bearer } = {}) {
  return {
    cookies: cookie ? { derte_session: cookie } : {},
    get(name) {
      if (String(name).toLowerCase() === 'authorization' && bearer) {
        return `Bearer ${bearer}`;
      }
      return undefined;
    },
  };
}

describe('superadmin session isolation', () => {
  it('prefers the httpOnly cookie over a leftover taller bearer', () => {
    assert.equal(readSessionToken(fakeReq({ cookie: 'admin-cookie', bearer: 'shop-token' })), 'admin-cookie');
    assert.equal(readSessionToken(fakeReq({ cookie: 'admin-cookie', bearer: 'mock-token' })), 'admin-cookie');
    assert.equal(readSessionToken(fakeReq({ bearer: 'api-client-token' })), 'api-client-token');
    assert.equal(readSessionToken(fakeReq({ bearer: 'mock-token' })), null);
  });

  it('keeps Super Admin shop context off the owner localStorage key', () => {
    assert.match(store, /derte_admin_active_shop/);
    assert.match(store, /user\?\.role === 'super_admin'\) return null/);
    assert.match(store, /function adoptDefaultShop/);
    assert.match(store, /if \(store\.isSuperAdmin\) return store\.activeShop/);
  });

  it('does not send mock-token and does not persist a shared Supabase auth session', () => {
    assert.match(api, /Never send mock-token/);
    assert.match(api, /realToken \? \{ Authorization: `Bearer \$\{realToken\}` \} : \{\}/);
    assert.match(supabase, /persistSession: false/);
    assert.match(supabase, /storageKey: 'derte-sb-anon'/);
    assert.match(supabase, /detectSessionInUrl: false/);
  });

  it('keeps admin chrome unless the Super Admin opened a shop workspace', () => {
    assert.match(shell, /isShopWorkPath/);
    const workPath = shell.match(/function isShopWorkPath\(path\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(workPath, /path === '\/dashboard'/);
    assert.doesNotMatch(workPath, /settings/);
    assert.doesNotMatch(workPath, /\/chat/);
    assert.match(admin, /navigate\('\/dashboard'\)/);
    assert.doesNotMatch(admin, /navigate\('\/'\)/);
    assert.match(sw, /url.pathname.startsWith\('\/api\/auth'\)/);
  });
});
