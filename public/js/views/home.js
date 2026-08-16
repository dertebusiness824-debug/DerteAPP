/**
 * Shop owner home — split panel.
 * Left: Menú desplegable (logo trigger, metric card, 2×2 action grid).
 * Right: TODO EN UNO brand + shop name.
 */
import { api, stream } from '../api.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { refreshBadges, store, loadSession, setActiveShop, openPlatformSupport } from '../store.js';
import { requireShop, screen, setContent, contentArea } from '../shell.js';
import { openNewBookingSheet } from './appointments.js';
import { esc, num } from '../ui.js';

/** Exact dropdown options requested for the home launcher. */
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

function metricCopy(metricMode, stats) {
  if (metricMode === 'pending') {
    const pending =
      Math.max(
        0,
        (Number(stats?.today_total ?? 0) || 0) - (Number(stats?.completed_today ?? 0) || 0),
      ) ||
      Number(stats?.confirmed_today ?? 0) ||
      0;
    return {
      value: pending,
      label: t('home.jobsPendingToday'),
    };
  }
  return {
    value: Number(stats?.completed_today ?? 0) || 0,
    label: t('home.jobsDoneToday'),
  };
}

function gridHtml({ menuOpen = false, metricMode = 'done' } = {}) {
  return `
    <div
      id="home-logo-menu"
      class="home-split__grid${menuOpen ? ' is-open' : ''}"
      data-home-logo-menu
      ${menuOpen ? '' : 'hidden'}
      role="menu"
    >
      ${GRID_ACTIONS()
        .map(
          (item) => `
        <button
          type="button"
          class="home-split__tile${metricMode === item.key ? ' is-selected' : ''}"
          role="menuitem"
          data-home-action="${esc(item.key)}"
          ${item.path ? `data-home-path="${esc(item.path)}"` : ''}
          ${item.support ? 'data-home-support="1"' : ''}
          ${metricMode === item.key ? 'aria-current="true"' : ''}
        >
          <span class="home-split__tile-icon" aria-hidden="true">${icon(item.iconName, { size: 26 })}</span>
          <span class="home-split__tile-label">${esc(item.label)}</span>
        </button>`,
        )
        .join('')}
    </div>`;
}

function paintSplitHome({
  shopName = '',
  stats = null,
  menuOpen = true,
  metricMode = 'done',
} = {}) {
  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shopName || t('home.todoEnUno'))}</span>`;
  }
  ensureHeaderBrand();
  markHomeShell(true);

  const metric = metricCopy(metricMode, stats);

  return setContent(`
    <div class="home-split" data-dashboard-home="split" data-metric-mode="${esc(metricMode)}">
      <aside class="home-split__menu" aria-label="${esc(t('home.dropdownTitle'))}">
        <div class="home-split__menu-head">
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
        </div>

        <div class="home-split__metric" aria-live="polite" data-metric-card>
          <div class="home-split__metric-value">${num(metric.value)}</div>
          <div class="home-split__metric-label">${esc(metric.label)}</div>
        </div>

        ${gridHtml({ menuOpen, metricMode })}
      </aside>

      <section class="home-split__brand">
        <div class="home-split__brand-inner">
          <h1 class="home-split__todo">${esc(t('home.todoEnUno'))}</h1>
          ${
            shopName
              ? `<p class="home-split__shop">${esc(shopName)}</p>`
              : `<p class="home-split__shop home-split__shop--muted">${esc(t('home.noShopTitle'))}</p>`
          }
        </div>
      </section>
    </div>`);
}

function bindHomeActions(shop, getState, setMetricMode) {
  const main = contentArea();
  if (!main || main.dataset.homeActionsBound === '1') return;
  main.dataset.homeActionsBound = '1';

  main.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-home-logo-toggle]');
    if (toggle) {
      const menuRoot = toggle.closest('.home-split__menu');
      const menu = menuRoot?.querySelector('[data-home-logo-menu]');
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
      setMetricMode('pending');
      const state = getState();
      paintSplitHome({
        shopName: shop?.name || state.shopName,
        stats: state.stats,
        menuOpen: true,
        metricMode: 'pending',
      });
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
    paintSplitHome({ shopName: '', stats: null, menuOpen: true, metricMode: 'done' });
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
  let metricMode = 'done';
  let latestStats = null;

  screen({
    title: shop.name,
    subtitle: '',
    nav: 'home',
    shopSwitcher: true,
    flush: true,
    content: `
      <div class="home-split" data-dashboard-home="split" data-metric-mode="done">
        <aside class="home-split__menu">
          <div class="home-split__menu-head">
            <p class="home-split__menu-kicker">${esc(t('home.dropdownTitle'))}</p>
            <button type="button" class="home-split__trigger is-open" data-home-logo-toggle aria-expanded="true" aria-controls="home-logo-menu">
              <img class="home-split__trigger-mark" src="/icons/logo-mark.svg" alt="" width="88" height="88">
              <span class="home-split__trigger-hint" aria-hidden="true"></span>
            </button>
          </div>
          <div class="home-split__metric" data-metric-card>
            <div class="home-split__metric-value">…</div>
            <div class="home-split__metric-label">${esc(t('home.jobsDoneToday'))}</div>
          </div>
        </aside>
        <section class="home-split__brand">
          <div class="home-split__brand-inner">
            <h1 class="home-split__todo">${esc(t('home.todoEnUno'))}</h1>
            <p class="home-split__shop">${esc(shop.name)}</p>
          </div>
        </section>
      </div>`,
  });

  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shop.name)}</span>`;
  }
  ensureHeaderBrand();
  markHomeShell(true);
  bindHomeActions(
    shop,
    () => ({ stats: latestStats, shopName: shop.name }),
    (mode) => {
      metricMode = mode;
    },
  );

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
    const modeAttr = contentArea()?.querySelector('[data-metric-mode]')?.dataset?.metricMode;
    if (modeAttr === 'pending' || modeAttr === 'done') metricMode = modeAttr;
    paintSplitHome({
      shopName: shop.name,
      stats: latestStats,
      menuOpen,
      metricMode,
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
    urgencia_created: () => void refreshBadges(),
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
