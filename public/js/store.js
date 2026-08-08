/** Tiny observable app state: session, accessible shops, active tenant, badges. */
import { api, setToken } from './api.js';
import { initLocale, setLocale } from './i18n.js';

const ACTIVE_SHOP_KEY = 'derte_active_shop';

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

export const store = {
  user: null,
  shops: [],
  activeShopId: read(ACTIVE_SHOP_KEY),
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
    return this.shops.find((shop) => shop.id === this.activeShopId) ?? this.shops[0] ?? null;
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
  store.activeShopId = shopId;
  write(ACTIVE_SHOP_KEY, shopId);
  emit();
}

/** Loads the session. Returns false when nobody is signed in. */
export async function loadSession() {
  try {
    const { user, support } = await api.me();
    store.user = user;
    store.shops = user.shops ?? [];
    store.support = support ?? store.support;
    if (!store.shops.some((shop) => shop.id === store.activeShopId)) {
      store.activeShopId = store.shops[0]?.id ?? null;
      write(ACTIVE_SHOP_KEY, store.activeShopId);
    }
    // Prefer the profile locale when signed in; otherwise keep localStorage/browser.
    initLocale(user.locale);
    emit();
    return true;
  } catch {
    store.user = null;
    store.shops = [];
    initLocale();
    emit();
    return false;
  }
}

export function applySession({ token, user, support }) {
  setToken(token);
  store.user = user;
  store.shops = user.shops ?? [];
  if (support) store.support = support;
  store.activeShopId = store.shops[0]?.id ?? null;
  write(ACTIVE_SHOP_KEY, store.activeShopId);
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
  write(ACTIVE_SHOP_KEY, null);
  emit();
}

/** Opens the global DerteApp support line (WhatsApp preferred, else tel:). */
export async function openPlatformSupport() {
  let support = store.support;
  if (!support?.whatsapp_link && !support?.tel_link) {
    try {
      const payload = await api.publicSupport();
      support = payload.support;
      store.support = support;
      emit();
    } catch {
      support = {
        phone: '+34605686509',
        whatsapp_link: 'https://wa.me/34605686509',
        tel_link: 'tel:+34605686509',
      };
    }
  }
  const link = support?.whatsapp_link || support?.tel_link || 'https://wa.me/34605686509';
  window.open(link, '_blank', 'noopener,noreferrer');
  return support;
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
