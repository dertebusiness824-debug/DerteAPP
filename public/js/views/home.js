/**
 * Shop owner home — shop name in the header, metrics, then a 2×2 quick-access grid.
 */
import { api, stream } from '../api.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { maybeRefreshPushSubscription } from '../push.js';
import { refreshBadges, store, loadSession, setActiveShop, openPlatformSupport } from '../store.js';
import { requireShop, screen, setContent, contentArea } from '../shell.js';
import { openNewBookingSheet } from './appointments.js';
import { esc, num } from '../ui.js';

/** Exact quick-access tiles for the home launcher. */
const GRID_ACTIONS = () => [
  { key: 'create', label: t('home.menu.createBooking'), iconName: 'plus' },
  { key: 'pending', label: t('home.menu.pendingToday'), iconName: 'calendar' },
  { key: 'support', label: t('home.menu.support'), iconName: 'chat', support: true },
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

function gridHtml() {
  return `
    <div class="home-split__grid" data-home-logo-menu>
      <div class="home-split__grid-tiles">
        ${GRID_ACTIONS()
          .map(
            (item) => `
          <button
            type="button"
            class="home-split__tile"
            data-home-action="${esc(item.key)}"
            ${item.path ? `data-home-path="${esc(item.path)}"` : ''}
            ${item.support ? 'data-home-support="1"' : ''}
          >
            <span class="home-split__tile-icon" aria-hidden="true">${icon(item.iconName, { size: 22 })}</span>
            <span class="home-split__tile-label">${esc(item.label)}</span>
          </button>`,
          )
          .join('')}
      </div>
    </div>`;
}

function paintSplitHome({ shopName = '', stats = null } = {}) {
  ensureHeaderBrand();
  markHomeShell(true);

  const shopLabel = shopName
    ? ''
    : `<p class="home-split__shop home-split__shop--muted">${esc(t('home.noShopTitle'))}</p>`;

  return setContent(`
    <div class="home-split" data-dashboard-home="split">
      <div class="home-split__stack">
        ${shopLabel}
        ${metricsHtml(stats)}
        ${gridHtml()}
      </div>
    </div>`);
}

function bindHomeActions(shop) {
  const main = contentArea();
  if (!main || main.dataset.homeActionsBound === '1') return;
  main.dataset.homeActionsBound = '1';

  main.addEventListener('click', (event) => {
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
      title: t('nav.home'),
      nav: 'home',
      shopSwitcher: false,
      content: '',
    });
    paintSplitHome({ shopName: '', stats: null });
    return () => {
      markHomeShell(false);
      const main = contentArea();
      if (main) delete main.dataset.homeActionsBound;
    };
  }

  shop = requireShop({ title: shop?.name || t('nav.home'), navKey: 'home' });
  if (!shop) return undefined;

  let loading = false;
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
          ${metricsHtml(null, { loading: true })}
        </div>
      </div>`,
  });

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
