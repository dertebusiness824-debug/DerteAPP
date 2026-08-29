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

describe('Super Admin Ajustes: Matriculas.org instead of Hostinger', () => {
  it('removes Hostinger fields from Super Admin settings', () => {
    assert.doesNotMatch(settings, /sa\.hostingerPanelUrl/);
    assert.doesNotMatch(settings, /sa\.hostingerUrl/);
    assert.doesNotMatch(settings, /sa\.hostingerDomains/);
    assert.doesNotMatch(settings, /id="ns-website"/);
    assert.doesNotMatch(settings, /id="es-website"/);
    assert.doesNotMatch(settings, /id="es-site"/);
    assert.doesNotMatch(settings, /id="es-domains"/);
  });

  it('adds a Super-Admin-only Matriculas.org API key field', () => {
    assert.match(settings, /data-matriculas-settings/);
    assert.match(settings, /sa-matriculas-key/);
    assert.match(settings, /type="password"/);
    assert.match(settings, /sa\.matriculasKeyHint/);
    assert.match(i18n, /Déjalo vacío para mantener la clave actual\. Solo Super Admin\./);
    assert.match(api, /adminSaveMatriculasKey/);
    assert.match(admin, /router\.patch\(\s*'\/vehicles\/matriculas'/s);
  });

  it('paints the save control in sky cyan', () => {
    assert.match(css, /\.sa-matriculas \.input:focus\s*\{[^}]*border-color:\s*#00bfff/s);
    assert.match(css, /\.sa-matriculas \.btn:not\(\.btn--soft\)[^{]*\{[^}]*background:\s*#00bfff/is);
  });
});
