/**
 * Shop owner home — shop name → trust tagline → logo launcher → dual KPI cards.
 */
import { api } from '../api.js';
import { subscribeShopLiveEvents } from '../data-cache.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { maybeRefreshPushSubscription } from '../push.js';
import { refreshBadges, store, loadSession, adoptDefaultShop } from '../store.js';
import { requireShop, screen, setContent, contentArea } from '../shell.js';
import { openNewBookingSheet } from './appointments.js';
import { esc, num } from '../ui.js';

/** Exact dropdown options for the home launcher. */
const GRID_ACTIONS = () => [
  { key: 'create', label: t('home.menu.createBooking'), iconName: 'plus' },
  { key: 'pending', label: t('home.menu.pendingToday'), iconName: 'calendar' },
  { key: 'vehicles', label: t('home.menu.vehicles'), iconName: 'car', path: '/vehiculos' },
  { key: 'diagnostics', label: t('home.menu.diagnostics'), iconName: 'stethoscope', path: '/diagnostico' },
  { key: 'inventory', label: t('home.menu.inventory'), iconName: 'box', path: '/inventario' },
  { key: 'urgencias', label: t('home.menu.urgencias'), iconName: 'phone', path: '/urgencias' },
];

function tileToneClass(key) {
  if (key === 'urgencias') return ' home-split__tile--urgencias';
  if (key === 'diagnostics') return ' home-split__tile--diagnostics';
  if (key === 'pending') return ' home-split__tile--pending';
  return '';
}

function ensureHeaderBrand() {
  const brand = document.querySelector('.header__brand');
  if (!brand) return;
  brand.classList.remove('header__brand--todo');
  // Do not rewrite brand markup when logo + wordmark already exist — preserves route-change animation.
  if (brand.querySelector('.header__logo') && brand.querySelector('.header__wordmark')) return;
  brand.innerHTML = `
    <img class="header__logo" src="/icons/logo-mark.svg" alt="" width="28" height="28">
    <span class="header__wordmark">derteapp</span>`;
}

function markHomeShell(active) {
  document.querySelector('.app')?.classList.toggle('app--home', active);
  document.querySelector('.header')?.classList.toggle('header--home', active);
  document.querySelector('.nav')?.classList.toggle('nav--home', active);
  if (!active) {
    clearGateMorph();
    markHomeGate(false);
  }
}

function readHomeGate() {
  const main = contentArea();
  return main?._homeGate !== false;
}

function writeHomeGate(gated) {
  const main = contentArea();
  if (main) main._homeGate = !!gated;
}

function markHomeGate(active) {
  document.documentElement.classList.toggle('is-home-gate', !!active);
}

function headerBrandEls() {
  return {
    logo: document.querySelector('.header__logo'),
    wordmark: document.querySelector('.header__wordmark'),
  };
}

function clearGateFlyer() {
  document.querySelectorAll(`.${GATE_FLYER_CLASS}`).forEach((node) => node.remove());
}

function clearGateMorph() {
  const html = document.documentElement;
  if (html._homeGateOpenEnd) {
    html.removeEventListener('transitionend', html._homeGateOpenEnd);
    delete html._homeGateOpenEnd;
  }
  if (html._homeGateOpenTimer) {
    clearTimeout(html._homeGateOpenTimer);
    delete html._homeGateOpenTimer;
  }
  if (html._homeGateWordTimer) {
    clearTimeout(html._homeGateWordTimer);
    delete html._homeGateWordTimer;
  }
  if (html._homeGateFadeTimer) {
    clearTimeout(html._homeGateFadeTimer);
    delete html._homeGateFadeTimer;
  }
  html.classList.remove('is-home-gate-opening');
  clearGateFlyer();
  const { logo, wordmark } = headerBrandEls();
  if (logo) {
    logo.style.removeProperty('opacity');
    logo.style.removeProperty('transition');
    logo.style.removeProperty('transform');
    logo.style.removeProperty('will-change');
  }
  wordmark?.classList.remove('is-collapsed', 'is-expanding');
}

function isGateMorphing() {
  return document.documentElement.classList.contains('is-home-gate-opening');
}

