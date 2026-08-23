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
    assert.match(html, /class="boot boot--launch"/);
    assert.match(html, /boot__mark/);
    assert.match(html, /boot__wordmark">derteapp</);
    assert.match(html, /logo-mark\.svg/);
    assert.doesNotMatch(html, /src="\/icons\/logo\.svg"/);
    assert.match(html, /theme-color" content="#0ea5e9"/);

    assert.match(css, /\.boot--launch\s*\{[^}]*background:\s*#0ea5e9/s);
    assert.match(css, /\.boot__wordmark\s*\{[^}]*color:\s*#ffffff/s);
    assert.match(css, /animation:\s*boot-mark-spin/);
    assert.match(css, /@keyframes boot-mark-spin/);
    assert.match(css, /--boot-type:\s*min\(7\.5rem, calc\(94vw \/ 6\.15\)\)/);
  });

  it('keeps the customer-chat splash on the default white .boot', () => {
    assert.match(chat, /class="boot"/);
    assert.doesNotMatch(chat, /boot--launch/);
    assert.match(css, /\.boot\s*\{[^}]*background:\s*#ffffff/s);
  });

  it('cache-busts the service worker with the splash revision', () => {
    assert.match(sw, /VERSION = 'v43-calcom-push'/);
    assert.match(sw, /app\.css\?v=42-splash-blue/);
  });
});
