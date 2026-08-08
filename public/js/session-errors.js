/**
 * Auth-aware API error handling for owner screens (home / appointments).
 * Refreshes the session or sends the user to login when the server reports a
 * missing / stale user reference.
 */
import { ApiError } from './api.js';
import { navigate } from './router.js';
import { loadSession, signOut } from './store.js';
import { toast } from './ui.js';

const SESSION_CODES = new Set([
  'session_required',
  'session_stale',
  'user_reference_not_found',
  'appointment_actor_invalid',
]);

export function isSessionLinkError(error) {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401) return true;
  return SESSION_CODES.has(error.code);
}

/**
 * Handles an API failure once: optional error box, one toast, and session recovery.
 * Returns true when the caller should stop (redirect / reload in progress).
 */
export async function handleSessionAwareError(error, { errorBox = null, toastOnce = true } = {}) {
  const message = error?.message || 'Algo ha fallado. Inténtalo de nuevo.';

  if (errorBox) {
    errorBox.textContent = message;
  } else if (toastOnce) {
    toast(message, 'error');
  }

  if (!isSessionLinkError(error)) return false;

  // Try a silent session refresh first; if it fails, return to login.
  try {
    const ok = await loadSession();
    if (ok) {
      if (toastOnce && errorBox) toast(message, 'error');
      return false;
    }
  } catch {
    // fall through to sign-out
  }

  await signOut();
  navigate('/login', { replace: true });
  return true;
}
