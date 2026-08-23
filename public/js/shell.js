/** App shell: header, scrolling content area and the bottom navigation. */
import { currentPath, navigate } from './router.js';
import { languageChipHtml, LOCALES, getLocale, setLocale, t } from './i18n.js';
import { setActiveShop, store, subscribe, emit, openPlatformSupport } from './store.js';
import { closeButtonHtml, esc, icon, sheet, toast } from './ui.js';
import { api } from './api.js';

let root;
let header;
let main;
let nav;
let activeNavKey = '';

/** Bottom nav for shop owners (and Super Admin when working inside a shop). */
const OWNER_NAV = () => [
  { key: 'home', label: t('nav.home'), path: store.isSuperAdmin ? '/dashboard' : '/', iconName: 'home' },
  { key: 'appointments', label: t('nav.appointments'), path: '/appointments', iconName: 'calendar' },
  { key: 'urgencias', label: t('nav.urgencias'), path: '/urgencias', iconName: 'phone' },
  { key: 'chat', label: t('nav.chat'), path: '/chat/support', iconName: 'chat', supportWhatsApp: true },
  { key: 'schedule', label: t('nav.schedule'), path: '/schedule', iconName: 'clock' },
  { key: 'more', label: t('nav.more'), path: '/settings', iconName: 'settings' },
];

/** Superadmin bottom navigation — includes Comisiones. */
export const SUPERADMIN_NAV = () => [
  { key: 'admin', label: t('nav.admin'), path: '/admin', iconName: 'chart' },
  { key: 'shops', label: t('nav.shops'), path: '/admin/shops', iconName: 'building' },
  { key: 'sales', label: t('nav.commissions'), path: '/admin/commissions', iconName: 'megaphone' },
  { key: 'users', label: t('nav.users'), path: '/admin/users', iconName: 'team' },
  { key: 'inbox', label: t('nav.inbox'), path: '/admin/inbox', iconName: 'inbox', badge: () => store.unread.support },
  { key: 'more', label: t('nav.more'), path: '/settings', iconName: 'settings' },
];

/** @deprecated Use SUPERADMIN_NAV */
const ADMIN_NAV = SUPERADMIN_NAV;

/** Shop-owner chrome (incl. Urgencias) while inside taller surfaces. */
function isShopOwnerSurface() {
  if (!store.isSuperAdmin) return true;
  if (!store.activeShop) return false;
  const path = location.pathname;
  if (path === '/dashboard' || path === '/') return true;
  return (
    path.startsWith('/appointments') ||
    path.startsWith('/reservas') ||
    path.startsWith('/urgencias') ||
    path.startsWith('/schedule') ||
    path.startsWith('/web') ||
    path.startsWith('/insights') ||
    path.startsWith('/settings') ||
    path.startsWith('/chat')
  );
}

const navItems = () => (isShopOwnerSurface() ? OWNER_NAV() : ADMIN_NAV());

/** Last pathname used for header brand transition (logo spin + wordmark). */
let lastBrandPath = null;

/**
 * Clean section title for the header — never shop or user names.
 * Mirrors the active route (vanilla equivalent of usePathname).
 */
export function sectionTitleFromPath(pathname = location.pathname) {
  const path = String(pathname || '/').split('?')[0] || '/';

  if (path === '/' || path === '/dashboard') return t('nav.home');
  if (path.startsWith('/appointments') || path.startsWith('/reservas')) {
    return t('nav.appointments');
  }
  if (path.startsWith('/urgencias')) return t('nav.urgencias');
  if (path.startsWith('/settings')) return t('settings.title');
  if (path.startsWith('/schedule')) return t('nav.schedule');
  if (path.startsWith('/chat')) return t('nav.chat');
  if (path.startsWith('/web')) return t('nav.web');
  if (path.startsWith('/insights')) return t('nav.insights');
  if (path.startsWith('/admin/commissions') || path.startsWith('/admin/sales')) {
    return t('nav.commissions');
  }
  if (path.startsWith('/admin/shops')) return t('nav.shops');
  if (path.startsWith('/admin/users')) return t('nav.users');
  if (path.startsWith('/admin/inbox')) return t('nav.inbox');
  if (path.startsWith('/admin/calls')) return t('nav.calls');
  if (path.startsWith('/admin')) return t('nav.admin');
  return t('nav.home');
}

