/** App shell: header, scrolling content area and the bottom navigation. */
import { currentPath, navigate } from './router.js';
import { languageChipHtml, LOCALES, getLocale, setLocale, t } from './i18n.js';
import { setActiveShop, store, subscribe, emit, openPlatformSupport } from './store.js';
import { esc, icon, sheet, toast } from './ui.js';
import { api } from './api.js';

let root;
let header;
let main;
let nav;
let activeNavKey = '';

const OWNER_NAV = () => [
  { key: 'home', label: t('nav.home'), path: '/', iconName: 'home' },
  { key: 'appointments', label: t('nav.appointments'), path: '/appointments', iconName: 'calendar', badge: () => store.pending },
  { key: 'web', label: t('nav.web'), path: '/web', iconName: 'globe' },
  { key: 'chat', label: t('nav.chat'), path: '/chat/support', iconName: 'chat', supportWhatsApp: true },
  { key: 'schedule', label: t('nav.schedule'), path: '/schedule', iconName: 'clock' },
  { key: 'more', label: t('nav.more'), path: '/settings', iconName: 'settings' },
];

const ADMIN_NAV = () => [
  { key: 'admin', label: t('nav.admin'), path: '/admin', iconName: 'chart' },
  { key: 'shops', label: t('nav.shops'), path: '/admin/shops', iconName: 'building' },
  { key: 'users', label: t('nav.users'), path: '/admin/users', iconName: 'team' },
  { key: 'inbox', label: t('nav.inbox'), path: '/admin/inbox', iconName: 'inbox', badge: () => store.unread.support },
  { key: 'more', label: t('nav.more'), path: '/settings', iconName: 'settings' },
];

const navItems = () => (store.isSuperAdmin ? ADMIN_NAV() : OWNER_NAV());

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
        <button class="nav__item" data-path="${item.path}" ${item.supportWhatsApp ? 'data-support-wa="1"' : ''} ${item.key === activeKey ? 'aria-current="page"' : ''}>
          ${icon(item.iconName, { size: 22 })}
          <span>${esc(item.label)}</span>
          ${count > 0 ? `<span class="nav__dot">${count > 99 ? '99+' : count}</span>` : ''}
        </button>`;
    })
    .join('');
}

/**
 * Renders a standard screen.
 * `content` may be an HTML string or a node; returns the content container so
 * views can attach listeners to what they just rendered.
 */
export function screen({ title, subtitle, back, actions = '', content, nav: navKey, flush = false, shopSwitcher = false, language = true }) {
  if (!main) mountShell();

  header.innerHTML = `
    <a class="header__brand" href="/" aria-label="derteapp">
      <img class="header__logo" src="/icons/logo-mark.svg" alt="" width="28" height="28">
    </a>
    ${back ? `<button class="btn btn--icon" data-shell="back" aria-label="${esc(t('common.back'))}">${icon('back', { size: 18 })}</button>` : ''}
    <div class="header__title">
      ${esc(title)}
      ${subtitle ? `<span class="header__sub">${esc(subtitle)}</span>` : ''}
    </div>
    ${shopSwitcher ? shopSwitcherButton() : ''}
    ${language ? languageChipHtml() : ''}
    ${actions}`;

  header.querySelector('[data-shell="back"]')?.addEventListener('click', () => {
    if (typeof back === 'string') navigate(back);
    else history.back();
  });
  header.querySelector('[data-shell="switch-shop"]')?.addEventListener('click', openShopSwitcher);
  header.querySelector('.header__brand')?.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(store.isSuperAdmin ? '/admin' : '/');
  });
  header.querySelector('[data-lang-menu]')?.addEventListener('click', openLanguageSheet);

  main.className = `main${flush ? ' main--flush' : ''}`;
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
