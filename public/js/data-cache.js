/**
 * Client data cache for shop lists (appointments + urgencias).
 *
 * Vanilla equivalent of TanStack Query: staleTime + silent background revalidation.
 * Prefetch runs from app boot so Reservas / Urgencias paint instantly from cache.
 */
import { api, stream } from './api.js';
import { applyClosingAutoComplete } from './booking-lifecycle.js';
import { store, subscribe as subscribeStore } from './store.js';

/** Soft-stale window — within this, views reuse cache without an await. */
export const STALE_MS = 30_000;

const listeners = new Set();

/** @type {Map<string, { data: any, updatedAt: number, promise: Promise<any>|null, error: Error|null }>} */
const entries = new Map();

let liveShopId = null;
let stopLive = null;
const liveListeners = new Set();

export function subscribeShopLiveEvents(listener) {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

function emitShopLive(eventName, payload) {
  for (const listener of liveListeners) {
    try {
      listener(eventName, payload);
    } catch (error) {
      console.warn('[data-cache] live listener failed', error);
    }
  }
}

function keyAppointments(shopId) {
  return `appointments:${shopId}`;
}

function keyUrgencias(shopId, scope) {
  return `urgencias:${shopId}:${scope}`;
}

function ensureEntry(key) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { data: undefined, updatedAt: 0, promise: null, error: null };
    entries.set(key, entry);
  }
  return entry;
}

function notify(key) {
  const entry = entries.get(key);
  for (const listener of listeners) {
    try {
      listener({ key, entry });
    } catch (error) {
      console.warn('[data-cache] listener failed', error);
    }
  }
}

