/**
 * Auth-aware error handling for owner screens (home / appointments).
 * Never spams red toasts for user↔shop link / session issues — the UI shows a
 * single "Iniciar Sesión de Nuevo" action instead.
 */
import { ApiError } from './api.js';
import { navigate } from './router.js';
import { loadSession, signOut } from './store.js';
import { esc, icon } from './ui.js';

const SESSION_CODES = new Set([
  'session_required',
  'session_stale',
  'user_reference_not_found',
  'appointment_actor_invalid',
  'account_suspended',
  'shop_forbidden',
]);

const LINK_MESSAGE_RE = /vincular el usuario al taller|referencia de usuario inválida|sesión ya no es válida|inicia sesión/i;

export function isSessionLinkError(error) {
  if (!error) return false;
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return true;
    if (SESSION_CODES.has(error.code)) return true;
  }
  return LINK_MESSAGE_RE.test(String(error.message || ''));
}

/** Markup for a calm re-auth prompt (no red banners). */
export function reauthPanel({
  title = 'Sesión no disponible',
  body = 'Vuelve a iniciar sesión para continuar con tu taller.',
} = {}) {
  return `
    <div class="empty" data-reauth-panel>
      ${icon('settings', { size: 30 })}
      <div class="empty__title">${esc(title)}</div>
      <div>${esc(body)}</div>
      <button class="btn" type="button" data-reauth style="margin-top:14px">
        Iniciar Sesión de Nuevo
      </button>
    </div>`;
}

/** Binds the re-auth button: clears local session and goes to /login. */
export function bindReauthPanel(root) {
  root?.querySelector('[data-reauth]')?.addEventListener('click', async () => {
    try {
      await signOut();
    } catch {
      // Local clear is enough.
    }
    navigate('/login', { replace: true });
  });
}

/**
 * Handles an API failure without toast spam.
 * - Auth/link errors → optional reauth panel, optional silent session refresh
 * - Other errors → optional errorBox text only (no toast)
 * Returns true when the caller should stop retrying.
 */
export async function handleSessionAwareError(error, { errorBox = null, showReauth = null } = {}) {
  if (isSessionLinkError(error)) {
    if (showReauth) {
      const host = typeof showReauth === 'function' ? showReauth() : showReauth;
      if (host) bindReauthPanel(host);
      return true;
    }

    // Try one silent refresh; if it fails, send the user to login once.
    try {
      const ok = await loadSession();
      if (ok) return false;
    } catch {
      // fall through
    }
    try {
      await signOut();
    } catch {
      // ignore
    }
    navigate('/login', { replace: true });
    return true;
  }

  if (errorBox) {
    errorBox.textContent = error?.message || 'Algo ha fallado. Inténtalo de nuevo.';
  }
  return false;
}
