/**
 * Safe shop ↔ user membership helpers.
 * Never fires a shop_members write when the user id is missing — callers get a
 * quiet `{ skipped: true }` instead of a red client-facing 400 loop.
 */
import { badRequest, unauthorized } from '../lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPgFkViolation(error) {
  return error?.code === '23503';
}

function fkMentionsUser(error) {
  const detail = `${error?.detail ?? ''} ${error?.message ?? ''} ${error?.constraint ?? ''}`.toLowerCase();
  return (
    detail.includes('shop_members_user_id_fkey') ||
    detail.includes('shop_members_user_id') ||
    (detail.includes('shop_members') && detail.includes('user_id'))
  );
}

/** Resolves Express `user.id` or Supabase-style `user.uid`. */
export function resolveUserId(userOrId) {
  if (userOrId === null || userOrId === undefined || userOrId === '') return null;
  if (typeof userOrId === 'string' || typeof userOrId === 'number') return String(userOrId);
  return userOrId.id ?? userOrId.uid ?? null;
}

/**
 * Ensures `userId` is a non-empty UUID that exists in local `users`.
 * Returns null (instead of throwing) when the id is missing — so callers can
 * skip linking without surfacing alerts.
 */
export async function requireActiveUserId(clientOrNull, userId, { required = true } = {}) {
  const id = resolveUserId(userId);
  if (!id) {
    if (!required) return null;
    throw unauthorized('Inicia sesión para continuar', { code: 'session_required' });
  }
  if (!UUID.test(String(id))) {
    if (!required) return null;
    throw unauthorized('Tu sesión ya no es válida. Vuelve a iniciar sesión.', { code: 'session_stale' });
  }

  const runner = clientOrNull
    ? (sql, params) => clientOrNull.query(sql, params).then(({ rows }) => rows[0])
    : null;

  const lookup = async () => {
    if (runner) return runner('SELECT id, status FROM users WHERE id = $1', [id]);
    const { queryOne } = await import('../db/index.js');
    return queryOne('SELECT id, status FROM users WHERE id = $1', [id]);
  };

  const user = await lookup();
  if (!user) {
    if (!required) return null;
    throw unauthorized('Tu sesión ya no es válida. Vuelve a iniciar sesión.', { code: 'session_stale' });
  }
  if (user.status && user.status !== 'active') {
    if (!required) return null;
    throw unauthorized('Esta cuenta está suspendida', { code: 'account_suspended' });
  }
  return user.id;
}

/**
 * Links a local user to a shop (owner/manager/mechanic).
 *
 * Soft by default for missing ids: no DB write, no thrown "referencia inválida".
 * Pass `{ strict: true }` for admin/onboarding flows that must fail loudly.
 */
export async function linkUserToShop(
  client,
  { shopId, userId, role = 'mechanic', isPrimary = false, strict = false } = {},
) {
  const id = resolveUserId(userId);
  if (!id) {
    console.warn('[shop-members] link skipped — missing user.id / user.uid');
    return { skipped: true, reason: 'missing_user_id' };
  }

  if (!shopId || !UUID.test(String(shopId))) {
    if (!strict) {
      console.warn('[shop-members] link skipped — missing/invalid shopId');
      return { skipped: true, reason: 'missing_shop_id' };
    }
    throw badRequest('El código de referencia del taller no existe.', { code: 'shop_reference_not_found' });
  }

  const resolvedUserId = await requireActiveUserId(client, id, { required: strict });
  if (!resolvedUserId) {
    console.warn('[shop-members] link skipped — user not found in local users', id);
    return { skipped: true, reason: 'user_not_found' };
  }

  const shop = await client
    .query(`SELECT id FROM shops WHERE id = $1 AND status <> 'archived'`, [shopId])
    .then(({ rows }) => rows[0]);
  if (!shop) {
    if (!strict) {
      console.warn('[shop-members] link skipped — shop not found', shopId);
      return { skipped: true, reason: 'shop_not_found' };
    }
    throw badRequest('El código de referencia del taller no existe.', { code: 'shop_reference_not_found' });
  }

  try {
    await client.query(
      `INSERT INTO shop_members (shop_id, user_id, role, is_primary)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (shop_id, user_id) DO UPDATE
         SET role = EXCLUDED.role,
             is_primary = shop_members.is_primary OR EXCLUDED.is_primary`,
      [shopId, resolvedUserId, role, Boolean(isPrimary)],
    );
  } catch (error) {
    if (isPgFkViolation(error)) {
      if (!strict) {
        console.warn('[shop-members] link skipped — FK violation', error.detail || error.message);
        return { skipped: true, reason: 'fk_violation' };
      }
      if (fkMentionsUser(error)) {
        throw badRequest(
          'No se pudo vincular el usuario al taller (referencia de usuario inválida). Recarga e inténtalo de nuevo.',
          {
            code: 'user_reference_not_found',
            details: { constraint: error.constraint ?? null },
          },
        );
      }
      throw badRequest('El código de referencia del taller no existe.', {
        code: 'shop_reference_not_found',
        details: { constraint: error.constraint ?? null },
      });
    }
    throw error;
  }

  return { shop_id: shopId, user_id: resolvedUserId, role, is_primary: Boolean(isPrimary), skipped: false };
}
