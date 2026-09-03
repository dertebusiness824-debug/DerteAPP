import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const view = readFileSync(path.join(root, 'public/js/views/home.js'), 'utf8');
const i18n = readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');

describe('home sky gate', () => {
  it('starts on a full-sky field with a 3×–4× neon mark', () => {
    assert.match(view, /function markHomeGate/);
    assert.match(view, /function openFromGate/);
    assert.match(view, /function closeToGate/);
    assert.match(view, /writeHomeGate\(true\)/);
    assert.match(view, /markHomeGate\(true\)/);
    assert.match(view, /tapTimes\.length >= 3/);
    assert.match(view, /TRIPLE_MS = 600/);
    assert.match(css, /--home-gate-scale:\s*min\(2\.75/);
    assert.match(css, /html\.is-home-gate \.home-split::after[\s\S]*opacity:\s*1/);
    assert.match(css, /html\.is-home-gate \.home-split__trigger[\s\S]*scale\(var\(--home-gate-scale\)\)/);
    assert.match(css, /html\.is-home-gate \.home-split__trigger[\s\S]*rgba\(255,\s*255,\s*255,\s*0\.08\)/);
    assert.match(css, /html\.is-home-gate \.home-split__trigger[\s\S]*backdrop-filter:\s*blur\(12px\)/);
    assert.match(css, /html\.is-home-gate \.home-split__trigger[\s\S]*border:\s*2px solid rgba\(255,\s*255,\s*255,\s*0\.55\)/);
    assert.match(css, /\.home-split__trigger::after[\s\S]*0 0 20px rgba\(255,\s*255,\s*255,\s*0\.5\)/);
    assert.match(css, /@keyframes home-gate-pulse[\s\S]*scale\(1\.03\)/);
    assert.match(view, /home-split__trigger-hint/);
    const app = readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
    assert.match(app, /views\/home\.js\?v=/);
    assert.match(view, /home\.gateHint/);
    assert.match(i18n, /'home\.gateHint':\s*'Pulsa para desplegar'/);
    assert.match(css, /html\.is-home-gate \.header[\s\S]*opacity:\s*0/);
    assert.match(css, /html\.is-home-gate \.header[\s\S]*position:\s*absolute/);
    assert.match(css, /\.app\s*\{[^}]*position:\s*relative/s);
    assert.match(css, /html\.is-home-gate \.nav[\s\S]*opacity:\s*0/);
    assert.match(css, /\.home-split::after[\s\S]*will-change:\s*opacity/);
    assert.match(css, /\.home-split__trigger[\s\S]*will-change:\s*transform/);
    assert.match(css, /html\.is-home-gate \.home-split__trigger \{[^}]*scale\(var\(--home-gate-scale\)\)[^}]*\}/s);
    assert.match(css, /html\.is-home-gate \.home-split__trigger \{[^}]*grid-template-rows:\s*1fr auto auto 1fr/s);
    assert.match(css, /html\.is-home-gate \.home-split__trigger-mark[\s\S]*width:\s*64px/);
    assert.match(css, /html\.is-home-gate \.home-split__trigger-hint[\s\S]*position:\s*static/);
  });

  it('opens with a 0.72s plate expand and flies the mark into the header lockup', () => {
    assert.match(view, /GATE_OPEN_MS = 720/);
    assert.match(view, /GATE_EASE = 'cubic-bezier\(0\.25, 1, 0\.5, 1\)'/);
    assert.match(view, /is-home-gate-opening/);
    assert.match(view, /home-gate-flyer/);
    assert.match(view, /function spawnGateFlyer/);
    assert.match(view, /function settleOpenFromGate/);
    assert.match(view, /wordmark\?\.classList\.add\('is-collapsed'\)/);
    assert.match(view, /duration: GATE_OPEN_MS, ease: GATE_EASE/);
    assert.match(css, /--home-gate-open:\s*0\.72s/);
    assert.match(css, /--home-gate-ease:\s*cubic-bezier\(0\.25, 1, 0\.5, 1\)/);
    assert.match(css, /--home-gate-expand:\s*9/);
    assert.match(css, /html\.is-home-gate\.is-home-gate-opening \.home-split__trigger[\s\S]*scale\(var\(--home-gate-expand\)\)/);
    assert.match(css, /html\.is-home-gate\.is-home-gate-opening \.home-split::after[\s\S]*opacity:\s*0/);
    assert.match(css, /html\.is-home-gate\.is-home-gate-opening \.header[\s\S]*opacity:\s*1/);
    assert.match(css, /\.home-gate-flyer[\s\S]*will-change:\s*transform, opacity/);
    assert.match(css, /html\.is-home-gate\.is-home-gate-opening \.home-split__trigger \.home-split__trigger-mark/);
    assert.match(view, /home-gate-flyer__mark/);
    assert.match(css, /\.header--home \.header__brand[\s\S]*gap:\s*8px/);
    assert.match(css, /\.header--home \.header__logo[\s\S]*width:\s*28px/);
    assert.match(css, /\.header--home \.header__wordmark[\s\S]*font-size:\s*15px/);
    assert.match(css, /\.header--home \.header__wordmark[\s\S]*max-width:\s*7\.5rem/);
  });

  it('opens Todo en uno on the first tap and returns on a triple tap', () => {
    assert.match(view, /if \(readHomeGate\(\)\)/);
    assert.match(view, /openFromGate\(root\)/);
    assert.match(view, /closeToGate\(root\)/);
    assert.match(view, /translate3d\(\$\{dx\}px, \$\{dy\}px, 0\) scale\(\$\{sx\}, \$\{sy\}\)/);
    assert.match(view, /addEventListener\('click', closeIfOutside/);
    assert.doesNotMatch(view, /event\.stopPropagation\(\)/);
  });
});
