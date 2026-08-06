/**
 * DerteApp entry point.
 *
 * Registers every screen, guards them by session and role, boots the service
 * worker and keeps the navigation badges fresh.
 */
import { setUnauthorizedHandler } from './api.js';
import { navigate, resolve, route, setGuard, setNotFound, startRouter } from './router.js';
import { mountShell, screen } from './shell.js';
import { loadSession, refreshBadges, store } from './store.js';
import { icon, toast } from './ui.js';

import { adminCallsView, adminInboxView, adminOverviewView, adminShopsView } from './views/admin.js';
import { appointmentView, appointmentsView } from './views/appointments.js';
import { loginView, otpView, registerView, resetView } from './views/auth.js';
import { chatListView, chatView } from './views/chat.js';
import { homeView } from './views/home.js';
import { insightsView } from './views/insights.js';
import { scheduleView } from './views/schedule.js';
import {
  profileView,
  settingsView,
  shopSettingsView,
  teamView,
  telephonyView,
  websiteView,
} from './views/settings.js';

const PUBLIC_PATHS = new Set(['/login', '/register', '/code', '/reset']);

// --- routes ------------------------------------------------------------------

route('/login', loginView);
route('/register', registerView);
route('/code', otpView);
route('/reset', resetView);

route('/', homeView);
// Same screen, reached by a Super Admin who picked a shop to work on.
route('/dashboard', homeView);
route('/appointments', appointmentsView);
route('/appointments/:id', appointmentView);
route('/chat', chatListView);
route('/chat/:threadId', chatView);
route('/schedule', scheduleView);
route('/insights', insightsView);

route('/settings', settingsView);
route('/settings/profile', profileView);
route('/settings/shop', shopSettingsView);
route('/settings/website', websiteView);
route('/settings/telephony', telephonyView);
route('/settings/team', teamView);

route('/admin', adminOverviewView);
route('/admin/shops', adminShopsView);
route('/admin/inbox', adminInboxView);
route('/admin/calls', adminCallsView);

setNotFound(({ path }) => {
  screen({
    title: 'Not found',
    back: store.isAuthenticated ? '/' : '/login',
    content: `
      <div class="empty">
        ${icon('inspect', { size: 30 })}
        <div class="empty__title">Nothing here</div>
        <div><code>${path.replace(/[<>&]/g, '')}</code> is not a DerteApp screen.</div>
      </div>`,
  });
});

// --- guards ------------------------------------------------------------------

setGuard((path) => {
  if (!store.isAuthenticated) return PUBLIC_PATHS.has(path) ? null : '/login';
  // Signed in: the auth screens have nothing left to offer.
  if (PUBLIC_PATHS.has(path)) return store.isSuperAdmin ? '/admin' : '/';
  // A Super Admin's home is the master dashboard; /dashboard is the per-shop one.
  if (path === '/' && store.isSuperAdmin) return '/admin';
  return null;
});

setUnauthorizedHandler(() => {
  store.user = null;
  store.shops = [];
  navigate('/login', { replace: true });
});

// --- background refresh ------------------------------------------------------

const BADGE_INTERVAL = 60_000;
let badgeTimer = null;

function startBadgeRefresh() {
  if (badgeTimer) clearInterval(badgeTimer);
  badgeTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && store.isAuthenticated) void refreshBadges();
  }, BADGE_INTERVAL);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.isAuthenticated) void refreshBadges();
});

addEventListener('online', () => {
  document.body.classList.remove('is-offline');
  void resolve();
});
addEventListener('offline', () => {
  document.body.classList.add('is-offline');
  toast('You are offline — showing the last data we loaded', 'warn');
});

// --- install prompt ----------------------------------------------------------

/**
 * Chromium fires `beforeinstallprompt`; we keep the event so Settings can offer
 * a real install button. iOS has no such API, so Settings explains the
 * Share → "Add to Home Screen" route instead.
 */
addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.derteInstallPrompt = event;
  document.body.classList.add('can-install');
});

addEventListener('appinstalled', () => {
  window.derteInstallPrompt = null;
  document.body.classList.remove('can-install');
  toast('DerteApp installed', 'ok');
});

// --- service worker ----------------------------------------------------------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[pwa] service worker registration failed:', error.message);
    });
  });
}

// --- boot --------------------------------------------------------------------

async function boot() {
  if (!navigator.onLine) document.body.classList.add('is-offline');

  await loadSession();
  mountShell();
  await startRouter();

  if (store.isAuthenticated) {
    void refreshBadges();
    startBadgeRefresh();
  }

  document.getElementById('boot')?.remove();
  registerServiceWorker();
}

void boot();
