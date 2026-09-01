/**
 * Shop owner home — shop name → trust tagline → logo launcher → dual KPI cards.
 */
import { api, stream } from '../api.js';
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
  menu.style.removeProperty('margin');
}

/** Pin the home menu to the viewport so overflow on parents cannot clip it. */
function placeRail(toggle, menu) {
  if (!toggle || !menu) return;
  const rect = toggle.getBoundingClientRect();
  const gutter = 8;
  const width = Math.min(268, Math.max(160, window.innerWidth - gutter * 2));
  const narrow = window.innerWidth < 520;
  let left;
  let top;
  if (narrow) {
    left = rect.left + rect.width / 2 - width / 2;
    top = rect.bottom + 10;
  } else {
    left = rect.right + 8;
    if (left + width > window.innerWidth - gutter) {
      left = rect.left - width - 8;
    }
    top = rect.top;
  }
  left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter));
  top = Math.max(gutter, top);
  menu.style.position = 'fixed';
  menu.style.zIndex = '40';
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.width = `${Math.round(width)}px`;
  menu.style.maxWidth = `${Math.round(width)}px`;
  menu.style.margin = '0';
  requestAnimationFrame(() => {
    const box = menu.getBoundingClientRect();
    if (box.bottom > window.innerHeight - gutter) {
      const above = rect.top - box.height - 10;
      menu.style.top = `${Math.round(Math.max(gutter, above > gutter ? above : window.innerHeight - box.height - gutter))}px`;
    }
  });
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

function bindHomeActions(shop) {
  const main = contentArea();
  if (!main || main.dataset.homeActionsBound === '1') return;
  main.dataset.homeActionsBound = '1';

  let lastToggleAt = 0;
  let ignoreOpenUntil = 0;
  let ignoreCloseUntil = 0;
  const toggleMenu = (root) => {
    const now = Date.now();
    if (now - lastToggleAt < 350) return;
    lastToggleAt = now;
    const next = !readMenuOpen();
    setLauncherOpen(root, next);
    if (next) ignoreCloseUntil = now + 500;
  };

  const closeIfOutside = (event) => {
    if (!readMenuOpen()) return;
    if (Date.now() < ignoreCloseUntil) return;
    if (eventHitsSelector(event, '[data-home-logo-toggle], [data-home-logo-menu]')) return;
    const root = main.querySelector('.home-split');
    if (root) setLauncherOpen(root, false);
  };
  // Bubble-phase click (not capture pointerdown): a capture listener closed
  // the menu before the tap reached the trigger on iOS.
  document.addEventListener('click', closeIfOutside);
  main._homeOutsideClose = closeIfOutside;

  const onViewportChange = () => {
    if (!readMenuOpen()) return;
    const root = main.querySelector('.home-split');
    const toggle = root?.querySelector('[data-home-logo-toggle]');
    const menu = root?.querySelector('[data-home-logo-menu]');
    placeRail(toggle, menu);
  };
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  main._homeReposition = onViewportChange;

  const onOpenGesture = (event) => {
    const toggle = event.target.closest('[data-home-logo-toggle]');
    if (!toggle) return;
    if (event.type !== 'touchstart' && Date.now() < ignoreOpenUntil) return;
    const root = toggle.closest('.home-split');
    if (!root) return;
    if (event.type === 'touchstart') ignoreOpenUntil = Date.now() + 700;
    toggleMenu(root);
  };
  // pointerup covers mouse + modern touch. touchstart is the iOS fallback
  // when a capture-phase click never arrives. click stays for keyboard/AT.
  // Do not stopPropagation — a parent listener must still see the tap.
  main.addEventListener('touchstart', onOpenGesture, { passive: true });
  main.addEventListener('pointerup', onOpenGesture);
  main.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-home-logo-toggle]');
    if (toggle) {
      onOpenGesture(event);
      return;
    }

    const action = event.target.closest('[data-home-action]');
    if (!action) return;
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
  });
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
      if (main?._homeOutsideClose) {
        document.removeEventListener('click', main._homeOutsideClose);
        delete main._homeOutsideClose;
      }
      if (main?._homeReposition) {
        window.removeEventListener('resize', main._homeReposition);
        window.removeEventListener('orientationchange', main._homeReposition);
        delete main._homeReposition;
      }
      if (main) {
        main._homeMenuOpen = false;
        delete main.dataset.homeActionsBound;
      }
    };
  }

  shop = requireShop({ title: t('home.todoEnUno'), navKey: 'home' });
  if (!shop) return undefined;

  let loading = false;
  let latestStats = null;

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
  bindHomeActions(shop);

  async function load() {
    if (loading) return;
    loading = true;
    try {
      const overview = await api.overview(shop.id);
      latestStats = overview?.stats ?? null;
    } catch {
      latestStats = null;
    } finally {
      loading = false;
    }
    paintSplitHome({
      shopName: shop.name,
      stats: latestStats,
      menuOpen: readMenuOpen(),
    });
    if (readMenuOpen()) {
      const root = contentArea()?.querySelector('.home-split');
      placeRail(
        root?.querySelector('[data-home-logo-toggle]'),
        root?.querySelector('[data-home-logo-menu]'),
      );
    }
  }

  await load();
  await refreshBadges();

  const stopStream = stream(`/chat/stream?shop_id=${shop.id}`, {
    appointment_created: () => {
      void load();
      void refreshBadges();
    },
    appointment_updated: () => void load(),
    urgencia_created: () => {
      void load();
      void refreshBadges();
    },
    urgencia_updated: () => void load(),
    urgencia_accepted: () => void load(),
    urgencia_cancelled: () => void load(),
    chat_message: () => void refreshBadges(),
    call_event: () => void load(),
  });

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void load();
      void refreshBadges();
    }
  }, 60_000);

  return () => {
    stopStream();
    clearInterval(timer);
    markHomeShell(false);
    const main = contentArea();
    if (main?._homeOutsideClose) {
      document.removeEventListener('click', main._homeOutsideClose);
      delete main._homeOutsideClose;
    }
    if (main?._homeReposition) {
      window.removeEventListener('resize', main._homeReposition);
      window.removeEventListener('orientationchange', main._homeReposition);
      delete main._homeReposition;
    }
    if (main) {
      main._homeMenuOpen = false;
      delete main.dataset.homeActionsBound;
    }
  };
}
