/** Tiny observable app state: session, accessible shops, active tenant, badges. */
import { api, setToken } from './api.js';
import { initLocale, setLocale } from './i18n.js';

/** Shop-owner tenant. Never shared with the Super Admin workspace. */
const OWNER_SHOP_KEY = 'derte_active_shop';
/** Super Admin's explicitly opened shop — isolated from owner sessions. */
const ADMIN_SHOP_KEY = 'derte_admin_active_shop';

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Ignore storage failures; state simply does not persist.
  }
};

const listeners = new Set();

function shopKeyFor(user = store.user) {
  return user?.role === 'super_admin' ? ADMIN_SHOP_KEY : OWNER_SHOP_KEY;
}

/** Restore a tenant id for this identity. Super Admin never inherits an owner shop. */
function restoreShopId(user, shops = []) {
  const saved = read(shopKeyFor(user));
  const match = shops.some((shop) => shop.id === saved) ? saved : null;
  if (user?.role === 'super_admin') return match;
  return match ?? shops[0]?.id ?? null;
}

export const store = {
  user: null,
  shops: [],
  activeShopId: null,
  unread: { total: 0, customer: 0, support: 0 },
  pending: 0,
  telephony: { configured: false },
  /** Platform support line (WhatsApp / tel) from /auth/me or /public/support. */
  support: null,

  get isAuthenticated() {
    return Boolean(this.user);
  },
  get isSuperAdmin() {
    return this.user?.role === 'super_admin';
  },
  get activeShop() {
    const match = this.shops.find((shop) => shop.id === this.activeShopId) ?? null;
    if (match) return match;
    // Super Admin stays unscoped until they explicitly open a shop.
    if (this.user?.role === 'super_admin') return null;
    return this.shops[0] ?? null;
  },
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit() {
  for (const listener of listeners) listener(store);
}

export function setActiveShop(shopId) {
  store.activeShopId = shopId || null;
  write(shopKeyFor(), store.activeShopId);
  emit();
}

/**
 * Owners may fall back to their first shop. Super Admin must pick one
 * explicitly so a leftover taller cannot take over the admin chrome.
 */
export function adoptDefaultShop() {
  if (store.isSuperAdmin) return store.activeShop;
  if (store.activeShop) return store.activeShop;
  const first = store.shops?.[0];
  if (first?.id) setActiveShop(first.id);
  return store.activeShop;
}

function applyUser(user, { support } = {}) {
  store.user = user;
  store.shops = user?.shops ?? [];
  if (support) store.support = support;
  store.activeShopId = restoreShopId(user, store.shops);
  write(shopKeyFor(user), store.activeShopId);
}

/** Loads the session. Returns false when nobody is signed in. */
export async function loadSession() {
  try {
    const { user, support } = await api.me();
    applyUser(user, { support: support ?? store.support });
    initLocale(user.locale);
    emit();
    return true;
  } catch {
    store.user = null;
    store.shops = [];
    store.activeShopId = null;
    initLocale();
    emit();
    return false;
  }
}

export function applySession({ token, user, support }) {
  setToken(token);
  applyUser(user, { support });
  if (user?.locale) setLocale(user.locale, { silent: true });
  emit();
}

export async function signOut() {
  try {
    await api.logout();
  } catch {
    // Even if the call fails, drop the local session.
  }
  setToken(null);
  store.user = null;
  store.shops = [];
  store.activeShopId = null;
  emit();
}

/** Refreshes the badge counts shown on the bottom navigation. */
export async function refreshBadges() {
  const shopId = store.activeShop?.id;
  if (!shopId) return;
  try {
    const unread = await api.unread(shopId);
    store.unread = unread;
    // Bookings are auto-confirmed — no pending-accept badge.
    store.pending = 0;
    emit();
  } catch {
    // Badge counts are best-effort.
  }
}
