import { query, queryAll, queryOne, transaction } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { formatPhone, normalizePhone, requirePhone, telLink, whatsappLink } from '../lib/phone.js';
import {
  assertAllowedPhone,
  assertEmail,
  assertStrongPassword,
  createShop,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  hashPassword,
  publicUser,
  revokeAllSessions,
} from './auth.js';
import { recordAudit } from './appointments.js';
import { syncOwnerToSupabase } from './supabase-sync.js';

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

function shopSummary(shop, memberRole = 'owner') {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    timezone: shop.timezone,
    status: shop.status,
    phone: shop.phone,
    member_role: memberRole,
  };
}

/**
 * Super Admin creates a shop-owner account (email + password).
 *
 * Modes:
 * - `create_shop: true` (default) + `shop_name` → create taller first, then user, then membership
 * - `shop_id` → attach owner to an existing taller (validated before insert)
 *
 * Everything local runs in one transaction so FK order stays consistent.
 */
export async function createAccountByAdmin({
  email,
  password,
  full_name,
  shop_name,
  shop_id = null,
  create_shop = true,
  phone,
  timezone,
  address,
  city,
  site_url,
  website_url,
  whatsapp_phone,
  actorUserId,
  ip,
}) {
  assertStrongPassword(password);
  const normalizedPhone = assertAllowedPhone(requirePhone(phone));
  const normalizedEmail = assertEmail(email);
  const ownerName = String(full_name ?? '').trim();
  if (ownerName.length < 2) {
    throw badRequest('El nombre es obligatorio', { code: 'name_required' });
  }

  if (await findUserByEmail(normalizedEmail)) {
    throw conflict('Ese correo ya está registrado. Inicia sesión.', { code: 'email_taken' });
  }
  if (await findUserByPhone(normalizedPhone)) {
    throw conflict('Ese teléfono ya está registrado. Inicia sesión.', { code: 'phone_taken' });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const normalizedShopId =
    typeof shop_id === 'string' && shop_id.trim() && UUID_RE.test(shop_id.trim()) ? shop_id.trim() : null;

  if (shop_id && !normalizedShopId) {
    throw badRequest('El código de referencia del taller no existe.', {
      code: 'shop_reference_not_found',
    });
  }

  const attachToExisting = Boolean(normalizedShopId);
  // Default: create a new shop whenever no valid shop_id was provided.
  const shouldCreateShop = !attachToExisting && create_shop !== false;

  if (attachToExisting) {
    const existing = await queryOne(
      `SELECT id, name, status FROM shops WHERE id = $1 AND status <> 'archived'`,
      [normalizedShopId],
    );
    if (!existing) {
      throw badRequest('El código de referencia del taller no existe.', {
        code: 'shop_reference_not_found',
      });
    }
  } else if (shouldCreateShop) {
    if (!shop_name || String(shop_name).trim().length < 2) {
      throw badRequest('El nombre del taller es obligatorio', { code: 'shop_name_required' });
    }
  } else {
    throw badRequest('Selecciona un taller existente o marca «Crear nuevo taller».', {
      code: 'shop_required',
    });
  }

  let result;
  try {
    result = await transaction(async (client) => {
      let shop;

      if (attachToExisting) {
        shop = await client
          .query(`SELECT * FROM shops WHERE id = $1 AND status <> 'archived' FOR SHARE`, [normalizedShopId])
          .then(({ rows }) => rows[0]);
        if (!shop) {
          throw badRequest('El código de referencia del taller no existe.', {
            code: 'shop_reference_not_found',
          });
        }
      } else {
        // 1) Taller primero — evita FKs rotas al asociar el usuario.
        shop = await createShop(client, {
          name: String(shop_name).trim(),
          timezone,
          phone: normalizedPhone,
          whatsapp_phone: normalizePhone(whatsapp_phone) ?? normalizedPhone,
          email: normalizedEmail,
          site_url: site_url ?? null,
          website_url: website_url ?? null,
          site_domains: [],
          city: city ?? null,
          address: address ?? null,
        });

        if (address || city || website_url || site_url) {
          shop = await client
            .query(
              `UPDATE shops
                  SET address = COALESCE($2, address),
                      city = COALESCE($3, city),
                      website_url = COALESCE($4, website_url),
                      site_url = COALESCE($5, site_url)
                WHERE id = $1
                RETURNING *`,
              [shop.id, address ?? null, city ?? null, website_url ?? null, site_url ?? website_url ?? null],
            )
            .then(({ rows }) => rows[0]);
        }
      }

      // 2) Usuario dueño (password bcrypt-hashed)
      const user = await client
        .query(
          `INSERT INTO users (phone, password_hash, full_name, email, role, whatsapp_phone, phone_verified_at, locale)
           VALUES ($1, $2, $3, $4, 'shop_owner', $5, now(), 'es') RETURNING *`,
          [
            normalizedPhone,
            await hashPassword(password),
            ownerName,
            normalizedEmail,
            normalizePhone(whatsapp_phone) ?? normalizedPhone,
          ],
        )
        .then(({ rows }) => rows[0]);

      // 3) Membresía
      await client.query(
        `INSERT INTO shop_members (shop_id, user_id, role, is_primary) VALUES ($1, $2, 'owner', true)
         ON CONFLICT (shop_id, user_id) DO UPDATE SET role = 'owner', is_primary = true`,
        [shop.id, user.id],
      );

      return { user, shop };
    });
  } catch (error) {
    if (error?.status) throw error;
    if (error?.code === '23503') {
      throw badRequest('El código de referencia del taller no existe.', {
        code: 'shop_reference_not_found',
        details: { constraint: error.constraint ?? null, detail: error.detail ?? null },
      });
    }
    if (error?.code === '42703') {
      throw badRequest(
        'El esquema de base de datos está desactualizado. Reinicia el servicio para aplicar migraciones.',
        { code: 'schema_outdated', details: { message: error.message } },
      );
    }
    throw error;
  }

  // Audit must never roll back a successful create.
  try {
    await recordAudit({
      actorUserId,
      shopId: result.shop.id,
      action: 'admin.user.create',
      entityId: result.user.id,
      metadata: {
        email: result.user.email,
        shop_name: result.shop.name,
        shop_id: result.shop.id,
        attached_existing: attachToExisting,
      },
      ip,
    });
  } catch (error) {
    console.warn('[admin-users] audit failed after create:', error?.message || error);
  }

  // Best-effort remote mirror via service role; never fails the local create.
  try {
    await syncOwnerToSupabase({
      user: result.user,
      password,
      shop: result.shop,
    });
  } catch (error) {
    console.warn('[admin-users] supabase sync failed after create:', error?.message || error);
  }

  return {
    user: publicUser(result.user, [shopSummary(result.shop)]),
    shop: {
      id: result.shop.id,
      name: result.shop.name,
      timezone: result.shop.timezone,
      phone: result.shop.phone ?? null,
      address: result.shop.address ?? null,
      city: result.shop.city ?? null,
      site_url: result.shop.site_url ?? null,
      website_url: result.shop.website_url ?? null,
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