export function subscribeDataCache(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCacheEntry(key) {
  return entries.get(key) ?? null;
}

export function isFresh(key, staleMs = STALE_MS) {
  const entry = entries.get(key);
  if (!entry || entry.data === undefined) return false;
  return Date.now() - entry.updatedAt < staleMs;
}

export function peekAppointments(shopId) {
  const entry = entries.get(keyAppointments(shopId));
  return Array.isArray(entry?.data) ? entry.data : null;
}

export function peekUrgencias(shopId, scope = 'active') {
  const entry = entries.get(keyUrgencias(shopId, scope));
  return Array.isArray(entry?.data) ? entry.data : null;
}

async function fetchAppointmentsRaw(shop) {
  if (!shop?.id && !shop?.public_key) return [];

  const params = { shop_id: shop.id, limit: 100 };
  try {
    const result = await api.appointments(params);
    let rows = Array.isArray(result?.appointments) ? result.appointments : [];
    try {
      const overview = await api.overview(shop.id).catch(() => null);
      rows = applyClosingAutoComplete(rows, {
        closeTime: overview?.today_hours?.close_time ?? null,
        isClosed: Boolean(overview?.today_hours?.is_closed),
        timeZone: shop.timezone || overview?.timezone || 'Europe/Madrid',
      });
    } catch (error) {
      console.warn('[data-cache] appointments autocomplete skipped', error);
    }
    return rows;
  } catch (error) {
    console.warn('[data-cache] appointments list failed, trying board', error);
  }

  if (shop.public_key) {
    try {
      const board = await api.appointmentsBoard({
        public_key: shop.public_key,
        limit: 100,
      });
      return Array.isArray(board?.appointments) ? board.appointments : [];
    } catch (error) {
      console.warn('[data-cache] appointments board failed', error);
    }
  }
  return [];
}

async function fetchUrgenciasRaw(shopId, scope) {
  const result = await api.urgencias({ shop_id: shopId, scope, limit: 100 });
  return Array.isArray(result?.urgencias) ? result.urgencias : [];
}

/**
 * Query with stale-while-revalidate semantics.
 * @returns {{ data: any, fromCache: boolean, promise: Promise<any>|null }}
 */
export function queryCache(key, fetcher, { staleMs = STALE_MS, force = false } = {}) {
  const entry = ensureEntry(key);
  const hasData = entry.data !== undefined;
  const fresh = hasData && Date.now() - entry.updatedAt < staleMs;

  if (hasData && fresh && !force) {
    return { data: entry.data, fromCache: true, promise: null };
  }

  if (!entry.promise) {
    entry.promise = Promise.resolve()
      .then(fetcher)
      .then((data) => {
        entry.data = data;
        entry.updatedAt = Date.now();
        entry.error = null;
        entry.promise = null;
        notify(key);
        return data;
      })
      .catch((error) => {
        entry.error = error;
        entry.promise = null;
        notify(key);
        throw error;
      });
  }

  return {
    data: hasData ? entry.data : undefined,
    fromCache: hasData,
    promise: entry.promise,
  };
}

export function invalidate(keyPrefix) {
  for (const key of [...entries.keys()]) {
    if (key === keyPrefix || key.startsWith(`${keyPrefix}`)) {
      const entry = entries.get(key);
      if (entry) entry.updatedAt = 0;
    }
  }
}

export function setAppointmentsCache(shopId, rows) {
  const key = keyAppointments(shopId);
  const entry = ensureEntry(key);
  entry.data = Array.isArray(rows) ? rows : [];
  entry.updatedAt = Date.now();
  entry.error = null;
  notify(key);
}

export function patchAppointmentInCache(shopId, appointment) {
  if (!shopId || !appointment?.id) return;
  const key = keyAppointments(shopId);
  const entry = ensureEntry(key);
  const list = Array.isArray(entry.data) ? [...entry.data] : [];
  const index = list.findIndex((row) => row.id === appointment.id);
  if (index >= 0) list[index] = { ...list[index], ...appointment };
  else list.unshift(appointment);
  entry.data = list;
  entry.updatedAt = Date.now();
  notify(key);
}

export function setUrgenciasCache(shopId, scope, rows) {
  const key = keyUrgencias(shopId, scope);
  const entry = ensureEntry(key);
  entry.data = Array.isArray(rows) ? rows : [];
  entry.updatedAt = Date.now();
  entry.error = null;
  notify(key);
}

export function patchUrgenciaInCache(shopId, urgencia) {
  if (!shopId || !urgencia?.id) return;
  for (const scope of ['active', 'history', 'all']) {
    const key = keyUrgencias(shopId, scope);
    const entry = entries.get(key);
    if (!entry || !Array.isArray(entry.data)) continue;
    const list = [...entry.data];
    const index = list.findIndex((row) => row.id === urgencia.id);
    if (index >= 0) {
      list[index] = { ...list[index], ...urgencia };
      entry.data = list;
      entry.updatedAt = Date.now();
      notify(key);
    } else if (scope === 'active' && urgencia.status === 'pending') {
      list.unshift(urgencia);
      entry.data = list;
      entry.updatedAt = Date.now();
      notify(key);
    }
  }
}

export function removeUrgenciaFromCache(shopId, urgenciaId) {
  if (!shopId || !urgenciaId) return;
  for (const scope of ['active', 'history', 'all']) {
    const key = keyUrgencias(shopId, scope);
    const entry = entries.get(key);
    if (!entry || !Array.isArray(entry.data)) continue;
    const next = entry.data.filter((row) => row.id !== urgenciaId);
    if (next.length !== entry.data.length) {
      entry.data = next;
      entry.updatedAt = Date.now();
      notify(key);
    }
  }
}

/** Load appointments for a shop into cache (SWR). */
export function ensureAppointments(shop, { force = false } = {}) {
  if (!shop?.id) return { data: null, fromCache: false, promise: null };
  const key = keyAppointments(shop.id);
  return queryCache(key, () => fetchAppointmentsRaw(shop), { force });
}

/** Load urgencias scope into cache (SWR). */
export function ensureUrgencias(shopId, scope = 'active', { force = false } = {}) {
  if (!shopId) return { data: null, fromCache: false, promise: null };
  const key = keyUrgencias(shopId, scope);
  return queryCache(key, () => fetchUrgenciasRaw(shopId, scope), { force });
}

/** Background prefetch used at app boot / shop switch. */
export async function prefetchShopLists(shop = store.activeShop) {
  if (!shop?.id || !store.isAuthenticated) return;

  const tasks = [
    ensureAppointments(shop, { force: !isFresh(keyAppointments(shop.id)) }),
    ensureUrgencias(shop.id, 'active', { force: !isFresh(keyUrgencias(shop.id, 'active')) }),
    ensureUrgencias(shop.id, 'history', { force: !isFresh(keyUrgencias(shop.id, 'history')) }),
  ];

  await Promise.allSettled(tasks.map((result) => result.promise).filter(Boolean));
}

/** Soft revalidate without blocking UI. */
export function revalidateShopLists(shop = store.activeShop) {
  if (!shop?.id || !store.isAuthenticated) return;
  void ensureAppointments(shop, { force: true });
  void ensureUrgencias(shop.id, 'active', { force: true });
  void ensureUrgencias(shop.id, 'history', { force: true });
}

function handleLiveEvent(shopId, payload) {
  if (!payload?.type) return;
  const type = payload.type;

  if (type === 'appointment_created' || type === 'appointment_updated') {
    if (payload.appointment) patchAppointmentInCache(shopId, payload.appointment);
    else {
      invalidate(keyAppointments(shopId));
      void ensureAppointments(store.activeShop, { force: true });
    }
    return;
  }

  if (
    type === 'urgencia_created' ||
    type === 'urgencia_updated' ||
    type === 'urgencia_accepted' ||
    type === 'urgencia_cancelled'
  ) {
    if (payload.urgencia) {
      if (type === 'urgencia_cancelled' || payload.urgencia.status === 'cancelled') {
        // Keep cancelled rows out of active; refresh both scopes quietly.
        removeUrgenciaFromCache(shopId, payload.urgencia.id);
        void ensureUrgencias(shopId, 'active', { force: true });
        void ensureUrgencias(shopId, 'history', { force: true });
      } else {
        patchUrgenciaInCache(shopId, payload.urgencia);
        // Accepted urgencias leave active — refresh scopes in background.
        if (type === 'urgencia_accepted') {
          void ensureUrgencias(shopId, 'active', { force: true });
          void ensureUrgencias(shopId, 'history', { force: true });
          invalidate(keyAppointments(shopId));
          void ensureAppointments(store.activeShop, { force: true });
        }
      }
    } else {
      void ensureUrgencias(shopId, 'active', { force: true });
      void ensureUrgencias(shopId, 'history', { force: true });
    }
  }
}

/** Shop SSE live updates (server hub) — same role as Supabase Realtime for appointments. */
export function startShopLiveSync(shopId = store.activeShop?.id) {
  if (!shopId || liveShopId === shopId) return stopLive || (() => {});
  stopShopLiveSync();
  liveShopId = shopId;

  stopLive = stream(`/chat/stream?shop_id=${shopId}`, {
    appointment_created: (payload) => {
      handleLiveEvent(shopId, payload ?? { type: 'appointment_created' });
      emitShopLive('appointment_created', payload);
    },
    appointment_updated: (payload) => {
      handleLiveEvent(shopId, payload ?? { type: 'appointment_updated' });
      emitShopLive('appointment_updated', payload);
    },
    urgencia_created: (payload) => {
      handleLiveEvent(shopId, payload ?? { type: 'urgencia_created' });
      emitShopLive('urgencia_created', payload);
    },
    urgencia_updated: (payload) => {
      handleLiveEvent(shopId, payload ?? { type: 'urgencia_updated' });
      emitShopLive('urgencia_updated', payload);
    },
    urgencia_accepted: (payload) => {
      handleLiveEvent(shopId, payload ?? { type: 'urgencia_accepted' });
      emitShopLive('urgencia_accepted', payload);
    },
    urgencia_cancelled: (payload) => {
      handleLiveEvent(shopId, payload ?? { type: 'urgencia_cancelled' });
      emitShopLive('urgencia_cancelled', payload);
    },
    chat_message: (payload) => emitShopLive('chat_message', payload),
    call_event: (payload) => emitShopLive('call_event', payload),
  });

  return stopLive;
}

export function stopShopLiveSync() {
  if (typeof stopLive === 'function') stopLive();
  stopLive = null;
  liveShopId = null;
}

/** Boot + keep cache warm while authenticated. */
export function startGlobalDataLayer() {
  const boot = () => {
    const shop = store.activeShop;
    if (!store.isAuthenticated || !shop?.id) {
      stopShopLiveSync();
      return;
    }
    void prefetchShopLists(shop);
    startShopLiveSync(shop.id);
  };

  boot();

  let lastShopId = store.activeShop?.id ?? null;
  const unsubStore = subscribeStore(() => {
    const shopId = store.activeShop?.id ?? null;
    if (!store.isAuthenticated) {
      stopShopLiveSync();
      lastShopId = null;
      return;
    }
    if (shopId !== lastShopId) {
      lastShopId = shopId;
      boot();
    }
  });

  const onVisible = () => {
    if (document.visibilityState === 'visible' && store.isAuthenticated) {
      revalidateShopLists();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    unsubStore();
    document.removeEventListener('visibilitychange', onVisible);
    stopShopLiveSync();
  };
}

export const cacheKeys = {
  appointments: keyAppointments,
  urgencias: keyUrgencias,
};
