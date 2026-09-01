/**
 * Shop-owner quick menu, triggered from the cyan brand mark in the bottom nav.
 * Lives on the shell (not inside a view) so toggling it never remounts a route.
 */
import { t } from './i18n.js';
import { icon } from './icons.js';
import { navigate } from './router.js';
import { refreshBadges, store } from './store.js';
import { esc } from './ui.js';

const GRID_ACTIONS = () => [
  { key: 'create', label: t('home.menu.createBooking'), iconName: 'plus' },
  { key: 'pending', label: t('home.menu.pendingToday'), iconName: 'calendar' },
  { key: 'vehicles', label: t('home.menu.vehicles'), iconName: 'car', path: '/vehiculos' },
  { key: 'diagnostics', label: t('home.menu.diagnostics'), iconName: 'stethoscope', path: '/diagnostico' },
  { key: 'inventory', label: t('home.menu.inventory'), iconName: 'box', path: '/inventario' },
  { key: 'urgencias', label: t('home.menu.urgencias'), iconName: 'phone', path: '/urgencias' },
  { key: 'settings', label: t('settings.title'), iconName: 'settings', path: '/settings' },
  ...(store.isSuperAdmin
    ? [{ key: 'admin', label: t('nav.admin'), iconName: 'chart', path: '/admin' }]
    : []),
];

let menuOpen = false;
let controller = null;
let lastToggleAt = 0;
let ignoreOpenUntil = 0;
let ignoreCloseUntil = 0;
let railArmedAt = 0;
const GESTURE_MS = 700;

function viewportBox() {
  const vv = window.visualViewport;
  if (vv) {
    return {
      width: vv.width,
      height: vv.height,
      left: vv.offsetLeft,
      top: vv.offsetTop,
    };
  }
  return { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
}

function eventHitsSelector(event, selector) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node?.closest?.(selector)) return true;
  }
  return Boolean(event.target?.closest?.(selector));
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

function clearRailPosition(menu) {
  if (!menu) return;
  menu.style.removeProperty('position');
  menu.style.removeProperty('z-index');
  menu.style.removeProperty('left');
  menu.style.removeProperty('top');
  menu.style.removeProperty('width');
  menu.style.removeProperty('max-width');
  menu.style.removeProperty('max-height');
  menu.style.removeProperty('overflow-y');
  menu.style.removeProperty('margin');
  menu.style.removeProperty('transform');
}

/**
 * Pin the menu to the visual viewport. It must never cover the cyan trigger:
 * that buried the button and the next tap landed on a tile (Reservas).
 */
function placeRail(toggle, menu) {
  if (!toggle || !menu) return;
  const rect = toggle.getBoundingClientRect();
  const vp = viewportBox();
  const gutter = 8;
  const gap = 10;
  const width = Math.min(268, Math.max(120, vp.width - gutter * 2));
  const viewTop = vp.top + gutter;
  const navTop = document.querySelector('.nav')?.getBoundingClientRect().top ?? Infinity;
  const viewBottom = Math.min(vp.top + vp.height, navTop) - gutter;

  menu.style.position = 'fixed';
  menu.style.zIndex = '40';
  menu.style.margin = '0';
  menu.style.width = `${Math.round(width)}px`;
  menu.style.maxWidth = `${Math.round(width)}px`;
  menu.style.overflowY = 'auto';

  if (vp.width >= 520) {
    let left = rect.right + gap;
    if (left + width > vp.left + vp.width - gutter) left = rect.left - width - gap;
    menu.style.left = `${Math.round(Math.max(vp.left + gutter, Math.min(left, vp.left + vp.width - width - gutter)))}px`;
    menu.style.maxHeight = `${Math.round(Math.max(0, viewBottom - viewTop))}px`;
    const height = menu.offsetHeight;
    menu.style.top = `${Math.round(Math.max(viewTop, Math.min(rect.top, viewBottom - height)))}px`;
    return;
  }

  const left = rect.left + rect.width / 2 - width / 2;
  menu.style.left = `${Math.round(Math.max(vp.left + gutter, Math.min(left, vp.left + vp.width - width - gutter)))}px`;

  const spaceBelow = viewBottom - (rect.bottom + gap);
  const spaceAbove = rect.top - gap - viewTop;
  const below = spaceBelow >= spaceAbove;
  const room = Math.max(0, Math.round(below ? spaceBelow : spaceAbove));
  menu.style.maxHeight = `${room}px`;
  const height = Math.min(menu.offsetHeight, room);
  menu.style.top = `${Math.round(below ? rect.bottom + gap : rect.top - gap - height)}px`;
}

