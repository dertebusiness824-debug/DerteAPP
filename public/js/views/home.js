/**
 * Shop owner home — split panel.
 * Left: Menú desplegable (logo trigger, jobs-today, 2×2 nav grid).
 * Right: TODO EN UNO brand + shop name.
 * Shell header keeps derteapp logo + language; bottom nav stays.
 */
import { api, stream } from '../api.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { refreshBadges, store, loadSession, setActiveShop, openPlatformSupport } from '../store.js';
import { requireShop, screen, setContent, contentArea } from '../shell.js';
import { esc, num } from '../ui.js';

const GRID_ACTIONS = () => [
  { key: 'home', label: t('nav.home'), iconName: 'home', path: '/' },
  { key: 'appointments', label: t('nav.appointments'), iconName: 'calendar', path: '/appointments' },
  { key: 'urgencias', label: t('nav.urgencias'), iconName: 'phone', path: '/urgencias' },
  { key: 'chat', label: t('nav.chat'), iconName: 'chat', support: true },
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

function gridHtml({ menuOpen = false } = {}) {
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
    </div>`;
}

function paintSplitHome({ shopName = '', jobsToday = 0, menuOpen = true } = {}) {
  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shopName || t('home.todoEnUno'))}</span>`;
  }
  ensureHeaderBrand();
  markHomeShell(true);

  return setContent(`
    <div class="home-split" data-dashboard-home="split">
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

        <div class="home-split__metric" aria-live="polite">
          <div class="home-split__metric-value">${num(jobsToday)}</div>
          <div class="home-split__metric-label">${esc(t('home.jobsDoneToday'))}</div>
        </div>

        ${gridHtml({ menuOpen })}
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

function bindHomeActions() {
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
    if (action.dataset.homeSupport === '1') {
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
    paintSplitHome({ shopName: '', jobsToday: 0, menuOpen: true });
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

  screen({
    title: shop.name,
    subtitle: '',
    nav: 'home',
    shopSwitcher: true,
    flush: true,
    content: `
      <div class="home-split" data-dashboard-home="split">
        <aside class="home-split__menu">
          <div class="home-split__menu-head">
            <p class="home-split__menu-kicker">${esc(t('home.dropdownTitle'))}</p>
            <button type="button" class="home-split__trigger is-open" data-home-logo-toggle aria-expanded="true" aria-controls="home-logo-menu">
              <img class="home-split__trigger-mark" src="/icons/logo-mark.svg" alt="" width="88" height="88">
              <span class="home-split__trigger-hint" aria-hidden="true"></span>
            </button>
          </div>
          <div class="home-split__metric">
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
  bindHomeActions();

  async function load() {
    if (loading) return;
    loading = true;
    let jobsToday = 0;
    try {
      const overview = await api.overview(shop.id);
      jobsToday = Number(overview?.stats?.completed_today ?? 0) || 0;
    } catch {
      jobsToday = 0;
    } finally {
      loading = false;
    }
    const menu = contentArea()?.querySelector('[data-home-logo-menu]');
    menuOpen = menu ? menu.classList.contains('is-open') : true;
    paintSplitHome({ shopName: shop.name, jobsToday, menuOpen });
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
