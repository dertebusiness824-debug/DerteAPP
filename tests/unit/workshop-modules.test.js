/**
 * Wiring of the three workshop modules, and the removal of Soporte and
 * Horarios from the owner interface.
 *
 * These are source-level assertions on purpose: the app is a vanilla-JS PWA
 * with no build step, so a route that is never registered or a nav entry that
 * points nowhere is exactly the kind of break that has no other guard.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const app = read('public/js/app.js');
const shell = read('public/js/shell.js');
const settings = read('public/js/views/settings.js');
const home = read('public/js/views/home.js');
const api = read('public/js/api.js');
const i18n = read('public/js/i18n.js');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const sw = read('public/sw.js');
const workshopRouter = read('server/routes/workshop.js');
const adminRouter = read('server/routes/admin.js');
const maintenance = read('server/services/maintenance.js');
const appointments = read('server/services/appointments.js');

const PATHS = ['/vehiculos', '/diagnostico', '/inventario'];

describe('Soporte and Horarios are gone from the owner interface', () => {
  it('no longer ships a schedule view', () => {
    assert.equal(existsSync(path.join(root, 'public/js/views/schedule.js')), false);
    assert.doesNotMatch(app, /scheduleView/);
    assert.doesNotMatch(app, /route\('\/schedule'/);
    assert.doesNotMatch(sw, /views\/schedule\.js/);
  });

  it('drops the owner-facing support entry point', () => {
    assert.doesNotMatch(app, /chatListView/);
    assert.doesNotMatch(shell, /openPlatformSupport/);
    assert.doesNotMatch(settings, /openPlatformSupport/);
    assert.doesNotMatch(home, /openPlatformSupport/);
    // Support threads survive as a leftover /chat route, not a Super Admin nav item.
    assert.match(app, /route\('\/chat\/:threadId'/);
    assert.match(shell, /'\/admin\/clientes'/);
  });

  it('removes the schedule editing endpoints from the owner client', () => {
    assert.doesNotMatch(api, /\bsaveSchedule:/);
    assert.doesNotMatch(api, /\baddException:/);
    assert.doesNotMatch(api, /\bremoveException:/);
  });

  it('leaves no dangling nav entry or translation behind', () => {
    assert.doesNotMatch(shell, /key: 'schedule'/);
    assert.doesNotMatch(shell, /key: 'support'/);
    assert.doesNotMatch(i18n, /'nav\.schedule':/);
    assert.doesNotMatch(i18n, /'settings\.hours':/);
    assert.doesNotMatch(i18n, /'settings\.support':/);
    assert.doesNotMatch(manifest.shortcuts.map((item) => item.url).join(' '), /\/schedule|\/chat/);
  });
});

describe('workshop modules are reachable', () => {
  it('registers a route for each module, detail view included', () => {
    for (const routePath of PATHS) {
      assert.match(app, new RegExp(`route\\('${routePath}'`), `${routePath} has no route`);
    }
    assert.match(app, /route\('\/vehiculos\/:id'/);
  });

  it('imports the three views', () => {
    assert.match(app, /vehiclesView/);
    assert.match(app, /vehicleView/);
    assert.match(app, /diagnosticsView/);
    assert.match(app, /inventoryView/);
    for (const file of ['vehicles', 'diagnostics', 'inventory']) {
      assert.ok(existsSync(path.join(root, `public/js/views/${file}.js`)), `${file}.js is missing`);
    }
  });

  it('puts vehicles and inventory in the owner bottom nav', () => {
    assert.match(shell, /key: 'vehicles',[^}]*path: '\/vehiculos'/s);
    assert.match(shell, /key: 'inventory',[^}]*path: '\/inventario'/s);
  });

  it('treats the module paths as shop work, so the shop switcher stays put', () => {
    for (const routePath of PATHS) {
      assert.match(shell, new RegExp(`'${routePath}'`), `${routePath} is not a shop work path`);
    }
  });

  it('links all three from the workshop section of Ajustes', () => {
    for (const routePath of PATHS) {
      assert.match(settings, new RegExp(`href="${routePath}"`), `${routePath} is not linked in settings`);
    }
    assert.match(settings, /settings\.workshopSection/);
  });

  it('offers them as home launcher actions and PWA shortcuts', () => {
    assert.match(home, /path: '\/vehiculos'/);
    assert.match(home, /path: '\/diagnostico'/);
    assert.match(home, /path: '\/inventario'/);
    const shortcuts = manifest.shortcuts.map((item) => item.url);
    for (const routePath of PATHS) {
      assert.ok(shortcuts.includes(routePath), `${routePath} is not a PWA shortcut`);
    }
  });

  it('precaches the new views and vehicle illustrations', () => {
    for (const file of ['vehicles', 'diagnostics', 'inventory']) {
      assert.match(sw, new RegExp(`views/${file}\\.js`), `${file}.js is not precached`);
    }
    assert.match(sw, /img\/vehicles\//);
  });

  it('translates every new key in Spanish and English', () => {
    const keys = [
      'nav.vehicles',
      'nav.diagnostics',
      'nav.inventory',
      'settings.workshopSection',
      'settings.inventoryReminders',
      'diag.question',
      'inventory.addByPhoto',
      'vehicles.finderTitle',
      'appointments.completedOn',
    ];
    for (const key of keys) {
      const matches = i18n.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) ?? [];
      assert.ok(matches.length >= 2, `${key} is not translated in both locales`);
    }
  });
});

describe('workshop API surface', () => {
  it('exposes the endpoints the views call', () => {
    const endpoints = [
      '/workshop/vehicles',
      '/workshop/vehicles/identify/plate',
      '/workshop/vehicles/identify/photo',
      '/workshop/vehicles/catalog',
      '/workshop/diagnostics',
      '/workshop/inventory',
      '/workshop/inventory/recognize',
      '/workshop/inventory/movements',
      '/workshop/inventory/reminders',
    ];
    for (const endpoint of endpoints) {
      assert.ok(api.includes(endpoint), `${endpoint} is not in the API client`);
    }
  });

  it('scopes every workshop route to one shop', () => {
    const routes = workshopRouter.match(/router\.(get|post|patch|delete)\(\s*'[^']+'/g) ?? [];
    assert.ok(routes.length > 10);
    // Each route declaration is immediately followed by requireShopAccess.
    const unscoped = workshopRouter
      .split(/router\.(?:get|post|patch|delete)\(/)
      .slice(1)
      .filter((block) => !block.slice(0, 200).includes('requireShopAccess'));
    assert.deepEqual(unscoped, []);
  });

  it('declares the fixed inventory paths before the :itemId parameter', () => {
    const paramAt = workshopRouter.indexOf("'/inventory/:itemId'");
    assert.ok(paramAt > 0);
    for (const fixed of ["'/inventory/reminders'", "'/inventory/movements'", "'/inventory/recognize'"]) {
      const at = workshopRouter.indexOf(fixed);
      assert.ok(at > 0, `${fixed} is not declared`);
      assert.ok(at < paramAt, `${fixed} would be read as an item id`);
    }
  });

  it('declares /vehicles/catalog before the :vehicleId parameter', () => {
    assert.ok(
      workshopRouter.indexOf("'/vehicles/catalog'") < workshopRouter.indexOf("'/vehicles/:vehicleId'"),
    );
  });

  it('gives the Super Admin the inventory preload controls', () => {
    assert.match(adminRouter, /shops\/:shopId\/inventory/);
    assert.match(adminRouter, /inventory\/preload/);
    assert.match(api, /adminPreloadInventory/);
    assert.match(api, /adminClearPreloadedInventory/);
  });

  it('keeps Matriculas.org behind the Super Admin router, never the workshop one', () => {
    assert.match(adminRouter, /\/vehicles\/plate/);
    assert.match(adminRouter, /requireSuperAdmin/);
    assert.match(adminRouter, /assertSuperAdmin/);
    assert.match(api, /adminLookupPlate/);
    assert.doesNotMatch(workshopRouter, /matriculas/);
    assert.doesNotMatch(read('server/services/vehicles.js'), /matriculas/);
    assert.match(sw, /admin-matriculas\.js/);
    assert.match(app, /adminMatriculasView/);
    assert.match(app, /route\('\/admin\/matriculas'/);
  });

  it('runs the reminder sweep hourly, since the rules pick the shop hour', () => {
    assert.match(maintenance, /runInventoryReminders/);
    assert.match(maintenance, /inventoryRemindersIntervalMs = 60 \* 60_000/);
  });
});

describe('advanced customer history', () => {
  it('counts a customer visits and bookings alongside each appointment', () => {
    assert.match(appointments, /customer_visits/);
    assert.match(appointments, /customer_bookings/);
    assert.match(appointments, /customer_previous_visit_at/);
    assert.match(appointments, /serializeLoyalty/);
  });

  it("says when a booking was completed, not just that it is 'completed'", () => {
    assert.match(appointments, /completed_local/);
    const view = read('public/js/views/appointments.js');
    assert.match(view, /completedBannerHtml/);
    assert.match(view, /loyaltyChip/);
  });

  it('indexes the loyalty lookup so it is not a shop-wide scan', () => {
    const migration = read('server/db/migrations/022_workshop_modules.sql');
    assert.match(migration, /appointments_shop_customer_idx[\s\S]*appointments \(shop_id, customer_phone\)/);
  });
});
