import { queryAll, transaction } from '../db/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';
import {
  assertStrongPassword,
  findUserById,
  publicUser,
  registerShopOwner,
  revokeAllSessions,
} from './auth.js';
import { recordAudit } from './appointments.js';

/** Public shape for the Super Admin accounts list. */
export function serializeAdminUser(row) {
  return {
    id: row.id,
    phone: row.phone,
    phone_display: row.phone ? formatPhone(row.phone) : null,
    tel_link: telLink(row.phone),
    whatsapp_link: whatsappLink(row.whatsapp_phone ?? row.phone),
    full_name: row.full_name,
    email: row.email ?? null,
    role: row.role,
    status: row.status,
    google_linked: Boolean(row.google_sub),
    last_login_at: row.last_login_at ?? null,
    created_at: row.created_at,
    shops: Array.isArray(row.shops) ? row.shops : [],
  };
}

export function listAdminUsers({ search = null, role = null, limit = 100 } = {}) {
  return queryAll(
    `SELECT u.id, u.phone, u.full_name, u.email, u.role, u.status, u.google_sub,
            u.last_login_at, u.created_at, u.whatsapp_phone,
            COALESCE(json_agg(json_build_object('id', s.id, 'name', s.name, 'role', m.role, 'status', s.status)
                     ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS shops
       FROM users u
       LEFT JOIN shop_members m ON m.user_id = u.id
       LEFT JOIN shops s ON s.id = m.shop_id
      WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%'
             OR u.phone ILIKE '%' || $1 || '%'
             OR u.email ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR u.role = $2)
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $3`,
    [search ?? null, role ?? null, limit],
  );
}

/**
 * Super Admin creates a shop-owner account (email + password) and its shop.
 * Password is hashed inside registerShopOwner before insert.
 */
export async function createAccountByAdmin({
  email,
  password,
  full_name,
  shop_name,
  phone,
  timezone,
  actorUserId,
  ip,
}) {
  assertStrongPassword(password);
  const result = await registerShopOwner({
    email,
    password,
    full_name,
    shop_name,
    phone,
    timezone,
  });

  await recordAudit({
    actorUserId,
    shopId: result.shop.id,
    action: 'admin.user.create',
    entityId: result.user.id,
    metadata: { email: result.user.email, shop_name: result.shop.name },
    ip,
  });

  return {
    user: publicUser(result.user, [
      {
        id: result.shop.id,
        name: result.shop.name,
        slug: result.shop.slug,
        timezone: result.shop.timezone,
        status: result.shop.status,
        phone: result.shop.phone,
        member_role: 'owner',
      },
    ]),
    shop: {
      id: result.shop.id,
      name: result.shop.name,
      timezone: result.shop.timezone,
      status: result.shop.status,
    },
  };
}

/**
 * Deletes a user account. Refuses to delete Super Admins (including self).
 * Orphaned shops with no remaining members are removed too.
 */
export async function deleteAccountByAdmin({ userId, actorUserId, ip }) {
  if (!userId) throw badRequest('Falta el id de usuario');
  if (userId === actorUserId) {
    throw forbidden('No puedes eliminar tu propia cuenta de Super Admin', { code: 'cannot_delete_self' });
  }

  const user = await findUserById(userId);
  if (!user) throw notFound('Usuario no encontrado');
  if (user.role === 'super_admin') {
    throw forbidden('No se pueden eliminar cuentas de Super Admin', { code: 'cannot_delete_super_admin' });
  }

  const memberships = await queryAll(`SELECT shop_id FROM shop_members WHERE user_id = $1`, [userId]);

  await revokeAllSessions(userId);

  const deleted = await transaction(async (client) => {
    await client.query('DELETE FROM shop_members WHERE user_id = $1', [userId]);

    for (const { shop_id: shopId } of memberships) {
      const remaining = await client
        .query('SELECT count(*)::int AS n FROM shop_members WHERE shop_id = $1', [shopId])
        .then(({ rows }) => rows[0].n);
      if (remaining === 0) {
        await client.query('DELETE FROM shops WHERE id = $1', [shopId]);
      }
    }

    const { rows } = await client.query(
      `DELETE FROM users WHERE id = $1 RETURNING id, email, full_name, phone, role`,
      [userId],
    );
    return rows[0];
  });

  if (!deleted) throw notFound('Usuario no encontrado');

  await recordAudit({
    actorUserId,
    action: 'admin.user.delete',
    entityId: deleted.id,
    metadata: { email: deleted.email, full_name: deleted.full_name, phone: deleted.phone },
    ip,
  });

  return deleted;
}
