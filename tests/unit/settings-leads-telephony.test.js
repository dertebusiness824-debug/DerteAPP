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
const clientes = read('public/js/views/admin-clientes.js');

describe('Super Admin Ajustes: global Zadarma + Retell for CLIENTES', () => {
  it('adds a Super-Admin-only lead telephony card under Integraciones', () => {
    assert.match(settings, /data-leads-tel-settings/);
    assert.match(settings, /id="sa-zadarma-key"/);
    assert.match(settings, /id="sa-zadarma-secret"/);
    assert.match(settings, /id="sa-zadarma-sip"/);
    assert.match(settings, /id="sa-zadarma-did"/);
    assert.match(settings, /id="sa-retell-key"/);
    assert.match(settings, /id="sa-retell-agent"/);
    assert.match(settings, /id="sa-retell-did"/);
    assert.match(settings, /leads-tel-status/);
    assert.match(api, /adminSaveLeadsTelephony/);
    assert.match(admin, /router\.patch\(\s*'\/settings\/leads-telephony'/s);
    assert.match(i18n, /sa\.leadsTelSecretHint/);
    assert.doesNotMatch(settings, /sa\.hostingerPanelUrl/);
  });

  it('paints the card in CLIENTES emerald and keeps secrets off the wire in the form', () => {
    assert.match(css, /\.sa-leads-tel \.input:focus\s*\{[^}]*border-color:\s*#059669/s);
    assert.match(css, /\.sa-leads-tel \.btn:not\(\.btn--soft\)[^{]*\{[^}]*background:\s*#059669/is);
    assert.match(settings, /type="password"/);
    assert.doesNotMatch(settings, /zadarma_api_secret\}/);
  });

  it('streams lead rows into CLIENTES in realtime', () => {
    assert.match(clientes, /stream\('\/admin\/clientes\/stream'/);
    assert.match(admin, /router\.get\('\/clientes\/stream'/);
    assert.match(i18n, /'clientes\.statusPending': 'Pendiente de llamada'/);
  });
});