/** Dual home metrics: completed today (green) + pending urgencias/reservas (orange). */
function metricCopy(stats) {
  const pendingUrgencias = Number(stats?.pending_urgencias ?? 0) || 0;
  const pendingBookings = Number(stats?.pending_bookings_today ?? 0) || 0;
  return {
    done: {
      value: Number(stats?.completed_today ?? 0) || 0,
      label: t('home.jobsDoneToday'),
    },
    pending: {
      value: pendingUrgencias + pendingBookings,
      label: t('home.jobsPending'),
    },
  };
}

function gateCopyHtml() {
  return `
    <p class="home-split__welcome">${esc(t('home.gateWelcome'))}</p>
    <p class="home-split__trigger-hint">${esc(t('home.gateHint'))}</p>`;
}

function headingHtml(shopName = '') {
  const title = shopName
    ? `<h1 class="home-split__shop">${esc(shopName)}</h1>`
    : `<h1 class="home-split__shop home-split__shop--muted">${esc(t('home.noShopTitle'))}</h1>`;
  return `
    ${title}
    <p class="home-split__tagline">${esc(t('home.trustTagline'))}</p>`;
}

function metricsHtml(stats, { loading = false } = {}) {
  const metric = metricCopy(stats);
  const doneValue = loading ? '…' : num(metric.done.value);
  const pendingValue = loading ? '…' : num(metric.pending.value);
  return `
    <div class="home-split__metric" aria-live="polite" data-metric-card>
      <div class="home-split__kpi home-split__kpi--done">
        <div class="home-split__metric-value home-split__metric-value--done">${doneValue}</div>
        <div class="home-split__metric-label">${esc(metric.done.label)}</div>
      </div>
      <div class="home-split__kpi home-split__kpi--pending">
        <div class="home-split__metric-value home-split__metric-value--pending">${pendingValue}</div>
        <div class="home-split__metric-label">${esc(metric.pending.label)}</div>
      </div>
    </div>`;
}

/**
 * Restart the glow on a KPI whose value just changed. A full repaint used to do
 * this for free, but repainting is what closed the launcher mid-gesture.
 */
function replayMetricGlow(el) {
  if (!el) return;
  el.classList.remove('is-glowing');
  void el.offsetWidth;
  const onEnd = (event) => {
    if (event.target !== el) return;
    el.classList.remove('is-glowing');
    el.removeEventListener('animationend', onEnd);
  };
  el.addEventListener('animationend', onEnd);
  el.classList.add('is-glowing');
}

/** Update KPIs / shop name without replacing #main (keeps the launcher open). */
function patchSplitHome({ shopName = '', stats = null } = {}) {
  const root = contentArea()?.querySelector('[data-dashboard-home="split"]');
  if (!root) return false;

  const title = root.querySelector('.home-split__shop');
  if (title) {
    if (shopName) {
      title.textContent = shopName;
      title.classList.remove('home-split__shop--muted');
    } else {
      title.textContent = t('home.noShopTitle');
      title.classList.add('home-split__shop--muted');
    }
  }

  const metric = metricCopy(stats);
  const doneEl = root.querySelector('.home-split__metric-value--done');
  const pendingEl = root.querySelector('.home-split__metric-value--pending');
  const doneValue = num(metric.done.value);
  const pendingValue = num(metric.pending.value);
  if (doneEl && doneEl.textContent !== doneValue) {
    doneEl.textContent = doneValue;
    replayMetricGlow(doneEl);
  }
  if (pendingEl && pendingEl.textContent !== pendingValue) {
    pendingEl.textContent = pendingValue;
    replayMetricGlow(pendingEl);
  }
  return true;
}

function readMenuOpen() {
  const main = contentArea();
  return main?._homeMenuOpen === true;
}

function writeMenuOpen(open) {
  const main = contentArea();
  if (main) main._homeMenuOpen = !!open;
}

/**
 * Dock slide stays on the 0.35s ease-out. The official mark spins 0.5s
 * on open/close. Gate open is slower (0.72s) so the plate can dissolve
 * and the mark can travel to the header lockup without a snap.
 */