function nodes() {
  return {
    toggle: document.querySelector('[data-nav-launcher]'),
    menu: document.querySelector('[data-home-logo-menu]'),
    scrim: document.querySelector('[data-nav-launcher-scrim]'),
  };
}

function setLauncherOpen(open) {
  const { toggle, menu, scrim } = nodes();
  if (!menu || !toggle) return false;

  const nextOpen = !!open;
  menuOpen = nextOpen;

  document.body.classList.toggle('is-nav-menu-open', nextOpen);
  document.querySelector('.app')?.classList.toggle('is-dimmed', nextOpen);
  scrim?.classList.toggle('is-open', nextOpen);
  menu.classList.toggle('is-open', nextOpen);
  toggle.classList.toggle('is-open', nextOpen);
  toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  menu.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
  menu.querySelectorAll('[data-home-action]').forEach((btn) => {
    btn.tabIndex = nextOpen ? 0 : -1;
  });

  const mark = toggle.querySelector('.home-split__trigger-mark');

  if (nextOpen) {
    paintMenuItems(menu, { open: true });
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

function paintMenuItems(menu, { open = false } = {}) {
  if (!menu) return;
  menu.innerHTML = GRID_ACTIONS()
    .map(
      (item) => `
        <button
          type="button"
          class="home-split__tile"
          role="menuitem"
          data-home-action="${esc(item.key)}"
          tabindex="${open ? '0' : '-1'}"
          ${item.path ? `data-home-path="${esc(item.path)}"` : ''}
        >
          <span class="home-split__tile-icon${item.key === 'urgencias' ? ' home-split__tile-icon--alert' : ''}" aria-hidden="true">${icon(item.iconName, { size: 22 })}</span>
          <span class="home-split__tile-label">${esc(item.label)}</span>
        </button>`,
    )
    .join('');
}

function railHtml() {
  return `
    <div
      id="home-logo-menu"
      class="home-split__rail"
      data-home-logo-menu
      role="menu"
      aria-hidden="true"
      inert
    ></div>`;
}

function launcherButtonHtml() {
  return `
    <button
      type="button"
      class="nav__launcher"
      data-nav-launcher
      data-home-logo-toggle
      hidden
      aria-expanded="false"
      aria-controls="home-logo-menu"
      aria-label="${esc(t('home.logoMenuAria'))}"
    >
      <span class="nav__launcher-disc" aria-hidden="true">
        <img class="home-split__trigger-mark nav__launcher-mark" src="/icons/logo-mark.svg" alt="" width="28" height="28">
      </span>
    </button>`;
}

function ensureOverlay(root) {
  if (!root.querySelector('[data-nav-launcher-scrim]')) {
    const scrim = document.createElement('div');
    scrim.className = 'nav-launcher-scrim';
    scrim.dataset.navLauncherScrim = '1';
    scrim.setAttribute('aria-hidden', 'true');
    root.append(scrim);
  }
  if (!root.querySelector('[data-home-logo-menu]')) {
    const wrap = document.createElement('div');
    wrap.innerHTML = railHtml().trim();
    root.append(wrap.firstElementChild);
  }
}

function ensureLauncherButton(nav) {
  if (nav.querySelector('[data-nav-launcher]')) return;
  nav.insertAdjacentHTML('beforeend', launcherButtonHtml());
}

function toggleMenu() {
  const now = Date.now();
  if (now - lastToggleAt < 400) return;
  lastToggleAt = now;
  const next = !menuOpen;
  setLauncherOpen(next);
  if (next) {
    ignoreCloseUntil = now + GESTURE_MS;
    railArmedAt = now + 400;
  }
}

async function runAction(action) {
  const kind = action.dataset.homeAction;
  const shop = store.activeShop;
  if (kind === 'create') {
    if (!shop) return;
    const { openNewBookingSheet } = await import('./views/appointments.js');
    openNewBookingSheet(shop, () => void refreshBadges());
    return;
  }
  if (kind === 'pending') {
    navigate('/appointments?filter=today');
    return;
  }
  const path = action.dataset.homePath;
  if (path) navigate(path);
}

export function isNavLauncherOpen() {
  return menuOpen;
}

export function closeNavLauncher() {
  if (!menuOpen) return;
  setLauncherOpen(false);
}

export function setNavLauncherVisible(visible) {
  const nav = document.querySelector('.nav');
  const toggle = nav?.querySelector('[data-nav-launcher]');
  if (!toggle) return;
  toggle.hidden = !visible;
  if (!visible) closeNavLauncher();
}

/** Bind once per shell mount. Call again after takeoverScreen remounts the shell. */
export function bindNavLauncher(nav) {
  if (!nav) return () => {};
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;

  const root = document.getElementById('root') || document.body;
  ensureOverlay(root);
  ensureLauncherButton(nav);

  lastToggleAt = 0;
  ignoreOpenUntil = 0;
  ignoreCloseUntil = 0;
  railArmedAt = 0;
  menuOpen = false;
  setLauncherOpen(false);

  const closeIfOutside = (event) => {
    if (!menuOpen) return;
    if (Date.now() < ignoreCloseUntil) return;
    if (eventHitsSelector(event, '[data-home-logo-toggle], [data-home-action]')) return;
    setLauncherOpen(false);
  };
  document.addEventListener('click', closeIfOutside, { signal });

  const onViewportChange = () => {
    if (!menuOpen) return;
    const { toggle, menu } = nodes();
    placeRail(toggle, menu);
  };
  window.addEventListener('resize', onViewportChange, { signal });
  window.addEventListener('orientationchange', onViewportChange, { signal });
  window.visualViewport?.addEventListener('resize', onViewportChange, { signal });
  window.visualViewport?.addEventListener('scroll', onViewportChange, { signal });

  const onOpenGesture = (event) => {
    const toggle = event.target.closest('[data-nav-launcher], [data-home-logo-toggle]');
    if (!toggle?.matches?.('[data-nav-launcher]')) return;
    if (event.type !== 'touchstart' && Date.now() < ignoreOpenUntil) return;
    if (event.type === 'touchstart' || event.pointerType === 'touch') {
      ignoreOpenUntil = Date.now() + GESTURE_MS;
    }
    toggleMenu();
  };

  nav.addEventListener('touchstart', onOpenGesture, { passive: true, signal });
  nav.addEventListener('pointerup', onOpenGesture, { signal });
  nav.addEventListener(
    'click',
    (event) => {
      const toggle = event.target.closest('[data-nav-launcher]');
      if (toggle) {
        onOpenGesture(event);
        return;
      }
    },
    { signal },
  );

  const menu = document.querySelector('[data-home-logo-menu]');
  menu?.addEventListener(
    'click',
    (event) => {
      const action = event.target.closest('[data-home-action]');
      if (!action) {
        if (menuOpen && Date.now() >= ignoreCloseUntil) setLauncherOpen(false);
        return;
      }
      if (Date.now() < railArmedAt) return;
      setLauncherOpen(false);
      void runAction(action);
    },
    { signal },
  );

  document.querySelector('[data-nav-launcher-scrim]')?.addEventListener(
    'click',
    () => {
      if (Date.now() < ignoreCloseUntil) return;
      closeNavLauncher();
    },
    { signal },
  );

  return () => {
    controller?.abort();
    if (controller) controller = null;
    closeNavLauncher();
  };
}
