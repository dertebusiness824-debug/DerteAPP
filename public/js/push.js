/**
 * Web Push subscription helpers for the DerteApp PWA (incl. iOS home-screen).
 */
import { api } from './api.js';
import { store } from './store.js';
import { toast } from './ui.js';
import { t } from './i18n.js';

function urlBase64ToUint8Array(base64String) {
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

export async function getPushPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
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

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = subscription.toJSON();
  await api.post('/notifications/push/subscribe', {
    endpoint: json.endpoint,
    keys: json.keys,
    shop_id: shopId || null,
  });

  try {
    localStorage.setItem('derte_push_enabled', '1');
  } catch {
    // ignore quota
  }

  toast(t('push.enabled'), 'ok');
  return { ok: true, subscription: json };
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
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const json = subscription.toJSON();
    await api.post('/notifications/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
      shop_id: store.activeShop?.id || null,
    });
  } catch (error) {
    console.warn('[push] refresh failed:', error?.message || error);
  }
}
