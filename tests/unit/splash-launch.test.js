import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const chat = readFileSync(path.join(root, 'public/chat.html'), 'utf8');
const sw = readFileSync(path.join(root, 'public/sw.js'), 'utf8');

describe('launch splash', () => {
  it('uses a sky-500 field with a white spinning mark and derteapp wordmark', () => {
    assert.match(html, /class="is-booting"/);
    assert.match(html, /class="boot boot--launch"/);
    assert.match(html, /boot__spin/);
    assert.match(html, /boot__mark/);
    assert.match(html, /boot__wordmark">derteapp</);
    assert.match(html, /logo-mark\.svg/);
    assert.doesNotMatch(html, /src="\/icons\/logo\.svg"/);
    assert.match(html, /theme-color" content="#0ea5e9"/);

    const app = readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
    assert.match(app, /SPLASH_MS = 2600/);
    assert.match(app, /SPLASH_MAX_MS = 3200/);
    assert.match(app, /classList\.remove\('is-booting'\)/);

    assert.match(css, /\.boot--launch\s*\{[^}]*background:\s*#0ea5e9/s);
    assert.match(css, /\.boot--launch\s*\{[^}]*z-index:\s*100/s);
    assert.match(css, /html\.is-booting \.nav/);
    assert.match(css, /\.boot__wordmark\s*\{[^}]*color:\s*#ffffff/s);
    assert.match(css, /\.boot--launch \.boot__spin[\s\S]*animation:\s*boot-mark-spin/);
    assert.match(css, /@keyframes boot-mark-spin/);
    assert.match(css, /@keyframes boot-brand-shift/);
    assert.match(css, /@keyframes boot-word-in/);
    assert.match(css, /--boot-type:\s*min\(7\.5rem, calc\(94vw \/ 6\.15\)\)/);
    assert.match(css, /translate3d\(var\(--boot-shift\)/);
    assert.match(css, /\.boot--launch \.boot__wordmark[\s\S]*opacity:\s*0/);
    assert.doesNotMatch(css, /\.boot--launch \.boot__mark\s*\{[^}]*animation:/s);
  });

  it('keeps the customer-chat splash on the default white .boot', () => {
    assert.match(chat, /class="boot"/);
    assert.doesNotMatch(chat, /boot--launch/);
    assert.match(css, /\.boot\s*\{[^}]*background:\s*#ffffff/s);
  });

  it('always re-registers the cache-busted worker so clients leave the old shell', () => {
    const push = readFileSync(path.join(root, 'public/js/push.js'), 'utf8');
    const app = readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
    assert.match(push, /navigator\.serviceWorker\.register\(SW_URL/);
    assert.match(push, /updateViaCache:\s*'none'/);
    assert.doesNotMatch(push, /if \(!registration\) \{/);
    assert.match(app, /controllerchange/);
    assert.match(app, /window\.location\.reload\(\)/);
  });

  it('precaches the exact stylesheet URL index.html asks for', () => {
    // Pinning literal revisions here only ever produced false failures on every
    // release. What actually matters is that the two stay in step: a mismatch
    // silently sends the first paint after an install back to the network.
    assert.match(sw, /VERSION = 'v\d+-[a-z0-9-]+'/);
    const [, stylesheet] = html.match(/href="(\/css\/app\.css\?v=[^"]+)"/) ?? [];
    assert.ok(stylesheet, 'index.html must load app.css with a cache-busting query');
    assert.ok(
      sw.includes(`'${stylesheet}'`),
      `sw.js must precache ${stylesheet}`,
    );
  });
});
