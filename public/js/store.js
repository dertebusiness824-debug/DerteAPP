/** Tiny observable app state: session, accessible shops, active tenant, badges. */
import { api, setToken } from './api.js';

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
    const { user } = await api.me();
    store.user = user;
    store.shops = user.shops ?? [];
    if (!store.shops.some((shop) => shop.id === store.activeShopId)) {
      store.activeShopId = store.shops[0]?.id ?? null;
      write(ACTIVE_SHOP_KEY, store.activeShopId);
    }
    emit();
    return true;
  } catch {
    store.user = null;
    store.shops = [];
    emit();
    return false;
  }
}

export function applySession({ token, user }) {
  setToken(token);
  store.user = user;
  store.shops = user.shops ?? [];
  store.activeShopId = store.shops[0]?.id ?? null;
  write(ACTIVE_SHOP_KEY, store.activeShopId);
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

/** Refreshes the badge counts shown on the bottom navigation. */
export async function refreshBadges() {
  const shopId = store.activeShop?.id;
  if (!shopId) return;
  try {
    const [unread, appointments] = await Promise.all([
      api.unread(shopId),
      api.appointments({ shop_id: shopId, status: 'pending', limit: 1 }),
    ]);
    store.unread = unread;
    store.pending = appointments.count;
    emit();
  } catch {
    // Badge counts are best-effort.
  }
}
