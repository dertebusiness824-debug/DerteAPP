/**
 * Shop owner home — shop name → trust tagline → dual KPI cards.
 * The cyan quick-menu trigger lives in the bottom nav (see nav-launcher.js).
 */
import { api } from '../api.js';
import { subscribeShopLiveEvents } from '../data-cache.js';
import { t } from '../i18n.js';
import { maybeRefreshPushSubscription } from '../push.js';
import { refreshBadges, store, loadSession, adoptDefaultShop } from '../store.js';
import { requireShop, screen, setContent, contentArea } from '../shell.js';
import { esc, num } from '../ui.js';

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

/**
 * Restart the glow on a KPI whose value just changed. A full repaint used to do
 * this for free, but repainting is what closed the launcher mid-gesture.
 */
function replayMetricGlow(el) {
  if (!el) return;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.removeProperty('animation');
}

/** Update KPIs / shop name without replacing #main. */
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

function paintSplitHome({ shopName = '', stats = null } = {}) {
  ensureHeaderBrand();
  markHomeShell(true);

  return setContent(`
    <div class="home-split" data-dashboard-home="split">
      <div class="home-split__stack">
        ${headingHtml(shopName)}
        ${metricsHtml(stats)}
      </div>
    </div>`);
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
    paintSplitHome({ shopName: '', stats: null });
    return () => {
      markHomeShell(false);
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
          ${metricsHtml(null, { loading: true })}
        </div>
      </div>`,
  });

  ensureHeaderBrand();
  markHomeShell(true);

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
    // Never replace #main after the first paint: setContent destroys listeners
    // and replays width/scale CSS (looks like zoom).
    if (!patchSplitHome({ shopName: shop.name, stats: latestStats })) {
      paintSplitHome({
        shopName: shop.name,
        stats: latestStats,
      });
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
    markHomeShell(false);
  };
}
