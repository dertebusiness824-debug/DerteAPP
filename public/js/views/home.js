/**
 * Shop owner home — shop name → trust tagline → logo launcher → dual KPI cards.
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
    playTriggerSpin(mark);
    return true;
  }

  menu.setAttribute('inert', '');
  menu.style.pointerEvents = 'none';
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
            ${item.support ? 'data-home-support="1"' : ''}
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

  const closeIfOutside = (event) => {
    if (event.target.closest('[data-home-launcher]')) return;
    const root = main.querySelector('.home-split');
    if (!root || !readMenuOpen()) return;
    setLauncherOpen(root, false);
  };
  document.addEventListener('click', closeIfOutside);
  main._homeOutsideClose = closeIfOutside;

  main.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-home-logo-toggle]');
    if (toggle) {
      const root = toggle.closest('.home-split');
      if (!root) return;
      setLauncherOpen(root, !readMenuOpen());
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
    writeMenuOpen(false);
    paintSplitHome({ shopName: '', stats: null, menuOpen: false });
    return () => {
      markHomeShell(false);
      const main = contentArea();
      if (main?._homeOutsideClose) {
        document.removeEventListener('click', main._homeOutsideClose);
        delete main._homeOutsideClose;
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
  writeMenuOpen(false);

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
    if (main) {
      main._homeMenuOpen = false;
      delete main.dataset.homeActionsBound;
    }
  };
}
