/**
 * Shop owner home — centered dashboard hierarchy:
 * shop name → TODO EN UNO + wrench → Menú desplegable → logo trigger → dual metrics → 2×2 grid.
 */
import { api, stream } from '../api.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { maybeRefreshPushSubscription } from '../push.js';
import { refreshBadges, store, loadSession, setActiveShop, openPlatformSupport } from '../store.js';
import { requireShop, screen, setContent, contentArea } from '../shell.js';
import { openNewBookingSheet } from './appointments.js';
import { esc, num, closeButtonHtml } from '../ui.js';

/** Exact dropdown options for the home launcher. */
const GRID_ACTIONS = () => [
  { key: 'create', label: t('home.menu.createBooking'), iconName: 'plus' },
  { key: 'pending', label: t('home.menu.pendingToday'), iconName: 'calendar' },
  { key: 'support', label: t('home.menu.support'), iconName: 'chat', support: true },
  { key: 'urgencias', label: t('home.menu.urgencias'), iconName: 'phone', path: '/urgencias' },
];

function ensureHeaderBrand() {
  const brand = document.querySelector('.header__brand');
  if (!brand) return;
  brand.innerHTML = `
    <img class="header__logo" src="/icons/logo-mark.svg" alt="" width="28" height="28">
    <span class="header__wordmark">derteapp</span>`;
  brand.classList.remove('header__brand--todo');
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

function todoTitleHtml() {
  return `
    <h1 class="home-split__todo">
      <span class="home-split__todo-text">${esc(t('home.todoEnUno'))}</span>
      ${icon('wrench', { size: 36, className: 'home-split__todo-wrench' })}
    </h1>`;
}

function metricsHtml(stats, { loading = false } = {}) {
  const metric = metricCopy(stats);
  const doneValue = loading ? '…' : num(metric.done.value);
  const pendingValue = loading ? '…' : num(metric.pending.value);
  return `
    <div class="home-split__metric" aria-live="polite" data-metric-card>
      <div class="home-split__metric-col">
        <div class="home-split__metric-value home-split__metric-value--done">${doneValue}</div>
        <div class="home-split__metric-label">${esc(metric.done.label)}</div>
      </div>
      <div class="home-split__metric-col">
        <div class="home-split__metric-value home-split__metric-value--pending">${pendingValue}</div>
        <div class="home-split__metric-label">${esc(metric.pending.label)}</div>
      </div>
    </div>`;
}

function gridHtml({ menuOpen = false } = {}) {
  return `
    <div
      id="home-logo-menu"
      class="home-split__grid${menuOpen ? ' is-open' : ''}"
      data-home-logo-menu
      ${menuOpen ? '' : 'hidden'}
      role="menu"
    >
      <div class="home-split__grid-head">
        ${closeButtonHtml({
          className: 'home-split__menu-close',
          'data-home-menu-close': true,
        })}
      </div>
      <div class="home-split__grid-tiles">
        ${GRID_ACTIONS()
          .map(
            (item) => `
          <button
            type="button"
            class="home-split__tile"
            role="menuitem"
            data-home-action="${esc(item.key)}"
            ${item.path ? `data-home-path="${esc(item.path)}"` : ''}
            ${item.support ? 'data-home-support="1"' : ''}
          >
            <span class="home-split__tile-icon" aria-hidden="true">${icon(item.iconName, { size: 26 })}</span>
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
  menuOpen = true,
} = {}) {
  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shopName || t('home.todoEnUno'))}</span>`;
  }
  ensureHeaderBrand();
  markHomeShell(true);

  const shopLabel = shopName
    ? `<p class="home-split__shop">${esc(shopName)}</p>`
    : `<p class="home-split__shop home-split__shop--muted">${esc(t('home.noShopTitle'))}</p>`;

  return setContent(`
    <div class="home-split" data-dashboard-home="split">
      <div class="home-split__stack">
        ${shopLabel}
        ${todoTitleHtml()}
        <p class="home-split__menu-kicker">${esc(t('home.dropdownTitle'))}</p>

        <button
          type="button"
          class="home-split__trigger${menuOpen ? ' is-open' : ''}"
          data-home-logo-toggle
          aria-expanded="${menuOpen ? 'true' : 'false'}"
          aria-controls="home-logo-menu"
          aria-label="${esc(t('home.logoMenuAria'))}"
        >
          <img class="home-split__trigger-mark" src="/icons/logo-mark.svg" alt="" width="88" height="88">
          <span class="home-split__trigger-hint" aria-hidden="true"></span>
        </button>

        ${metricsHtml(stats)}

        ${gridHtml({ menuOpen })}
      </div>
    </div>`);
}

function bindHomeActions(shop) {
  const main = contentArea();
  if (!main || main.dataset.homeActionsBound === '1') return;
  main.dataset.homeActionsBound = '1';

  main.addEventListener('click', (event) => {
    const closeMenu = event.target.closest('[data-home-menu-close]');
    if (closeMenu) {
      event.preventDefault();
      event.stopPropagation();
      const root = closeMenu.closest('.home-split');
      const menu = root?.querySelector('[data-home-logo-menu]');
      const toggle = root?.querySelector('[data-home-logo-toggle]');
      if (!menu) return;
      menu.classList.remove('is-open');
      menu.hidden = true;
      toggle?.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
      return;
    }

    const toggle = event.target.closest('[data-home-logo-toggle]');
    if (toggle) {
      const root = toggle.closest('.home-split');
      const menu = root?.querySelector('[data-home-logo-menu]');
      if (!menu) return;
      const open = !menu.classList.contains('is-open');
      menu.classList.toggle('is-open', open);
      menu.hidden = !open;
      toggle.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }

    const action = event.target.closest('[data-home-action]');
    if (!action) return;
    const kind = action.dataset.homeAction;

    if (kind === 'create') {
      if (shop) openNewBookingSheet(shop, () => void refreshBadges());
      return;
    }
    if (kind === 'pending') {
      navigate('/appointments?filter=today');
      return;
    }
    if (action.dataset.homeSupport === '1' || kind === 'support') {
      openPlatformSupport();
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
      shop = store.activeShop;
      if (!shop && store.shops?.[0]) {
        setActiveShop(store.shops[0].id);
        shop = store.activeShop;
      }
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
    paintSplitHome({ shopName: '', stats: null, menuOpen: true });
    return () => {
      markHomeShell(false);
      const main = contentArea();
      if (main) delete main.dataset.homeActionsBound;
    };
  }

  shop = requireShop({ title: t('home.todoEnUno'), navKey: 'home' });
  if (!shop) return undefined;

  let loading = false;
  let menuOpen = true;
  let latestStats = null;

  screen({
    title: shop.name,
    subtitle: '',
    nav: 'home',
    shopSwitcher: true,
    flush: true,
    content: `
      <div class="home-split" data-dashboard-home="split">
        <div class="home-split__stack">
          <p class="home-split__shop">${esc(shop.name)}</p>
          ${todoTitleHtml()}
          <p class="home-split__menu-kicker">${esc(t('home.dropdownTitle'))}</p>
          <button type="button" class="home-split__trigger is-open" data-home-logo-toggle aria-expanded="true" aria-controls="home-logo-menu">
            <img class="home-split__trigger-mark" src="/icons/logo-mark.svg" alt="" width="88" height="88">
            <span class="home-split__trigger-hint" aria-hidden="true"></span>
          </button>
          ${metricsHtml(null, { loading: true })}
        </div>
      </div>`,
  });

  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shop.name)}</span>`;
  }
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
    const menu = contentArea()?.querySelector('[data-home-logo-menu]');
    menuOpen = menu ? menu.classList.contains('is-open') : true;
    paintSplitHome({
      shopName: shop.name,
      stats: latestStats,
      menuOpen,
    });
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
    if (main) delete main.dataset.homeActionsBound;
  };
}
