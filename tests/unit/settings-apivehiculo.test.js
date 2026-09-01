import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const settings = read('public/js/views/settings.js');
const css = read('public/css/app.css');
const i18n = read('public/js/i18n.js');
const api = read('public/js/api.js');
const admin = read('server/routes/admin.js');
const vehicles = read('public/js/views/vehicles.js');
const workshop = read('server/routes/workshop.js');
const envExample = read('.env.example');
const compose = read('docker-compose.yml');

describe('Super Admin Ajustes: APIVehículo', () => {
  it('has no leftover Matriculas.org copy or RapidAPI env', () => {
    assert.doesNotMatch(settings, /Matriculas\.org/);
    assert.doesNotMatch(i18n, /Matriculas\.org/);
    assert.doesNotMatch(admin, /matriculas\.org/);
    assert.doesNotMatch(envExample, /MATRICULAS_API_KEY/);
    assert.doesNotMatch(envExample, /matriculas\.org/);
    assert.match(envExample, /API_VEHICULO_KEY=/);
    assert.doesNotMatch(compose, /MATRICULAS_API/);
    assert.doesNotMatch(compose, /rapidapi/i);
    assert.match(compose, /API_VEHICULO_KEY/);
  });

  it('adds a Super-Admin-only APIVehículo key field and ping', () => {
    assert.match(settings, /data-apivehiculo-settings/);
    assert.match(settings, /sa-apivehiculo-key/);
    assert.match(settings, /data-apivehiculo-ping/);
    assert.match(settings, /type="password"/);
    assert.match(settings, /sa\.apivehiculoKeyHint/);
    assert.match(i18n, /API_VEHICULO_KEY/);
    assert.match(api, /adminSaveApivehiculoKey/);
    assert.match(api, /adminPingApivehiculo/);
    assert.match(admin, /router\.patch\(\s*'\/vehicles\/apivehiculo'/s);
    assert.match(admin, /router\.post\(\s*'\/vehicles\/apivehiculo\/ping'/s);
  });

  it('paints the save control in sky cyan', () => {
    assert.match(css, /\.sa-apivehiculo \.input:focus\s*\{[^}]*border-color:\s*#00bfff/s);
    assert.match(css, /\.sa-apivehiculo \.btn:not\(\.btn--soft\)[^{]*\{[^}]*background:\s*#00bfff/is);
  });

  it('fills Identificar vehículo from the official JSON', () => {
    assert.match(vehicles, /fillManualFromVehicle/);
    assert.match(workshop, /identifyByPlate/);
    assert.match(read('server/services/vehicles.js'), /lookupPlate/);
    assert.match(read('server/services/vehicles.js'), /apivehiculo/);
  });
});
