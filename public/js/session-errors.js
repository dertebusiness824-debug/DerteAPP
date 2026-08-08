/**
 * Session helpers for owner screens.
 *
 * IMPORTANT: Never render “Iniciar Sesión de Nuevo” or
 * “No se pudieron cargar las reservas” cards on Dashboard / Reservas.
 * Those screens always soft-fail to an empty list.
 */
import { ApiError } from './api.js';
import { loadSession } from './store.js';
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

/**
 * Neutral empty panel — NO login button, NO load-error card.
 * Kept as a no-op-safe stub so any leftover caller cannot block the UI.
 */
export function reauthPanel({
  title = 'No hay reservas en esta categoría',
  body = 'Las reservas aparecerán aquí cuando estén disponibles.',
} = {}) {
  // Strip legacy error copy if a caller still passes the old strings.
  const blockedTitle = /no se pudieron cargar|sesión no disponible/i.test(title);
  const blockedBody = /iniciar sesión|prueba a iniciar/i.test(body);
  const safeTitle = blockedTitle ? 'No hay reservas en esta categoría' : title;
  const safeBody = blockedBody ? 'Las reservas aparecerán aquí cuando estén disponibles.' : body;
  return `
    <div class="empty" data-soft-empty-panel>
      ${icon('calendar', { size: 30 })}
      <div class="empty__title">${esc(safeTitle)}</div>
      <div>${esc(safeBody)}</div>
    </div>`;
}

/** No-op — login button was permanently removed from owner soft-empty panels. */
export function bindReauthPanel(_root) {
  // Intentionally empty.
}

/**
 * Handles an API failure without toast spam / without auth walls.
 * Returns true when the caller should stop retrying.
 */
export async function handleSessionAwareError(error, { errorBox = null } = {}) {
  if (isSessionLinkError(error)) {
    // Soft path only — never paint re-login UI from here.
    try {
      const ok = await loadSession();
      if (ok) return false;
    } catch {
      // fall through
    }
    return true;
  }

  if (errorBox) {
    errorBox.textContent = error?.message || 'Algo ha fallado. Inténtalo de nuevo.';
  }
  return false;
}
