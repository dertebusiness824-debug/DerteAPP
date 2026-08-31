/**
 * Dropdown / native <select> must open on tap in the PWA (iOS included).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const css = read('public/css/app.css');
const ui = read('public/js/ui.js');
const home = read('public/js/views/home.js');

describe('native select pickers', () => {
  it('uses the system appearance so iOS can open the picker', () => {
    assert.match(css, /select\.input[\s\S]*-webkit-appearance:\s*menulist/);
    assert.match(css, /\.field:has\(select\)\s*\{[^}]*overflow:\s*visible/s);
    assert.match(css, /\.sheet:has\(select\)[\s\S]*overflow:\s*visible/);
  });

  it('does not freeze the page scroll lock that blocks iOS pickers', () => {
    assert.doesNotMatch(ui, /document\.body\.style\.overflow = 'hidden'/);
    assert.match(ui, /Never lock document\.body overflow/);
  });
});

describe('home launcher dropdown', () => {
  it('opens on pointerup/click without capture-phase stopPropagation', () => {
    assert.match(home, /addEventListener\('touchstart', onOpenGesture/);
    assert.match(home, /addEventListener\('pointerup', onOpenGesture\)/);
    assert.match(home, /addEventListener\('click', closeIfOutside\)/);
    assert.doesNotMatch(home, /closeIfOutside, true/);
    assert.match(home, /ignoreCloseUntil/);
    assert.doesNotMatch(home, /event\.stopPropagation\(\)/);
    assert.match(home, /placeRail/);
    assert.match(home, /position = 'fixed'/);
  });

  it('keeps the open rail out of overflow-hidden ancestors', () => {
    assert.match(css, /\.home-split__rail\s*\{[^}]*overflow:\s*visible/s);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail\s*\{[^}]*position:\s*fixed/s);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail\s*\{[^}]*z-index:\s*40/s);
  });
});
