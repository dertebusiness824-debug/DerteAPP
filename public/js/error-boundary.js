/**
 * Vanilla stand-in for React error boundaries.
 *
 * A throw in Vehículos, Diagnóstico or a leftover sheet must never unmount
 * the shell or bounce the mechanic back to Inicio. Network / API failures
 * stay on the current route and paint an inline message.
 */
import { ApiError } from './api.js';
import { t } from './i18n.js';
import { screen } from './shell.js';
import { esc, icon, toast } from './ui.js';

const WORKSPACE_PREFIXES = [
  '/appointments',
  '/reservas',
  '/urgencias',
  '/vehiculos',
  '/diagnostico',
  '/inventario',
  '/dashboard',
];

/** Shop-owner (and Super Admin-in-shop) screens that must not eject to Inicio. */
export function isWorkspacePath(path) {
  const raw = path ?? (typeof location !== 'undefined' ? location.pathname : '/');
  const clean = String(raw || '').split('?')[0] || '/';
  if (clean === '/') return true;
  return WORKSPACE_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
}

export function friendlyApiMessage(error) {
  if (!error) return t('error.generic');
  if (error.name === 'AbortError') return t('error.network');
  if (error instanceof TypeError) return t('error.network');
  if (error instanceof ApiError) return error.message || t('error.generic');
  return error.message || t('error.generic');
}

/** In-place recovery. Does not call navigate() — the URL stays put. */
export function paintRouteError(error, { onRetry } = {}) {
  const message = friendlyApiMessage(error);
  screen({
    title: t('error.routeTitle'),
    content: `
      <div class="card stack" data-route-error>
        <div class="empty empty--inline">
          ${icon('inspect', { size: 28 })}
          <div class="empty__title">${esc(t('error.routeTitle'))}</div>
          <div>${esc(t('error.routeBody'))}</div>
          <p class="list__meta">${esc(message)}</p>
        </div>
        <button class="btn btn--block" type="button" data-retry-route>
          ${esc(t('error.retry'))}
        </button>
      </div>`,
  });
  document.querySelector('[data-retry-route]')?.addEventListener('click', () => {
    if (typeof onRetry === 'function') onRetry();
    else location.reload();
  });
}

/**
 * Catch window-level exceptions so they toast instead of tearing the SPA down.
 * Clicks / submits inside [data-error-boundary] are also wrapped.
 */
export function installGlobalErrorBoundary() {
  const report = (error, { toastIt = true } = {}) => {
    const message = friendlyApiMessage(error);
    console.warn('[derteapp] recovered from', error);
    if (toastIt) toast(message, 'error');
  };

  addEventListener('error', (event) => {
    if (!event.error) return;
    event.preventDefault();
    report(event.error);
  });

  addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    report(event.reason);
  });

  document.addEventListener(
    'submit',
    (event) => {
      const root = event.target?.closest?.('[data-error-boundary]');
      if (!root) return;
      // The view's own submit handler still runs; this only stops a throw
      // from bubbling out of a nested listener that forgot to catch.
      root.addEventListener(
        'error',
        (inner) => {
          inner.preventDefault();
          report(inner.error, { toastIt: true });
        },
        { once: true },
      );
    },
    true,
  );
}
