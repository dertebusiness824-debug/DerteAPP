import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
const view = readFileSync(path.join(root, 'public/js/views/home.js'), 'utf8');

describe('home brand-blue theme', () => {
  it('keeps home action bindings and the split dashboard markup', () => {
    assert.match(view, /data-home-action=/);
    assert.match(view, /data-home-logo-toggle/);
    assert.match(view, /data-home-logo-menu/);
    assert.match(view, /data-home-launcher/);
    assert.match(view, /tabindex=/);
    assert.doesNotMatch(view, /data-home-menu-close/);
    assert.doesNotMatch(view, /trigger-hint|closeButtonHtml/);
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
    assert.match(view, /home-split__trigger-mark/);
    assert.match(view, /home-split__kpi/);
    assert.match(view, /logo-mark\.svg/);
  });

  it('paints Inicio with splash brand blue on a white canvas', () => {
    assert.match(html, /app\.css\?v=49-home-kpi/);
    assert.match(css, /--home-brand:\s*#0ea5e9/);
    assert.match(css, /\.app--home\s*\{[^}]*background:\s*#f8f9fa/s);
    assert.match(css, /\.home-split\s*\{[^}]*background:\s*#f8f9fa/s);
    assert.doesNotMatch(css, /--home-cobalt:\s*#0047ab/);
    assert.match(css, /\.home-split__todo\s*\{[^}]*color:\s*var\(--home-brand\)/s);
    assert.match(css, /\.home-split__todo-wrench\s*\{[^}]*color:\s*var\(--home-brand\)/s);
    assert.match(css, /\.home-split__tile-icon\s*\{[^}]*color:\s*var\(--home-brand\)/s);
    assert.match(css, /\.home-split__trigger\s*\{[^}]*border-radius:\s*28px/s);
    assert.match(css, /@keyframes home-mark-spin/);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail\s*\{[^}]*opacity:\s*1/s);
    assert.match(css, /\.home-launcher\.is-open \.home-split__trigger-mark\s*\{[^}]*animation:\s*home-mark-spin 0\.3s ease-in-out 1/s);
    assert.doesNotMatch(css, /\.home-launcher\.is-open \.home-split__trigger-mark\s*\{[^}]*infinite/s);
    assert.match(css, /\.home-split__rail \.home-split__tile-label\s*\{[^}]*font-size:\s*14px/s);
    assert.match(css, /\.home-split__kpi\s*\{[^}]*border-radius:\s*16px/s);
    assert.match(css, /\.home-split__kpi\s*\{[^}]*flex-direction:\s*row/s);
    assert.match(css, /\.home-split__tile\s*\{[^}]*border-radius:\s*20px/s);
    assert.match(css, /--home-done:\s*#00c853/);
    assert.match(css, /--home-pending:\s*#ff6d00/);
    assert.match(css, /@keyframes home-metric-glow/);
    assert.match(css, /\.nav--home \.nav__item\s*\{[^}]*color:\s*#0ea5e9/s);
    assert.match(css, /\.header__wordmark\s*\{[^}]*color:\s*var\(--brand\)/s);
  });
});