const FAB_MOVE_MS = 350;
const FAB_SPIN_MS = 500;
const FAB_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const GATE_OPEN_MS = 720;
const GATE_EASE = 'cubic-bezier(0.25, 1, 0.5, 1)';
const GATE_FLYER_CLASS = 'home-gate-flyer';

function brandMarkSvg() {
  return `<svg class="home-split__trigger-mark" viewBox="0 0 64 64" width="64" height="64" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 42c0-10 8-18 18-18h10"/>
      <path d="M36 18l10 6-6 10"/>
      <path d="M50 22c0 10-8 18-18 18H22"/>
      <path d="M28 46l-10-6 6-10"/>
    </g>
  </svg>`;
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** initial={false}: arm transitions only after the first paint so Inicio does not flicker. */
function armHomeMotion(split) {
  if (!split) return;
  const enable = () => split.classList.add('is-ready');
  if (prefersReducedMotion()) {
    enable();
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(enable);
  });
}

function clearTriggerSpin(swap, { restart = false } = {}) {
  if (!swap) return;
  if (swap._homeSpinEnd) {
    swap.removeEventListener('animationend', swap._homeSpinEnd);
    delete swap._homeSpinEnd;
  }
  if (swap._homeSpinTimer) {
    clearTimeout(swap._homeSpinTimer);
    delete swap._homeSpinTimer;
  }
  swap.classList.remove('is-spinning');
  if (!restart) return;
  // Only reflow when a new turn must restart from 0°. Doing this on settle
  // would flash the resting glyph for one frame after a 360° hold.
  swap.style.animation = 'none';
  void swap.offsetWidth;
  swap.style.removeProperty('animation');
}

/** Rotate the official mark 360°. The glyph never swaps to a wrench. */
function spinTriggerMark(toggle) {
  if (!toggle) return;
  const swap = toggle.querySelector('.home-split__trigger-swap');
  if (!swap || prefersReducedMotion()) return;
  clearTriggerSpin(swap, { restart: true });
  let settled = false;
  const finish = (event) => {
    if (event && event.target !== swap) return;
    if (settled) return;
    settled = true;
    clearTriggerSpin(swap);
  };
  swap._homeSpinEnd = finish;
  swap.addEventListener('animationend', finish);
  swap._homeSpinTimer = setTimeout(() => finish(), FAB_SPIN_MS + 40);
  swap.classList.add('is-spinning');
}

function clearTriggerFlip(toggle) {
  if (!toggle) return;
  if (toggle._homeFlipEnd) {
    toggle.removeEventListener('transitionend', toggle._homeFlipEnd);
    delete toggle._homeFlipEnd;
  }
  toggle.style.removeProperty('transition');
  toggle.style.removeProperty('transform');
  toggle.style.removeProperty('will-change');
}

/**
 * FLIP the cyan trigger only when its box actually moves (gate ↔ Inicio).
 * Inicio open/close keeps the 104px dock — flip then no-ops so the rest of
 * the screen never reflows. Never measure or move the rail.
 */
function flipTrigger(toggle, mutate, { duration = FAB_MOVE_MS, ease = FAB_EASE } = {}) {
  if (!toggle) {
    mutate();
    return;
  }
  clearTriggerFlip(toggle);
  if (prefersReducedMotion()) {
    mutate();
    return;
  }

  const first = toggle.getBoundingClientRect();
  mutate();
  const last = toggle.getBoundingClientRect();
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = last.width ? first.width / last.width : 1;
  const sy = last.height ? first.height / last.height : 1;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) {
    return;
  }

  toggle.style.willChange = 'transform';
  toggle.style.transition = 'none';
  toggle.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;
  void toggle.offsetWidth;

  const play = () => {
    toggle.style.transition = `transform ${duration / 1000}s ${ease}`;
    toggle.style.transform = '';
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(play);
  });

  const onEnd = (event) => {
    if (event.target !== toggle) return;
    if (event.propertyName && event.propertyName !== 'transform') return;
    clearTriggerFlip(toggle);
  };
  toggle._homeFlipEnd = onEnd;
  toggle.addEventListener('transitionend', onEnd);
}

function eventHitsSelector(event, selector) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node?.closest?.(selector)) return true;
  }
  return Boolean(event.target?.closest?.(selector));
}

