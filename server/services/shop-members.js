/**
 * Safe shop ↔ user membership helpers.
 * Always validates the local Express `users.id` before writing shop_members.
 */
import { badRequest, unauthorized } from '../lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPgFkViolation(error) {
  return error?.code === '23503';
}

function fkMentionsUser(error) {
  const detail = `${error?.detail ?? ''} ${error?.message ?? ''} ${error?.constraint ?? ''}`.toLowerCase();
  return (
    detail.includes('shop_members_user') ||
    detail.includes('user_id') ||
    detail.includes('accepted_by') ||
    detail.includes('profiles')
  );
}

/**
 * Ensures `userId` is a non-empty UUID that exists in local `users`.
 * Throws 401 when missing/stale so the client can refresh session / login.
 */
export async function requireActiveUserId(clientOrNull, userId) {
  if (userId === null || userId === undefined || userId === '') {
    throw unauthorized('Inicia sesión para continuar', { code: 'session_required' });
  }
  if (!UUID.test(String(userId))) {
    throw badRequest('No se pudo vincular el usuario al taller (referencia de usuario inválida). Recarga e inténtalo de nuevo.', {
      code: 'user_reference_not_found',
    });
  }

  const runner = clientOrNull
    ? (sql, params) => clientOrNull.query(sql, params).then(({ rows }) => rows[0])
    : null;

  // When called outside a transaction, the caller should pass a query helper via client.
  if (!runner) {
    const { queryOne } = await import('../db/index.js');
    const user = await queryOne('SELECT id, status FROM users WHERE id = $1', [userId]);
    if (!user) {
      throw unauthorized('Tu sesión ya no es válida. Vuelve a iniciar sesión.', { code: 'session_stale' });
    }
    if (user.status && user.status !== 'active') {
      throw unauthorized('Esta cuenta está suspendida', { code: 'account_suspended' });
    }
    return user.id;
  }

  const user = await runner('SELECT id, status FROM users WHERE id = $1', [userId]);
  if (!user) {
    throw unauthorized('Tu sesión ya no es válida. Vuelve a iniciar sesión.', { code: 'session_stale' });
  }
  if (user.status && user.status !== 'active') {
    throw unauthorized('Esta cuenta está suspendida', { code: 'account_suspended' });
  }
  return user.id;
}

/**
 * Links a local user to a shop (owner/manager/mechanic).
 * Validates both sides of the FK before INSERT to avoid opaque 23503 errors.
 */
export async function linkUserToShop(client, { shopId, userId, role = 'mechanic', isPrimary = false }) {
  if (!shopId || !UUID.test(String(shopId))) {
    throw badRequest('El código de referencia del taller no existe.', { code: 'shop_reference_not_found' });
  }

  const resolvedUserId = await requireActiveUserId(client, userId);

  const shop = await client
    .query(`SELECT id FROM shops WHERE id = $1 AND status <> 'archived'`, [shopId])
    .then(({ rows }) => rows[0]);
  if (!shop) {
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

  return { shop_id: shopId, user_id: resolvedUserId, role, is_primary: Boolean(isPrimary) };
}
