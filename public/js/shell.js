/** App shell: header, scrolling content area and the bottom navigation. */
import { currentPath, navigate } from './router.js';
import { setActiveShop, store, subscribe } from './store.js';
import { esc, icon, sheet } from './ui.js';

let root;
let header;
let main;
let nav;
let activeNavKey = '';

const OWNER_NAV = [
  { key: 'home', label: 'Home', path: '/', iconName: 'home' },
  { key: 'appointments', label: 'Bookings', path: '/appointments', iconName: 'calendar', badge: () => store.pending },
  { key: 'chat', label: 'Chat', path: '/chat', iconName: 'chat', badge: () => store.unread.total },
  { key: 'schedule', label: 'Hours', path: '/schedule', iconName: 'clock' },
  { key: 'more', label: 'More', path: '/settings', iconName: 'settings' },
];

const ADMIN_NAV = [
  { key: 'admin', label: 'Overview', path: '/admin', iconName: 'chart' },
  { key: 'shops', label: 'Shops', path: '/admin/shops', iconName: 'building' },
  { key: 'inbox', label: 'Inbox', path: '/admin/inbox', iconName: 'inbox', badge: () => store.unread.support },
  { key: 'calls', label: 'Calls', path: '/admin/calls', iconName: 'phone' },
  { key: 'more', label: 'More', path: '/settings', iconName: 'settings' },
];

const navItems = () => (store.isSuperAdmin ? ADMIN_NAV : OWNER_NAV);

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
  nav.setAttribute('aria-label', 'Main');

  const app = document.createElement('div');
  app.className = 'app';
  app.append(header, main);
  root.append(app, nav);

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-path]');
    if (button) navigate(button.dataset.path);
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
  nav.innerHTML = navItems()
    .map((item) => {
      const count = item.badge?.() ?? 0;
      return `
        <button class="nav__item" data-path="${item.path}" ${item.key === activeKey ? 'aria-current="page"' : ''}>
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
export function screen({ title, subtitle, back, actions = '', content, nav: navKey, flush = false, shopSwitcher = false }) {
  if (!main) mountShell();

  header.innerHTML = `
    ${back ? `<button class="btn btn--icon" data-shell="back" aria-label="Back">${icon('back', { size: 18 })}</button>` : ''}
    <div class="header__title">
      ${esc(title)}
      ${subtitle ? `<span class="header__sub">${esc(subtitle)}</span>` : ''}
    </div>
    ${shopSwitcher ? shopSwitcherButton() : ''}
    ${actions}`;

  header.querySelector('[data-shell="back"]')?.addEventListener('click', () => {
    if (typeof back === 'string') navigate(back);
    else history.back();
  });
  header.querySelector('[data-shell="switch-shop"]')?.addEventListener('click', openShopSwitcher);

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
    <button class="btn btn--small btn--soft" data-shell="switch-shop" style="max-width:46%">
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
          ${shop.id === store.activeShop?.id ? `<span class="badge badge--info">${icon('check', { size: 13 })}Active</span>` : ''}
        </button>`,
    )
    .join('');

  sheet({
    title: store.isSuperAdmin ? 'Switch shop' : 'Your shops',
    body: `<div class="list">${items || '<div class="list__item list__item--static">No shops yet</div>'}</div>`,
    onMount(content, close) {
      content.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-shop]');
        if (!button) return;
        setActiveShop(button.dataset.shop);
        close();
        // Re-resolve so the current screen reloads with the new tenant.
        navigate(currentPath(), { replace: true });
      });
    },
  });
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
        <div class="empty__title">No shop selected</div>
        <div>${store.isSuperAdmin ? 'Pick a shop to work on from the Shops tab.' : 'Your account is not linked to a shop yet. Message DerteApp support from the Chat tab.'}</div>
      </div>`,
  });
  return null;
}