function clearRailPosition(menu) {
  if (!menu) return;
  // Wipe the whole style attribute. A cached home.js used to write
  // position:fixed / left / top inline, which sat the white panel on top of
  // the KPI cards on iPhone even after the stylesheet moved to in-flow.
  menu.removeAttribute('style');
}

/**
 * Keep the open rail in the launcher flex row (grid beside the right-docked mark).
 *
 * Inline `position: fixed` used to drop the panel under the trigger and over the
 * KPI cards. On short screens the next tap then hit a tile (Reservas) or missed
 * the trigger. CSS in-flow layout cannot cover the button or the stats.
 */
function placeRail(toggle, menu) {
  if (!toggle || !menu) return;
  clearRailPosition(menu);
}

function applyLauncherDom(root, open) {
  const launcher = root?.querySelector('[data-home-launcher]');
  const menu = root?.querySelector('[data-home-logo-menu]');
  const toggle = root?.querySelector('[data-home-logo-toggle]');
  if (!launcher || !menu) return false;

  const nextOpen = !!open;
  writeMenuOpen(nextOpen);
  root?.classList.add('is-ready');

  launcher.classList.toggle('is-open', nextOpen);
  launcher.classList.remove('is-closing');
  menu.classList.toggle('is-open', nextOpen);
  menu.classList.remove('is-closing');
  toggle?.classList.toggle('is-open', nextOpen);
  toggle?.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  menu.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
  menu.querySelectorAll('[data-home-action]').forEach((btn) => {
    btn.tabIndex = nextOpen ? 0 : -1;
  });

  if (nextOpen) {
    menu.removeAttribute('inert');
    menu.style.removeProperty('pointer-events');
    placeRail(toggle, menu);
  } else {
    menu.setAttribute('inert', '');
    menu.style.pointerEvents = 'none';
    clearRailPosition(menu);
    if (menu.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }
  return nextOpen;
}

function setLauncherOpen(root, open) {
  const toggle = root?.querySelector('[data-home-logo-toggle]');
  const nextOpen = !!open;
  flipTrigger(toggle, () => applyLauncherDom(root, nextOpen));
  spinTriggerMark(toggle);
  return nextOpen;
}

function settleOpenFromGate(root) {
  const toggle = root?.querySelector('[data-home-logo-toggle]');
  clearGateMorph();
  writeHomeGate(false);
  markHomeGate(false);
  applyLauncherDom(root, true);
}

function spawnGateFlyer(fromRect, toRect) {
  const flyer = document.createElement('span');
  flyer.className = GATE_FLYER_CLASS;
  flyer.setAttribute('aria-hidden', 'true');
  flyer.innerHTML = brandMarkSvg().replaceAll('home-split__trigger-mark', 'home-gate-flyer__mark');
  const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
  const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
  const sx = toRect.width ? fromRect.width / toRect.width : 1;
  const sy = toRect.height ? fromRect.height / toRect.height : 1;
  flyer.style.cssText = [
    `left:${toRect.left}px`,
    `top:${toRect.top}px`,
    `width:${toRect.width}px`,
    `height:${toRect.height}px`,
    'opacity:1',
    `transform:translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
  ].join(';');
  document.body.append(flyer);
  void flyer.offsetWidth;
  return flyer;
}

function openFromGate(root) {
  const toggle = root?.querySelector('[data-home-logo-toggle]');
  const mark = toggle?.querySelector('.home-split__trigger-mark');
  const { logo } = headerBrandEls();
  if (!toggle || prefersReducedMotion() || !mark || !logo) {
    settleOpenFromGate(root);
    return;
  }

  clearGateMorph();
  ensureHeaderBrand();
  const first = mark.getBoundingClientRect();
  const last = logo.getBoundingClientRect();
  if (last.width < 2 || last.height < 2) {
    settleOpenFromGate(root);
    return;
  }

  const html = document.documentElement;
  const flyer = spawnGateFlyer(first, last);
  mark.style.opacity = '0';
  html.classList.add('is-home-gate-opening');

  const play = () => {
    const seconds = GATE_OPEN_MS / 1000;
    const fadeDelay = Math.max(0.42, seconds - 0.22);
    flyer.style.transition = `transform ${seconds}s ${GATE_EASE}`;
    void flyer.offsetWidth;
    flyer.style.transform = 'translate3d(0, 0, 0) scale(1)';
    html._homeGateFadeTimer = setTimeout(() => {
      flyer.style.transition = `opacity 0.22s ${GATE_EASE}`;
      flyer.style.opacity = '0';
    }, fadeDelay * 1000);
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(play);
  });

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    mark.style.removeProperty('opacity');
    settleOpenFromGate(root);
  };
  html._homeGateOpenEnd = (event) => {
    if (event.target !== flyer || (event.propertyName && event.propertyName !== 'transform')) return;
    finish();
  };
  flyer.addEventListener('transitionend', html._homeGateOpenEnd);
  html._homeGateOpenTimer = setTimeout(finish, GATE_OPEN_MS + 40);
}

function closeToGate(root) {
  const toggle = root?.querySelector('[data-home-logo-toggle]');
  clearGateMorph();
  flipTrigger(
    toggle,
    () => {
      applyLauncherDom(root, false);
      writeHomeGate(true);
      markHomeGate(true);
    },
    { duration: GATE_OPEN_MS, ease: GATE_EASE },
  );
  spinTriggerMark(toggle);
}

function launcherHtml({ menuOpen = false } = {}) {
  return `
    <div class="home-launcher${menuOpen ? ' is-open' : ''}" data-home-launcher>
      <button
        type="button"
        class="home-split__trigger${menuOpen ? ' is-open' : ''}"
        data-home-logo-toggle
        aria-expanded="${menuOpen ? 'true' : 'false'}"
        aria-controls="home-logo-menu"
        aria-label="${esc(t('home.logoMenuAria'))}"
      >
        <span class="home-split__trigger-swap" aria-hidden="true">
          ${brandMarkSvg()}
        </span>
      </button>
      <div
        id="home-logo-menu"
        class="home-split__rail${menuOpen ? ' is-open' : ''}"
        data-home-logo-menu
        role="menu"
        aria-hidden="${menuOpen ? 'false' : 'true'}"
        ${menuOpen ? '' : 'inert'}
      >
        ${GRID_ACTIONS()
          .map(
            (item) => `
          <button
            type="button"
            class="home-split__tile${tileToneClass(item.key)}"
            role="menuitem"
            data-home-action="${esc(item.key)}"
            tabindex="${menuOpen ? '0' : '-1'}"
            ${item.path ? `data-home-path="${esc(item.path)}"` : ''}
          >
            <span class="home-split__tile-icon${item.key === 'urgencias' ? ' home-split__tile-icon--alert' : ''}" aria-hidden="true">${icon(item.iconName, { size: 22 })}</span>
            <span class="home-split__tile-label">${esc(item.label)}</span>
          </button>`,
          )
          .join('')}
      </div>
    </div>`;
}

function paintSplitHome({
  shopName = '',
  stats = null,
  menuOpen = false,
  gated = true,
} = {}) {
  ensureHeaderBrand();
  markHomeShell(true);
  writeHomeGate(gated);
  markHomeGate(gated);

  const result = setContent(`
    <div class="home-split" data-dashboard-home="split">
      ${gateCopyHtml()}
      <div class="home-split__stack">
        ${headingHtml(shopName)}

        ${launcherHtml({ menuOpen: menuOpen && !gated })}

        ${metricsHtml(stats)}
      </div>
    </div>`);
  armHomeMotion(contentArea()?.querySelector('.home-split'));
  return result;
}

/**
 * Binds the launcher for one mount and returns the unbind.
 *
 * Every listener shares a single AbortController: two live bindings would each
 * carry their own debounce state, so one opened the menu while the other closed
 * it on the very same tap.
 */
function bindHomeActions(shop) {
  const main = contentArea();
  if (!main) return () => {};
  // A previous mount that never got cleaned up must not keep listening.
  main._homeAbort?.abort();
  const controller = new AbortController();
  const { signal } = controller;
  main._homeAbort = controller;

  let lastToggleAt = 0;
  let ignoreOpenUntil = 0;
  let ignoreCloseUntil = 0;
  /** Until this moment the freshly opened rail ignores taps of the same gesture. */
  let railArmedAt = 0;
  const GESTURE_MS = 700;
  const TAP_DUP_MS = 80;
  const TRIPLE_MS = 600;
  let tapTimes = [];

  const toggleMenu = (root) => {
    const now = Date.now();
    // One physical tap can fire touchstart + pointerup + click.
    if (now - lastToggleAt < TAP_DUP_MS) return;
    lastToggleAt = now;

    if (isGateMorphing()) return;

    if (readHomeGate()) {
      tapTimes = [];
      openFromGate(root);
      ignoreCloseUntil = now + GATE_OPEN_MS + 80;
      railArmedAt = now + GATE_OPEN_MS + 80;
      return;
    }

    tapTimes = tapTimes.filter((stamp) => now - stamp < TRIPLE_MS);
    tapTimes.push(now);
    if (tapTimes.length >= 3) {
      tapTimes = [];
      closeToGate(root);
      return;
    }

    const nextOpen = !readMenuOpen();
    setLauncherOpen(root, nextOpen);
    if (nextOpen) {
      ignoreCloseUntil = now + GESTURE_MS;
      railArmedAt = now + 400;
    }
  };

  const closeIfOutside = (event) => {
    if (!readMenuOpen()) return;
    if (Date.now() < ignoreCloseUntil) return;
    // Only the trigger and the tiles keep the rail open. A tap on the rail's
    // own padding closes it, so the menu can always be dismissed even if the
    // panel ends up covering whatever the user meant to press.
    if (eventHitsSelector(event, '[data-home-logo-toggle], [data-home-action]')) return;
    const root = main.querySelector('.home-split');
    if (root) setLauncherOpen(root, false);
  };
  // Bubble-phase click (not capture pointerdown): a capture listener closed
  // the menu before the tap reached the trigger on iOS.
  document.addEventListener('click', closeIfOutside, { signal });

  const onViewportChange = () => {
    if (!readMenuOpen()) return;
    const root = main.querySelector('.home-split');
    const toggle = root?.querySelector('[data-home-logo-toggle]');
    const menu = root?.querySelector('[data-home-logo-menu]');
    placeRail(toggle, menu);
  };
  window.addEventListener('resize', onViewportChange, { signal });
  window.addEventListener('orientationchange', onViewportChange, { signal });
  window.visualViewport?.addEventListener('resize', onViewportChange, { signal });
  window.visualViewport?.addEventListener('scroll', onViewportChange, { signal });

  const onOpenGesture = (event) => {
    const toggle = event.target.closest('[data-home-logo-toggle]');
    if (!toggle) return;
    // One physical tap can fire touchstart + pointerup + click. Only the
    // first one toggles; the rest of the same gesture must not close it.
    if (event.type !== 'touchstart' && Date.now() < ignoreOpenUntil) return;
    const root = toggle.closest('.home-split');
    if (!root) return;
    if (event.type === 'touchstart' || event.pointerType === 'touch') {
      ignoreOpenUntil = Date.now() + GESTURE_MS;
    }
    toggleMenu(root);
  };
  // pointerup covers mouse + modern touch. touchstart is the iOS fallback
  // when a capture-phase click never arrives. click stays for keyboard/AT.
  // Do not stopPropagation — a parent listener must still see the tap.
  main.addEventListener('touchstart', onOpenGesture, { passive: true, signal });
  main.addEventListener('pointerup', onOpenGesture, { signal });
  main.addEventListener(
    'click',
    (event) => {
      const toggle = event.target.closest('[data-home-logo-toggle]');
      if (toggle) {
        onOpenGesture(event);
        return;
      }

      const action = event.target.closest('[data-home-action]');
      if (!action) return;
      if (Date.now() < railArmedAt) return;
      const root = action.closest('.home-split');
      if (root) setLauncherOpen(root, false);
      const kind = action.dataset.homeAction;

      if (kind === 'create') {
        if (shop) openNewBookingSheet(shop, () => void refreshBadges());
        return;
      }
      if (kind === 'pending') {
        navigate('/appointments?filter=today');
        return;
      }
      const path = action.dataset.homePath;
      if (path) navigate(path);
    },
    { signal },
  );

  return () => {
    controller.abort();
    if (main._homeAbort === controller) delete main._homeAbort;
  };
}

export async function homeView() {
  if (!store.user?.id && !store.user?.uid) {
    try {
      await loadSession();
    } catch {
      // soft shell below
    }
  }

  // Layout equivalent of useEffect: if permission granted, upsert push token.
  if (store.isAuthenticated) {
    void maybeRefreshPushSubscription();
  }

  let shop = store.activeShop;
  if (!shop) {
    try {
      await loadSession();
      shop = adoptDefaultShop();
    } catch {
      // fall through
    }
  }

  if (!store.user?.id && !store.user?.uid) {
    screen({
      title: t('home.todoEnUno'),
      nav: 'home',
      shopSwitcher: false,
      content: '',
    });
    writeMenuOpen(false);
    writeHomeGate(true);
    paintSplitHome({ shopName: '', stats: null, menuOpen: false, gated: true });
    return () => {
      markHomeShell(false);
      const main = contentArea();
      main?._homeAbort?.abort();
      if (main) {
        main._homeMenuOpen = false;
        main._homeGate = true;
      }
    };
  }

  shop = requireShop({ title: t('home.todoEnUno'), navKey: 'home' });
  if (!shop) return undefined;

  let loading = false;
  let pendingReload = false;
  let latestStats = null;
  let liveTimer = 0;

  writeMenuOpen(false);
  writeHomeGate(true);
  markHomeGate(true);

  screen({
    title: t('nav.home'),
    subtitle: '',
    nav: 'home',
    shopSwitcher: true,
    flush: true,
    content: `
      <div class="home-split" data-dashboard-home="split">
        ${gateCopyHtml()}
        <div class="home-split__stack">
          ${headingHtml(shop.name)}
          ${launcherHtml({ menuOpen: false })}
          ${metricsHtml(null, { loading: true })}
        </div>
      </div>`,
  });

  writeMenuOpen(false);
  writeHomeGate(true);
  markHomeGate(true);
  ensureHeaderBrand();
  markHomeShell(true);
  armHomeMotion(contentArea()?.querySelector('.home-split'));
  const unbindActions = bindHomeActions(shop);

  async function load() {
    if (loading) {
      pendingReload = true;
      return;
    }
    loading = true;
    try {
      const overview = await api.overview(shop.id);
      latestStats = overview?.stats ?? null;
    } catch {
      latestStats = null;
    } finally {
      loading = false;
    }
    // Never replace #main after the first paint: setContent destroys the
    // launcher mid-gesture and replays width/scale CSS (looks like zoom).
    if (!patchSplitHome({ shopName: shop.name, stats: latestStats })) {
      paintSplitHome({
        shopName: shop.name,
        stats: latestStats,
        menuOpen: readMenuOpen(),
        gated: readHomeGate(),
      });
    }
    if (readMenuOpen()) {
      const root = contentArea()?.querySelector('.home-split');
      placeRail(
        root?.querySelector('[data-home-logo-toggle]'),
        root?.querySelector('[data-home-logo-menu]'),
      );
    }
    if (pendingReload) {
      pendingReload = false;
      void load();
    }
  }

  await load();
  await refreshBadges();

  const scheduleHomeRefresh = () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void load(), 400);
  };

  const unsubLive = subscribeShopLiveEvents((event) => {
    // call_event / chat_message must not remount Inicio — they do not change KPIs.
    if (event.startsWith('appointment_') || event.startsWith('urgencia_')) {
      scheduleHomeRefresh();
    }
    if (event === 'appointment_created' || event === 'urgencia_created' || event === 'chat_message') {
      void refreshBadges();
    }
  });

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void load();
      void refreshBadges();
    }
  }, 60_000);

  return () => {
    unsubLive();
    clearInterval(timer);
    clearTimeout(liveTimer);
    unbindActions();
    markHomeShell(false);
    const main = contentArea();
    if (main) {
      main._homeMenuOpen = false;
      main._homeGate = true;
    }
  };
}
