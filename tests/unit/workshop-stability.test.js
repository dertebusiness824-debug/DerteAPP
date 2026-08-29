/**
 * Workshop screens (Vehículos / Diagnóstico) must survive API errors and
 * leftover overlays without bouncing the mechanic back to Inicio.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepsSessionOn401 } from '../../public/js/api.js';
import { isWorkspacePath } from '../../public/js/error-boundary.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const api = read('public/js/api.js');
const app = read('public/js/app.js');
const router = read('public/js/router.js');
const store = read('public/js/store.js');
const ui = read('public/js/ui.js');
const vehicles = read('public/js/views/vehicles.js');
const diagnostics = read('public/js/views/diagnostics.js');
const supabase = read('public/js/supabase.js');
const sw = read('public/sw.js');
const marketplaceApp = read('client-app/src/App.tsx');
const marketplaceSession = read('client-app/src/providers/SessionProvider.tsx');
const marketplaceBoundary = read('client-app/src/components/layout/ErrorBoundary.tsx');

describe('keepsSessionOn401', () => {
  it('covers plate lookup, AI diagnostics and the rest of the workshop API', () => {
    assert.equal(keepsSessionOn401('/workshop/vehicles/identify/plate'), true);
    assert.equal(keepsSessionOn401('/workshop/diagnostics'), true);
    assert.equal(keepsSessionOn401('/workshop/vehicles/catalog'), true);
    assert.equal(keepsSessionOn401('/chat/unread'), true);
    assert.equal(keepsSessionOn401('/appointments'), true);
    assert.equal(keepsSessionOn401('/auth/login'), false);
    assert.equal(keepsSessionOn401('/auth/me'), false);
  });

  it('is wired into the shared request() so a 401 cannot drop derte_token', () => {
    assert.match(api, /export function keepsSessionOn401/);
    assert.match(api, /quiet401 = silent401 \|\| keepsSessionOn401\(path\)/);
  });
});

describe('workspace routes stay put', () => {
  it('treats vehicles, diagnostics and home as workspace paths', () => {
    assert.equal(isWorkspacePath('/vehiculos'), true);
    assert.equal(isWorkspacePath('/vehiculos/abc'), true);
    assert.equal(isWorkspacePath('/diagnostico'), true);
    assert.equal(isWorkspacePath('/inventario'), true);
    assert.equal(isWorkspacePath('/'), true);
    assert.equal(isWorkspacePath('/settings'), false);
    assert.equal(isWorkspacePath('/login'), false);
  });

  it('does not navigate to login from workshop screens after a 401', () => {
    assert.match(app, /isWorkspacePath\(location\.pathname\)/);
    assert.match(app, /loadSession\(\{ keepAlive: true \}\)/);
    assert.match(store, /keepAlive && store\.user/);
    assert.doesNotMatch(app, /void resolve\(\)/);
  });
});

describe('error boundaries and dropdowns', () => {
  it('wraps route handlers and closes leftover sheets before remounting', () => {
    assert.match(router, /closeAllSheets\(\)/);
    assert.match(router, /setRouteErrorHandler/);
    assert.match(router, /onRouteError/);
    assert.match(ui, /export function closeAllSheets/);
    assert.match(ui, /openSheetClosers/);
    assert.match(app, /installGlobalErrorBoundary/);
    assert.match(app, /paintRouteError/);
    assert.match(sw, /error-boundary\.js/);
  });

  it('keeps the vehicle make <select> mounted across tab switches', () => {
    assert.match(vehicles, /data-finder-panel="plate"/);
    assert.match(vehicles, /data-finder-panel="manual"/);
    assert.match(vehicles, /showFinderTab/);
    assert.match(vehicles, /input--native-select/);
    assert.match(vehicles, /data-error-boundary/);
    assert.match(vehicles, /friendlyApiMessage/);
    assert.doesNotMatch(vehicles, /finderBox\.innerHTML = plateFormHtml/);
  });

  it('shows AI and plate errors in place instead of navigating away', () => {
    assert.match(diagnostics, /data-error-boundary/);
    assert.match(diagnostics, /friendlyApiMessage/);
    assert.match(diagnostics, /errorBox\.textContent = friendlyApiMessage/);
  });

  it('never lets plate / AI traffic sign the B2B Supabase client out', () => {
    assert.match(supabase, /persistSession: false/);
    assert.match(supabase, /never[\s\S]*sign this client out/s);
  });
});

describe('derteapp2 marketplace', () => {
  it('wraps routes in an ErrorBoundary and keeps the profile on refresh errors', () => {
    assert.match(marketplaceApp, /ErrorBoundary/);
    assert.match(marketplaceBoundary, /class ErrorBoundary/);
    assert.match(marketplaceSession, /Keep the last good profile/);
    assert.doesNotMatch(marketplaceSession, /if \(active\) setProfile\(null\)/);
  });
});
