/**
 * Web Push subscription helpers for the DerteApp PWA (incl. iOS home-screen).
 */
import { api } from './api.js';
import { store } from './store.js';
import { toast } from './ui.js';
import { t } from './i18n.js';

const SW_URL = '/sw.js?v=37-ios-web-push';

/** Convert a URL-safe base64 VAPID public key to Uint8Array for PushManager. */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isStandalonePwa() {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true
  );
}

export async function getPushPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Ensure the service worker is registered and active before PushManager calls. */
export async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('service_worker_unsupported');
  }
  let registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) {
    registration = await navigator.serviceWorker.register(SW_URL);
  }
  await navigator.serviceWorker.ready;
  // Prefer the registration that owns pushManager for this scope.
  registration = (await navigator.serviceWorker.getRegistration('/')) || registration;
  return registration;
}

function subscriptionPayload(subscription) {
  const json = typeof subscription?.toJSON === 'function' ? subscription.toJSON() : subscription;
  const endpoint = String(json?.endpoint || '').trim();
  const p256dh = String(json?.keys?.p256dh || '').trim();
  const auth = String(json?.keys?.auth || '').trim();
  return {
    endpoint,
    keys: { p256dh, auth },
    complete: Boolean(endpoint && p256dh && auth),
  };
}

async function persistSubscription(subscription, shopId) {
  const payload = subscriptionPayload(subscription);
  if (!payload.complete) {
    throw new Error('incomplete_push_subscription');
  }
  // Send full endpoint + keys without truncation (server stores TEXT columns).
  await api.post('/notifications/push/subscribe', {
    endpoint: payload.endpoint,
    keys: {
      p256dh: payload.keys.p256dh,
      auth: payload.keys.auth,
    },
    shop_id: shopId || null,
  });
  return payload;
}

async function subscribeWithVapid(registration, publicKey) {
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  if (!(applicationServerKey instanceof Uint8Array) || applicationServerKey.byteLength < 65) {
    throw new Error('invalid_vapid_public_key');
  }

  let subscription = await registration.pushManager.getSubscription();
  const existing = subscription ? subscriptionPayload(subscription) : null;

  // Re-subscribe if missing or if keys/endpoint were incomplete / truncated.
  if (!existing?.complete) {
    if (subscription) {
      try {
        await subscription.unsubscribe();
      } catch {
        // continue and create a fresh subscription
      }
    }
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  return subscription;
}

/**
 * Ask for notification permission (must run from a user gesture on iOS),
 * subscribe via the active service worker, and persist the subscription.
 */
export async function enablePushNotifications({ shopId = store.activeShop?.id } = {}) {
  if (!pushSupported()) {
    toast(t('push.unsupported'), 'warn');
    return { ok: false, reason: 'unsupported' };
  }

  // iOS only delivers Web Push from an installed Home Screen PWA.
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos && !isStandalonePwa()) {
    toast(t('push.iosInstallFirst'), 'warn');
    return { ok: false, reason: 'ios_not_standalone' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast(t('push.denied'), 'warn');
    return { ok: false, reason: 'denied' };
  }

  const { configured, publicKey } = await api.get('/notifications/push/vapid-public-key');
  if (!configured || !publicKey) {
    toast(t('push.notConfigured'), 'warn');
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const registration = await ensureServiceWorker();
    const subscription = await subscribeWithVapid(registration, publicKey);
    const saved = await persistSubscription(subscription, shopId);

    try {
      localStorage.setItem('derte_push_enabled', '1');
    } catch {
      // ignore quota
    }

    toast(t('push.enabled'), 'ok');
    return { ok: true, subscription: saved };
  } catch (error) {
    console.error('[push] enable failed:', error?.message || error);
    toast(t('push.enableFailed'), 'warn');
    return { ok: false, reason: 'error', error: error?.message || String(error) };
  }
}

/** Best-effort resubscribe after login when the user previously enabled push. */
export async function maybeRefreshPushSubscription() {
  if (!pushSupported() || !store.isAuthenticated) return;
  if (Notification.permission !== 'granted') return;
  let pref = '0';
  try {
    pref = localStorage.getItem('derte_push_enabled') || '0';
  } catch {
    return;
  }
  if (pref !== '1') return;

  try {
    const { configured, publicKey } = await api.get('/notifications/push/vapid-public-key');
    if (!configured || !publicKey) return;
    const registration = await ensureServiceWorker();
    const subscription = await subscribeWithVapid(registration, publicKey);
    await persistSubscription(subscription, store.activeShop?.id || null);
  } catch (error) {
    console.warn('[push] refresh failed:', error?.message || error);
  }
}
