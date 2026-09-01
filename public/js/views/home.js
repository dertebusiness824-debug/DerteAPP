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

function viewportBox() {
  const vv = window.visualViewport;
  if (vv) {
    return {
      width: vv.width,
      height: vv.height,
      left: vv.offsetLeft,
      top: vv.offsetTop,
    };
  }
  return { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
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
  if (doneEl && doneEl.textContent !== doneValue) doneEl.textContent = doneValue;
  if (pendingEl && pendingEl.textContent !== pendingValue) pendingEl.textContent = pendingValue;
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

function clearTriggerSpin(mark) {
  if (!mark) return;
  mark.classList.remove('is-spinning');
  mark.style.animation = 'none';
  void mark.offsetWidth;
  mark.style.removeProperty('animation');
}

function playTriggerSpin(mark) {
  if (!mark) return;
  clearTriggerSpin(mark);
  const onEnd = (event) => {
    if (event.target !== mark) return;
    mark.classList.remove('is-spinning');
    mark.removeEventListener('animationend', onEnd);
  };
  mark.addEventListener('animationend', onEnd);
  mark.classList.add('is-spinning');
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
  menu.style.removeProperty('position');
  menu.style.removeProperty('z-index');
  menu.style.removeProperty('left');
  menu.style.removeProperty('top');
  menu.style.removeProperty('width');
  menu.style.removeProperty('max-width');
  menu.style.removeProperty('max-height');
  menu.style.removeProperty('overflow-y');
  menu.style.removeProperty('margin');
}

/**
 * Pin the home menu to the visual viewport so overflow on parents cannot clip it.
 *
 * The rail must never be laid over the trigger. When it was, the button stopped
 * being hit-testable: the next tap landed on a tile, which either froze the menu
 * open or navigated to Reservas on its own. Short screens therefore cap the rail
 * to the free space on whichever side of the trigger is larger and let it scroll.
 */
function placeRail(toggle, menu) {
  if (!toggle || !menu) return;
  const rect = toggle.getBoundingClientRect();
  const vp = viewportBox();
  const gutter = 8;
  const gap = 10;
  const width = Math.min(268, Math.max(120, vp.width - gutter * 2));
  const viewTop = vp.top + gutter;
  // The bottom navigation is fixed; the rail must stop above it, not on top of it.
  const navTop = document.querySelector('.nav')?.getBoundingClientRect().top ?? Infinity;
  const viewBottom = Math.min(vp.top + vp.height, navTop) - gutter;

  menu.style.position = 'fixed';
  menu.style.zIndex = '40';
  menu.style.margin = '0';
  menu.style.transform = 'none';
  menu.style.width = `${Math.round(width)}px`;
  menu.style.maxWidth = `${Math.round(width)}px`;
  menu.style.overflowY = 'auto';

  if (vp.width >= 520) {
    // Beside the trigger, so vertical overlap cannot bury the button.
    let left = rect.right + gap;
    if (left + width > vp.left + vp.width - gutter) left = rect.left - width - gap;
    menu.style.left = `${Math.round(Math.max(vp.left + gutter, Math.min(left, vp.left + vp.width - width - gutter)))}px`;
    menu.style.maxHeight = `${Math.round(Math.max(0, viewBottom - viewTop))}px`;
    const height = menu.getBoundingClientRect().height;
    menu.style.top = `${Math.round(Math.max(viewTop, Math.min(rect.top, viewBottom - height)))}px`;
    return;
  }

  const left = rect.left + rect.width / 2 - width / 2;
  menu.style.left = `${Math.round(Math.max(vp.left + gutter, Math.min(left, vp.left + vp.width - width - gutter)))}px`;

  const spaceBelow = viewBottom - (rect.bottom + gap);
  const spaceAbove = rect.top - gap - viewTop;
  const below = spaceBelow >= spaceAbove;
  const room = Math.max(0, Math.round(below ? spaceBelow : spaceAbove));
  menu.style.maxHeight = `${room}px`;
  const height = Math.min(menu.getBoundingClientRect().height, room);
  menu.style.top = `${Math.round(below ? rect.bottom + gap : rect.top - gap - height)}px`;
}

function setLauncherOpen(root, open) {
  const launcher = root?.querySelector('[data-home-launcher]');
  const menu = root?.querySelector('[data-home-logo-menu]');
  const toggle = root?.querySelector('[data-home-logo-toggle]');
  if (!launcher || !menu) return false;

  const nextOpen = !!open;
  writeMenuOpen(nextOpen);

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

  const mark = launcher.querySelector('.home-split__trigger-mark');

  if (nextOpen) {
    menu.removeAttribute('inert');
    menu.style.removeProperty('pointer-events');
    placeRail(toggle, menu);
    playTriggerSpin(mark);
    return true;
  }

  menu.setAttribute('inert', '');
  menu.style.pointerEvents = 'none';
  clearRailPosition(menu);
  if (menu.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  clearTriggerSpin(mark);
  return false;
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
        <img class="home-split__trigger-mark" src="/icons/logo-mark.svg" alt="" width="64" height="64">
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
            class="home-split__tile"
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
} = {}) {
  ensureHeaderBrand();
  markHomeShell(true);

  return setContent(`
    <div class="home-split" data-dashboard-home="split">
      <div class="home-split__stack">
        ${headingHtml(shopName)}

        ${launcherHtml({ menuOpen })}

        ${metricsHtml(stats)}
      </div>
    </div>`);
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

  const toggleMenu = (root) => {
    const now = Date.now();
    if (now - lastToggleAt < 400) return;
    lastToggleAt = now;
    const next = !readMenuOpen();
    setLauncherOpen(root, next);
    if (next) {
      ignoreCloseUntil = now + GESTURE_MS;
      // The tap that opens the rail also produces a click once the tiles are
      // already on screen — without this, "Crear reserva" opened by itself.
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
    paintSplitHome({ shopName: '', stats: null, menuOpen: false });
    return () => {
      markHomeShell(false);
      const main = contentArea();
      main?._homeAbort?.abort();
      if (main) main._homeMenuOpen = false;
    };
  }

  shop = requireShop({ title: t('home.todoEnUno'), navKey: 'home' });
  if (!shop) return undefined;

  let loading = false;
  let pendingReload = false;
  let latestStats = null;
  let liveTimer = 0;

  screen({
    title: t('nav.home'),
    subtitle: '',
    nav: 'home',
    shopSwitcher: true,
    flush: true,
    content: `
      <div class="home-split" data-dashboard-home="split">
        <div class="home-split__stack">
          ${headingHtml(shop.name)}
          ${launcherHtml({ menuOpen: false })}
          ${metricsHtml(null, { loading: true })}
        </div>
      </div>`,
  });

  writeMenuOpen(false);
  ensureHeaderBrand();
  markHomeShell(true);
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
    if (main) main._homeMenuOpen = false;
  };
}
