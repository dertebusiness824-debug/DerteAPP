import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
const view = readFileSync(path.join(root, 'public/js/views/home.js'), 'utf8');
const shell = readFileSync(path.join(root, 'public/js/shell.js'), 'utf8');

describe('home brand-blue theme', () => {
  it('keeps home action bindings and drops the marketing launcher', () => {
    assert.match(view, /data-home-action=/);
    assert.match(view, /data-home-path=/);
    assert.match(view, /data-home-support=/);
    assert.match(view, /key: 'create'/);
    assert.match(view, /key: 'pending'/);
    assert.match(view, /key: 'support'/);
    assert.match(view, /key: 'urgencias'/);
    assert.match(view, /openNewBookingSheet/);
    assert.match(view, /navigate\('\/appointments\?filter=today'\)/);
    assert.match(view, /openPlatformSupport/);
    assert.match(view, /navigate\(path\)/);
    assert.match(view, /classList\.toggle\('app--home', active\)/);
    assert.match(view, /classList\.toggle\('header--home', active\)/);
    assert.match(view, /classList\.toggle\('nav--home', active\)/);
    assert.doesNotMatch(view, /TODO EN UNO|todoEnUno|todoTitleHtml/);
    assert.doesNotMatch(view, /dropdownTitle|MENÚ DESPLEGABLE|menu-kicker/);
    assert.doesNotMatch(view, /data-home-menu-close|closeButtonHtml/);
    assert.doesNotMatch(view, /data-home-logo-toggle/);
    assert.match(shell, /navKey === 'home' \? store\.activeShop\?\.name/);
  });

  it('paints Inicio tiles with pastel icon wells on a white canvas', () => {
    assert.match(html, /app\.css\?v=48-ios-polish/);
    assert.match(css, /--home-brand:\s*#0ea5e9/);
    assert.match(css, /\.app--home\s*\{[^}]*background:\s*#f8f9fa/s);
    assert.match(css, /\.home-split\s*\{[^}]*background:\s*#f8f9fa/s);
    assert.doesNotMatch(css, /--home-cobalt:\s*#0047ab/);
    assert.doesNotMatch(css, /\.home-split__todo\s*\{/);
    assert.doesNotMatch(css, /\.home-split__trigger\s*\{/);
    assert.match(css, /\.home-split__tile\s*\{[^}]*border-radius:\s*16px/s);
    assert.match(css, /\.home-split__tile-icon\s*\{[^}]*border-radius:\s*999px/s);
    assert.match(css, /--home-done:\s*#00c853/);
    assert.match(css, /--home-pending:\s*#ff6d00/);
    assert.match(css, /\.nav--home \.nav__item\s*\{[^}]*color:\s*#0ea5e9/s);
    assert.match(css, /\.header__wordmark\s*\{[^}]*color:\s*var\(--brand\)/s);
  });
});
