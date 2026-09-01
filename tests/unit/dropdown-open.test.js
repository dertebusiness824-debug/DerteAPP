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
const launcher = read('public/js/nav-launcher.js');
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

describe('nav launcher dropdown', () => {
  it('opens on pointerup/click without capture-phase stopPropagation', () => {
    assert.match(launcher, /addEventListener\('touchstart', onOpenGesture/);
    assert.match(launcher, /addEventListener\('pointerup', onOpenGesture/);
    assert.match(launcher, /addEventListener\('click', closeIfOutside/);
    assert.doesNotMatch(launcher, /closeIfOutside, true/);
    assert.match(launcher, /ignoreCloseUntil/);
    assert.match(launcher, /ignoreOpenUntil/);
    assert.match(launcher, /GESTURE_MS/);
    assert.doesNotMatch(launcher, /event\.stopPropagation\(\)/);
    assert.match(launcher, /placeRail/);
    assert.match(launcher, /position = 'fixed'/);
  });

  it('binds exactly one launcher per shell mount', () => {
    assert.match(launcher, /new AbortController\(\)/);
    assert.match(shell, /bindNavLauncher\(nav\)/);
    assert.match(launcher, /addEventListener\('touchstart', onOpenGesture, \{ passive: true, signal \}\)/);
    assert.doesNotMatch(launcher, /homeActionsBound/);
  });

  it('ignores the click the opening tap produces over the rail', () => {
    assert.match(launcher, /railArmedAt/);
    assert.match(launcher, /if \(Date\.now\(\) < railArmedAt\) return;/);
  });

  it('never lays the rail over the trigger', () => {
    assert.match(launcher, /const spaceBelow = viewBottom - \(rect\.bottom \+ gap\);/);
    assert.match(launcher, /const spaceAbove = rect\.top - gap - viewTop;/);
    assert.match(launcher, /const below = spaceBelow >= spaceAbove;/);
    assert.match(launcher, /menu\.style\.maxHeight = `\$\{room\}px`;/);
    assert.match(launcher, /below \? rect\.bottom \+ gap : rect\.top - gap - height/);
    assert.doesNotMatch(launcher, /requestAnimationFrame\(\(\) => \{\s*const box = menu\.getBoundingClientRect\(\)/);
  });

  it('keeps the rail above the fixed bottom navigation', () => {
    assert.match(launcher, /document\.querySelector\('\.nav'\)\?\.getBoundingClientRect\(\)\.top/);
    assert.match(launcher, /Math\.min\(vp\.top \+ vp\.height, navTop\) - gutter/);
  });

  it('lets a tap on the rail padding dismiss the menu', () => {
    assert.match(launcher, /eventHitsSelector\(event, '\[data-home-logo-toggle\], \[data-home-action\]'\)/);
    assert.match(css, /\.home-split__rail\.is-open\s*,|\.home-launcher\.is-open \.home-split__rail[\s\S]*overscroll-behavior:\s*contain/);
  });

  it('dims the rest of the screen and leaves the bottom nav clickable', () => {
    assert.match(css, /\.nav-launcher-scrim\s*\{[^}]*z-index:\s*35/s);
    assert.match(css, /\.nav-launcher-scrim\s*\{[^}]*backdrop-filter:\s*blur/s);
    assert.match(css, /\.nav-launcher-scrim\s*\{[^}]*bottom:\s*calc\(var\(--nav-height\)/s);
    assert.match(css, /\.app\.is-dimmed\s*\{[^}]*brightness/s);
    assert.match(launcher, /classList\.toggle\('is-dimmed', nextOpen\)/);
  });

  it('replaces Más with the cyan brand trigger on the owner nav', () => {
    assert.match(shell, /bindNavLauncher/);
    assert.match(launcher, /data-nav-launcher/);
    assert.match(launcher, /nav__launcher-disc/);
    assert.match(css, /\.nav__launcher-disc\s*\{[^}]*border-radius:\s*50%/s);
    assert.match(css, /\.nav__launcher-disc\s*\{[^}]*#22d3ee/s);
    assert.match(shell, /setNavLauncherVisible\(ownerSurface\)/);
    const ownerBlock = shell.match(/const OWNER_NAV[\s\S]*?\];/)[0];
    assert.doesNotMatch(ownerBlock, /key: 'more'/);
    assert.match(shell, /export const SUPERADMIN_NAV[\s\S]*key: 'more'/);
    assert.match(shell, /nav__routes/);
  });

  it('gives every screen a fresh <main> so listeners cannot pile up', () => {
    assert.match(shell, /function replaceMainNode/);
    assert.match(shell, /main\.replaceWith\(next\)/);
    assert.match(shell, /else replaceMainNode\(\);/);
  });

  it('keeps the open rail out of overflow-hidden ancestors', () => {
    assert.match(css, /\.home-split__rail\s*\{[^}]*overflow:\s*visible/s);
    assert.match(css, /\.home-split__rail\.is-open[\s\S]*?position:\s*fixed/);
    assert.match(css, /\.home-split__rail\.is-open[\s\S]*?z-index:\s*40/);
  });

  it('does not remount Inicio on live SSE ticks', () => {
    assert.match(home, /function patchSplitHome/);
    assert.match(home, /scheduleHomeRefresh/);
    assert.doesNotMatch(home, /event === 'call_event'/);
    assert.match(home, /Never replace #main after the first paint/);
    assert.match(launcher, /visualViewport/);
  });

  it('toggles without navigating', () => {
    assert.match(shell, /if \(event\.target\.closest\('\[data-nav-launcher\]'\)\) return;/);
    assert.match(launcher, /toggleMenu/);
    assert.doesNotMatch(launcher, /navigate\('\/settings'\)/);
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
  it('keeps the PR101 rail look and entrance', () => {
    assert.match(css, /\.home-split__rail\s*\{[^}]*transform:\s*translateX\(16px\)/s);
    assert.match(
      css,
      /\.home-launcher\.is-open \.home-split__rail,\s*\n\.home-split__rail\.is-open\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.94\)/s,
    );
    assert.match(
      css,
      /\.home-launcher\.is-open \.home-split__rail,\s*\n\.home-split__rail\.is-open\s*\{[^}]*width:\s*min\(268px, calc\(100vw - 24px\)\)/s,
    );
    assert.match(css, /@keyframes home-metric-glow[\s\S]*transform:\s*scale\(1\.04\)/);
  });

  it('keeps the KPI pulse on live value changes without repainting', () => {
    assert.match(home, /function replayMetricGlow/);
    assert.match(home, /replayMetricGlow\(doneEl\)/);
    assert.match(home, /replayMetricGlow\(pendingEl\)/);
  });

  it('measures the rail with offsetHeight so the slide-in cannot skew placement', () => {
    assert.match(launcher, /const height = menu\.offsetHeight;/);
    assert.match(launcher, /Math\.min\(menu\.offsetHeight, room\)/);
    assert.doesNotMatch(launcher, /menu\.style\.transform = 'none'/);
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
