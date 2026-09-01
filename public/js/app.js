/**
 * DerteApp entry point.
 *
 * Registers every screen, guards them by session and role, boots the service
 * worker and keeps the navigation badges fresh.
 */
import { setUnauthorizedHandler } from './api.js';
import { startGlobalDataLayer } from './data-cache.js';
import { installGlobalErrorBoundary, isWorkspacePath, paintRouteError } from './error-boundary.js';
import { ensureServiceWorker, maybeRefreshPushSubscription } from './push.js';
import { navigate, route, setGuard, setNotFound, setRouteErrorHandler, startRouter } from './router.js';
import { mountShell, screen } from './shell.js';
import { loadSession, refreshBadges, store } from './store.js';
import { icon, toast } from './ui.js';

import {
  adminCallsView,
  adminOverviewView,
  adminShopsView,
  adminUsersView,
} from './views/admin.js';
import { adminClientesView } from './views/admin-clientes.js';
import { adminConsultasView } from './views/admin-consultas.js';
import { adminMatriculasView } from './views/admin-matriculas.js';
import { adminCommissionsView } from './views/admin_commissions.js';
import { yearSummaryView } from './views/year-summary.js';
import { appointmentView, appointmentsView } from './views/appointments.js';
import { loginView, otpView, registerView, resetView } from './views/auth.js';
import { chatView } from './views/chat.js';
import { diagnosticsView } from './views/diagnostics.js';
import { homeView } from './views/home.js';
import { insightsView } from './views/insights.js';
import { inventoryView } from './views/inventory.js';
import { urgenciasView, urgenciaDetailView } from './views/urgencias.js';
import { vehicleView, vehiclesView } from './views/vehicles.js';
import {
  profileView,
  settingsView,
  shopSettingsView,
  teamView,
  websiteView,
} from './views/settings.js';
import { telephonyView } from './views/telephony.js';
import { webPanelView } from './views/web.js';

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
route('/reservas', appointmentsView);
route('/reservas/:id', appointmentView);
route('/urgencias', urgenciasView);
route('/urgencias/:id', urgenciaDetailView);
route('/vehiculos', vehiclesView);
route('/vehiculos/:id', vehicleView);
route('/diagnostico', diagnosticsView);
route('/inventario', inventoryView);
// Leftover support threads stay reachable; Super Admin nav now uses CLIENTES.
route('/chat/:threadId', chatView);
route('/insights', insightsView);
route('/rendimiento', yearSummaryView);
route('/web', webPanelView);

route('/settings', settingsView);
route('/settings/profile', profileView);
route('/settings/shop', shopSettingsView);
route('/settings/website', websiteView);
route('/settings/telephony', telephonyView);
route('/settings/team', teamView);

route('/admin', adminOverviewView);
route('/admin/shops', adminShopsView);
route('/admin/matriculas', adminMatriculasView);
route('/admin/consultas', adminConsultasView);
route('/admin/commissions', adminCommissionsView);
route('/admin/sales', () => navigate('/admin/consultas', { replace: true }));
route('/admin/users', adminUsersView);
route('/admin/clientes', adminClientesView);
route('/admin/inbox', () => navigate('/admin/clientes', { replace: true }));
route('/admin/calls', adminCallsView);

setNotFound(({ path }) => {
  screen({
    title: 'No encontrado',
    back: store.isAuthenticated ? '/' : '/login',
    content: `
      <div class="empty">
        ${icon('inspect', { size: 30 })}
        <div class="empty__title">Aquí no hay nada</div>
        <div><code>${path.replace(/[<>&]/g, '')}</code> no es una pantalla de DerteApp.</div>
      </div>`,
  });
});

// --- guards ------------------------------------------------------------------

setGuard((path) => {
  if (!store.isAuthenticated) return PUBLIC_PATHS.has(path) ? null : '/login';
  // Signed in: the auth screens have nothing left to offer.
  if (PUBLIC_PATHS.has(path)) return store.isSuperAdmin ? '/admin' : '/';
  // Account management and the rest of /admin are Super Admin only.
  if (path.startsWith('/admin') && !store.isSuperAdmin) return '/';
  // A Super Admin's home is the master dashboard; /dashboard is the per-shop one.
  if (path === '/' && store.isSuperAdmin) return '/admin';
  return null;
});

setRouteErrorHandler((error, { retry } = {}) => {
  paintRouteError(error, { onRetry: retry });
});

setUnauthorizedHandler(async () => {
  // Avoid remounting /login while the user is already typing credentials.
  if (PUBLIC_PATHS.has(location.pathname)) return;
  // Vehículos, Diagnóstico, Citas… stay put. Do not empty the store: the
  // cookie session (and Supabase shop link) may still be valid.
  if (isWorkspacePath(location.pathname)) {
    try {
      await loadSession({ keepAlive: true });
    } catch {
      // Ignore — the screen already shows its own error.
    }
    return;
  }
  store.user = null;
  store.shops = [];
  store.activeShopId = null;
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
  // Do not remount the current view: that destroyed open <select>/<details>
  // and looked like a bounce back to Inicio when the remount threw.
  if (store.isAuthenticated) void refreshBadges();
});
addEventListener('offline', () => {
  document.body.classList.add('is-offline');
  toast('Sin conexión — mostrando los últimos datos cargados', 'warn');
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
  toast('DerteApp instalada', 'ok');
});

// --- service worker ----------------------------------------------------------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await ensureServiceWorker();
    // Force clients onto the latest shell (push + header + data cache).
    registration.update().catch(() => {});
    if (registration.waiting) registration.waiting.postMessage('skip-waiting');
    return registration;
  } catch (error) {
    console.warn('[pwa] service worker registration failed:', error?.message || error);
    return null;
  }
}

// --- boot --------------------------------------------------------------------

const SPLASH_MS = 1000;
const SPLASH_FADE_MS = 280;

async function boot() {
  if (!navigator.onLine) document.body.classList.add('is-offline');

  // Keep the logo splash on screen for at least 1s, even if session loads faster.
  const splashHold = new Promise((resolve) => setTimeout(resolve, SPLASH_MS));
  await Promise.all([loadSession(), splashHold]);
  // loadSession already calls initLocale from the user profile / localStorage.

  // Register SW before push refresh — iOS needs an active worker for PushManager.
  await registerServiceWorker();

  mountShell();
  installGlobalErrorBoundary();
  await startRouter();

  if (store.isAuthenticated) {
    void refreshBadges();
    startBadgeRefresh();
    // If Notification.permission === "granted", upsert push token for the shop.
    void maybeRefreshPushSubscription();
  }

  // Always start the data layer — it no-ops until authenticated, then prefetches
  // reservas/urgencias and keeps the shop SSE live sync warm.
  startGlobalDataLayer();

  await dismissSplash();
}

async function dismissSplash() {
  const bootEl = document.getElementById('boot');
  if (!bootEl) return;
  bootEl.classList.add('boot--out');
  await new Promise((resolve) => setTimeout(resolve, SPLASH_FADE_MS));
  bootEl.remove();
}

void boot();
