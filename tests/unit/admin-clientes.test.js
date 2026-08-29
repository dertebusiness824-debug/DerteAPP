import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const shell = read('public/js/shell.js');
const app = read('public/js/app.js');
const css = read('public/css/app.css');
const html = read('public/index.html');
const i18n = read('public/js/i18n.js');
const view = read('public/js/views/admin-clientes.js');
const admin = read('public/js/views/admin.js');
const api = read('public/js/api.js');
const store = read('public/js/store.js');
const sw = read('public/sw.js');
const adminRouter = read('server/routes/admin.js');

describe('Super Admin CLIENTES replaces Bandeja', () => {
  it('drops Bandeja from the Super Admin bottom nav', () => {
    const navBlock = shell.match(/export const SUPERADMIN_NAV = \(\) => \[([\s\S]*?)\];/)?.[1] ?? '';
    assert.match(navBlock, /key: 'clientes'/);
    assert.match(navBlock, /path: '\/admin\/clientes'/);
    assert.doesNotMatch(navBlock, /key: 'inbox'/);
    assert.doesNotMatch(navBlock, /\/admin\/inbox/);
    assert.doesNotMatch(navBlock, /Bandeja/);
    assert.doesNotMatch(navBlock, /nav\.inbox/);
  });

  it('paints CLIENTES in corporate emerald on the icon and label', () => {
    assert.match(shell, /nav__item--clientes/);
    assert.match(shell, /classList\.toggle\('app--clientes', isClientes\)/);
    assert.match(shell, /classList\.toggle\('nav--clientes', isClientes\)/);
    assert.match(shell, /classList\.toggle\('theme-clientes', isClientes\)/);
    assert.match(css, /--clientes-green:\s*#059669/);
    assert.match(css, /\.nav__item--clientes,\s*\n\.nav--clientes \.nav__item--clientes[\s\S]*color:\s*#059669/);
    assert.match(i18n, /'nav\.clientes': 'CLIENTES'/);
    assert.match(i18n, /'nav\.clientes': 'CLIENTS'/);
  });

  it('registers the Urgencias-like module and retires the inbox screen', () => {
    assert.match(app, /route\('\/admin\/clientes', adminClientesView\)/);
    assert.match(app, /route\('\/admin\/inbox', \(\) => navigate\('\/admin\/clientes'/);
    assert.match(admin, /navigate\('\/admin\/clientes'/);
    assert.doesNotMatch(admin, /Bandeja/);
    assert.match(view, /urgencia-card/);
    assert.match(view, /clientes\.fieldName/);
    assert.match(view, /clientes\.fieldShop/);
    assert.match(view, /clientes\.fieldIsland/);
    assert.match(view, /contactButtons/);
    assert.match(view, /data-lead-contact/);
    assert.match(view, /data-lead-close/);
    assert.match(view, /data-clientes-shell/);
    assert.match(view, /shell\.addEventListener\('click'/);
    assert.doesNotMatch(view, /main\.addEventListener\('click'/);
    assert.match(api, /adminClientes:/);
    assert.match(api, /adminUpdateCliente:/);
    assert.match(store, /unread\.leads/);
    assert.match(adminRouter, /router\.get\(\s*'\/clientes'/);
    assert.match(sw, /VERSION = 'v54-admin-clientes'/);
    assert.match(sw, /views\/admin-clientes\.js/);
    assert.match(html, /app\.css\?v=67-admin-clientes/);
  });
});