/** Spin the mark and collapse → expand the "derteapp" wordmark on route change. */
function playBrandRouteTransition(headerEl) {
  const logo = headerEl?.querySelector('.header__logo');
  const wordmark = headerEl?.querySelector('.header__wordmark');
  if (!logo || !wordmark) return;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    logo.classList.remove('is-spinning');
    wordmark.classList.remove('is-collapsed', 'is-expanding');
    return;
  }

  // Ensure we start expanded, then collapse (visible shrink), then expand again.
  wordmark.classList.remove('is-collapsed', 'is-expanding');
  void wordmark.offsetWidth;

  wordmark.classList.add('is-collapsed');
  logo.classList.add('is-spinning');

  const clearSpin = () => logo.classList.remove('is-spinning');
  logo.addEventListener('animationend', clearSpin, { once: true });
  setTimeout(clearSpin, 700);

  setTimeout(() => {
    wordmark.classList.remove('is-collapsed');
    wordmark.classList.add('is-expanding');
    const clearExpand = () => wordmark.classList.remove('is-expanding');
    wordmark.addEventListener('transitionend', clearExpand, { once: true });
    setTimeout(clearExpand, 500);
  }, 520);
}

export function mountShell() {
  root = document.getElementById('root');
  root.replaceChildren();
  root.className = '';

  header = document.createElement('header');
  header.className = 'header';
  main = document.createElement('main');
  main.className = 'main';
  nav = document.createElement('nav');
  nav.className = 'nav';
  nav.setAttribute('aria-label', t('nav.aria'));

  const app = document.createElement('div');
  app.className = 'app';
  app.append(header, main);
  root.append(app, nav);

  lastBrandPath = null;

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-path]');
    if (!button) return;
    if (button.dataset.supportWa === '1') {
      event.preventDefault();
      openPlatformSupport();
      return;
    }
    navigate(button.dataset.path);
  });

  subscribe(() => renderNav(activeNavKey));
}

/** Full-bleed screens (auth, chat) take over the shell entirely. */
export function takeoverScreen(content, { className = '' } = {}) {
  root = document.getElementById('root');
  root.className = className;
  root.replaceChildren();
  header = null;
  nav = null;
  main = null;
  lastBrandPath = null;
  if (typeof content === 'string') root.innerHTML = content;
  else root.append(content);
  return root;
}

export function renderNav(activeKey = activeNavKey) {
  activeNavKey = activeKey;
  if (!nav) return;
  nav.setAttribute('aria-label', t('nav.aria'));
  nav.innerHTML = navItems()
    .map((item) => {
      const count = item.badge?.() ?? 0;
      return `
        <button class="nav__item" data-nav="${esc(item.key)}" data-path="${item.path}" ${item.supportWhatsApp ? 'data-support-wa="1"' : ''} ${item.key === activeKey ? 'aria-current="page"' : ''}>
          ${icon(item.iconName, { size: 22 })}
          <span>${esc(item.label)}</span>
          ${count > 0 ? `<span class="nav__dot">${count > 99 ? '99+' : count}</span>` : ''}
        </button>`;
    })
    .join('');
  nav.dataset.ownerNav = isShopOwnerSurface() ? '1' : '0';
}

/**
 * Renders a standard screen.
 * Header title is always the clean section name for the active route
 * (Inicio, Reservas, Urgencias, Ajustes, …) — never shop/user names.
 * `title` / `subtitle` args are kept for API compatibility but ignored in the header.
 */
export function screen({
  title: _title,
  subtitle: _subtitle,
  back,
  actions = '',
  content,
  nav: navKey,
  flush = false,
  shopSwitcher = false,
  language = true,
} = {}) {
  if (!main) mountShell();

  const goBack = () => {
    if (typeof back === 'string') navigate(back);
    else history.back();
  };

  const path = location.pathname;
  const sectionTitle = sectionTitleFromPath(path);
  const pathChanged = lastBrandPath !== null && lastBrandPath !== path;
  lastBrandPath = path;

  header.innerHTML = `
    <a class="header__brand" href="/" aria-label="derteapp">
      <img class="header__logo" src="/icons/logo-mark.svg" alt="" width="28" height="28">
      <span class="header__wordmark">derteapp</span>
    </a>
    <div class="header__title">${esc(sectionTitle)}</div>
    ${shopSwitcher ? shopSwitcherButton() : ''}
    ${language ? languageChipHtml() : ''}
    ${actions}
    ${back ? closeButtonHtml({ className: 'header__close', 'data-shell': 'close' }) : ''}`;

  header.querySelector('[data-shell="close"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    goBack();
  });
  header.querySelector('[data-shell="switch-shop"]')?.addEventListener('click', openShopSwitcher);
  header.querySelector('.header__brand')?.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(store.isSuperAdmin ? '/admin' : '/');
  });
  header.querySelector('[data-lang-menu]')?.addEventListener('click', openLanguageSheet);

  if (pathChanged) {
    // Double rAF so the expanded wordmark paints before we collapse it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => playBrandRouteTransition(header));
    });
  }

  main.className = `main${flush ? ' main--flush' : ''}`;
  const isReservas = navKey === 'appointments';
  document.querySelector('.app')?.classList.toggle('app--reservas', isReservas);
  document.querySelector('.nav')?.classList.toggle('nav--reservas', isReservas);
  document.body.classList.toggle('theme-reservas', isReservas);
  if (typeof content === 'string') main.innerHTML = content;
  else main.replaceChildren(content);
  main.scrollTop = 0;
  window.scrollTo(0, 0);

  renderNav(navKey ?? activeNavKey);
  return main;
}

