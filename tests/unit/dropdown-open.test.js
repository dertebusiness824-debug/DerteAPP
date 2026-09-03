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
const shell = read('public/js/shell.js');
const store = read('public/js/store.js');
const appointments = read('public/js/views/appointments.js');
const urgencias = read('public/js/views/urgencias.js');

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
    assert.match(home, /addEventListener\('pointerup', onOpenGesture/);
    assert.match(home, /addEventListener\('click', closeIfOutside/);
    assert.doesNotMatch(home, /closeIfOutside, true/);
    assert.match(home, /ignoreCloseUntil/);
    assert.match(home, /ignoreOpenUntil/);
    assert.match(home, /GESTURE_MS/);
    assert.doesNotMatch(home, /event\.stopPropagation\(\)/);
    assert.match(home, /placeRail/);
    assert.match(home, /clearRailPosition\(menu\)/);
    assert.match(home, /removeAttribute\('style'\)/);
  });

  it('binds exactly one launcher per mount and tears it down again', () => {
    // Two live bindings each kept their own debounce, so one opened the menu
    // while the other closed it on the same tap.
    assert.match(home, /new AbortController\(\)/);
    assert.match(home, /main\._homeAbort\?\.abort\(\)/);
    assert.match(home, /addEventListener\('touchstart', onOpenGesture, \{ passive: true, signal \}\)/);
    assert.match(home, /unbindActions\(\)/);
    assert.doesNotMatch(home, /homeActionsBound/);
  });

  it('ignores the click the opening tap produces over the rail', () => {
    assert.match(home, /railArmedAt/);
    assert.match(home, /if \(Date\.now\(\) < railArmedAt\) return;/);
  });

  it('never lays the rail over the trigger', () => {
    // A fixed panel covering the button made the next tap land on a tile, which
    // froze the menu open or navigated to Reservas on its own. The open rail
    // stays absolute to the left of the 104px dock (right: 116px).
    assert.match(home, /clearRailPosition\(menu\)/);
    assert.doesNotMatch(home, /position = 'fixed'/);
    assert.doesNotMatch(home, /spaceBelow/);
    assert.doesNotMatch(home, /spaceAbove/);
    assert.match(css, /\.home-launcher\s*\{[^}]*flex-direction:\s*row/s);
    assert.match(css, /\.home-launcher\.is-open\s*\{[^}]*flex-direction:\s*row-reverse/s);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail[\s\S]*?\{[^}]*position:\s*absolute\s*!important/s);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail[\s\S]*?\{[^}]*right:\s*116px/s);
    // The old rAF correction is what pulled the rail back across the trigger.
    assert.doesNotMatch(home, /requestAnimationFrame\(\(\) => \{\s*const box = menu\.getBoundingClientRect\(\)/);
    assert.match(home, /function flipTrigger/);
    assert.match(home, /function armHomeMotion/);
    assert.match(home, /classList\.add\('is-ready'\)/);
    assert.match(home, /toggle\.getBoundingClientRect\(\)/);
    assert.doesNotMatch(home, /menu\.getBoundingClientRect\(\)/);
  });

  it('keeps the open rail above the KPI cards and the nav without leaving flow', () => {
    assert.match(css, /--home-rail-box:\s*344px/);
    assert.match(css, /html:not\(\.is-home-gate\) \.home-launcher[\s\S]*min-height:\s*var\(--home-rail-box\)/);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail[\s\S]*?\{[^}]*position:\s*absolute/s);
    assert.doesNotMatch(css, /\.home-launcher\.is-open\s*\{[^}]*min-height:\s*0/s);
    assert.match(css, /\.home-split__metric\s*\{[^}]*order:\s*3/s);
    assert.match(css, /\.nav\s*\{[^}]*z-index:\s*45/s);
  });

  it('toggles the Inicio menu on the trigger and only animates GPU props', () => {
    assert.match(home, /const nextOpen = !readMenuOpen\(\)/);
    assert.match(home, /setLauncherOpen\(root, nextOpen\)/);
    assert.match(home, /spinTriggerMark/);
    assert.match(css, /html:not\(\.is-home-gate\) \.home-split__rail[\s\S]*translate3d\(0, calc\(-50% \+ 12px\), 0\) scale\(0\.96\)/);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail[\s\S]*translate3d\(0, -50%, 0\) scale\(1\)/);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail[\s\S]*opacity:\s*1/);
    assert.doesNotMatch(css, /\.home-launcher\s*\{[^}]*transition:\s*gap/);
    assert.doesNotMatch(css, /\.home-launcher\s*\{[^}]*min-height var\(--home-motion\)/);
    assert.match(css, /html:not\(\.is-home-gate\) \.home-split\.is-ready \.home-split__kpi--pending[\s\S]*animation-delay:\s*0\.16s/);
    assert.doesNotMatch(css, /:has\(\.home-launcher\.is-open\) \.home-split__kpi--pending[\s\S]*animation-delay/);
  });

  it('lets a tap on the rail padding dismiss the menu', () => {
    assert.match(home, /eventHitsSelector\(event, '\[data-home-logo-toggle\], \[data-home-action\]'\)/);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail[\s\S]*?\{[^}]*overscroll-behavior:\s*contain/s);
  });

  it('gives every screen a fresh <main> so listeners cannot pile up', () => {
    assert.match(shell, /function replaceMainNode/);
    assert.match(shell, /main\.replaceWith\(next\)/);
    assert.match(shell, /else replaceMainNode\(\);/);
  });

  it('keeps the open rail in the launcher so ancestors cannot clip it off-screen', () => {
    assert.match(css, /\.home-split__rail\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail[\s\S]*?\{[^}]*position:\s*absolute/s);
    assert.match(css, /\.home-launcher\.is-open \.home-split__rail[\s\S]*?\{[^}]*overflow:\s*visible/s);
    assert.match(css, /\.home-split\s*\{[^}]*overflow:\s*visible/s);
  });

  it('beats leftover inline position:fixed so iPhone cannot overlay the KPI cards', () => {
    assert.match(css, /position:\s*absolute\s*!important/);
    assert.match(home, /removeAttribute\('style'\)/);
    assert.match(css, /\.home-split__rail\s*\{[^}]*position:\s*absolute/s);
    assert.doesNotMatch(css, /\.home-split__rail\s*\{[^}]*position:\s*fixed/s);
    assert.doesNotMatch(css, /\.home-launcher\.is-open \.home-split__rail[^{]*\{[^}]*position:\s*fixed/);
    assert.match(css, /@media \(max-width: 520px\)[\s\S]*flex-direction:\s*row-reverse/);
  });

  it('does not remount Inicio on live SSE ticks', () => {
    assert.match(home, /function patchSplitHome/);
    assert.match(home, /scheduleHomeRefresh/);
    assert.match(home, /visualViewport/);
    assert.doesNotMatch(home, /event === 'call_event'/);
    assert.match(home, /Never replace #main after the first paint/);
  });
});

describe('mobile viewport overflow', () => {
  it('clips horizontal overflow without locking body scroll', () => {
    assert.match(css, /html,\s*body\s*\{[^}]*overflow-x:\s*clip/s);
    assert.match(css, /-webkit-text-size-adjust:\s*100%/);
    assert.doesNotMatch(css, /html,\s*body\s*\{[^}]*overflow:\s*hidden/s);
  });
});

describe('PR101 home appearance', () => {
  it('keeps the PR101 rail look and entrance beside the cyan trigger', () => {
    assert.match(css, /\.home-split__rail\s*\{[^}]*transform:\s*translate3d\(0, 12px, 0\) scale\(0\.96\)/s);
    assert.match(
      css,
      /\.home-launcher\.is-open \.home-split__rail[\s\S]*?\{[^}]*background:\s*transparent/s,
    );
    assert.match(
      css,
      /\.home-launcher\.is-open \.home-split__rail[\s\S]*?\{[^}]*width:\s*min\(268px, calc\(100% - 116px\)\)/s,
    );
    assert.match(css, /\.home-launcher\.is-open\s*\{[^}]*gap:\s*12px/s);
    assert.match(css, /@keyframes home-metric-glow[\s\S]*transform:\s*scale\(1\.04\)/);
  });

  it('keeps the KPI pulse on live value changes without repainting', () => {
    assert.match(home, /function replayMetricGlow/);
    assert.match(home, /replayMetricGlow\(doneEl\)/);
    assert.match(home, /replayMetricGlow\(pendingEl\)/);
  });

  it('lets CSS place the open rail and does not override the slide-in', () => {
    assert.match(home, /function placeRail/);
    assert.match(home, /clearRailPosition\(menu\)/);
    // An inline transform would override the CSS slide-in.
    assert.doesNotMatch(home, /menu\.style\.transform = 'none'/);
    assert.doesNotMatch(home, /menu\.style\.position = 'fixed'/);
  });
});

describe('live updates do not rebuild interactive chrome', () => {
  it('skips identical nav paints and badge emits', () => {
    assert.match(shell, /nav\.dataset\.paint === signature/);
    assert.match(store, /if \(!same\) emit\(\)/);
  });

  it('skips identical Reservas and Urgencias list paints', () => {
    assert.match(appointments, /container\.dataset\.paintSig === signature/);
    assert.match(urgencias, /container\.dataset\.paintSig === signature/);
  });
});