export const contentArea = () => main;

/** Replaces just the content area, keeping the header (used when refreshing). */
export function setContent(content) {
  if (!main) return null;
  if (typeof content === 'string') main.innerHTML = content;
  else main.replaceChildren(content);
  return main;
}

// --- shop switcher ----------------------------------------------------------

function shopSwitcherButton() {
  const shop = store.activeShop;
  if (!shop || (store.shops.length < 2 && !store.isSuperAdmin)) return '';
  return `
    <button class="btn btn--small btn--soft" data-shell="switch-shop" style="max-width:42%">
      ${icon('building', { size: 16 })}
      <span class="truncate">${esc(shop.name)}</span>
    </button>`;
}

/** The Super Admin's shop switcher, also used by owners with several sites. */
export function openShopSwitcher() {
  const items = store.shops
    .map(
      (shop) => `
        <button class="list__item" data-shop="${esc(shop.id)}">
          <div class="grow">
            <div class="list__title truncate">${esc(shop.name)}</div>
            <div class="list__meta">${esc(shop.timezone)}${shop.status !== 'active' ? ` · ${esc(shop.status)}` : ''}</div>
          </div>
          ${shop.id === store.activeShop?.id ? `<span class="badge badge--info">${icon('check', { size: 13 })}${esc(t('common.active'))}</span>` : ''}
        </button>`,
    )
    .join('');

  sheet({
    title: store.isSuperAdmin ? t('shop.switcherAdmin') : t('shop.switcherOwner'),
    body: `<div class="list">${items || `<div class="list__item list__item--static">${esc(t('shop.none'))}</div>`}</div>`,
    onMount(content, close) {
      content.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-shop]');
        if (!button) return;
        setActiveShop(button.dataset.shop);
        close();
        navigate(currentPath(), { replace: true });
      });
    },
  });
}

export function openLanguageSheet() {
  const current = getLocale();
  const items = LOCALES.map(
    (item) => `
      <button class="list__item" data-locale="${esc(item.code)}">
        <span style="font-size:20px" aria-hidden="true">${item.flag}</span>
        <div class="grow">
          <div class="list__title">${esc(item.native)}</div>
          <div class="list__meta">${esc(item.name)}</div>
        </div>
        ${item.code === current ? `<span class="badge badge--info">${icon('check', { size: 13 })}${esc(t('common.active'))}</span>` : ''}
      </button>`,
  ).join('');

  sheet({
    title: t('lang.title'),
    body: `<div class="list">${items}</div>`,
    onMount(content, close) {
      content.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-locale]');
        if (!button) return;
        const code = button.dataset.locale;
        close();
        await applyLanguage(code);
      });
    },
  });
}

/** Persist locale locally (+ user profile when signed in) and remount the screen. */
export async function applyLanguage(code) {
  setLocale(code);
  if (store.isAuthenticated) {
    try {
      const { user } = await api.updateProfile({ locale: code });
      store.user = { ...store.user, locale: user.locale ?? code };
      emit();
    } catch {
      // Local preference still applies.
    }
  }
  toast(t('lang.saved'), 'ok');
  navigate(currentPath(), { replace: true });
}

/**
 * Guard for owner screens: renders a friendly prompt when the account is not
 * attached to a shop yet, or when a Super Admin has not picked one.
 */
export function requireShop({ title, navKey }) {
  const shop = store.activeShop;
  if (shop) return shop;

  // Prefer the first shop on the session when activeShopId is stale — no link API call.
  if (store.shops?.[0]?.id) {
    setActiveShop(store.shops[0].id);
    if (store.activeShop) return store.activeShop;
  }

  // Soft empty — never block the owner UI behind "Iniciar Sesión de Nuevo".
  screen({
    title,
    nav: navKey,
    content: `
      <div class="empty">
        ${icon('building', { size: 30 })}
        <div class="empty__title">${esc(t('home.noShopTitle'))}</div>
        <div>${esc(store.isSuperAdmin ? t('home.noShopAdmin') : t('home.noShopOwner'))}</div>
      </div>`,
  });
  return null;
}
