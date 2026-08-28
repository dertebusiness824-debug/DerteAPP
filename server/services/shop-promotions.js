/**
 * Ofertas / promociones por taller (panel de Super Admin → PWA de clientes).
 */
import { query, queryAll, queryOne } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';

function serializePromotion(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    shop_name: row.shop_name ?? null,
    title: row.title,
    description: row.description ?? null,
    badge_label: row.badge_label ?? null,
    discount_percent: row.discount_percent != null ? Number(row.discount_percent) : null,
    price_from: row.price_from != null ? Number(row.price_from) : null,
    price_to: row.price_to != null ? Number(row.price_to) : null,
    currency: row.currency ?? 'EUR',
    service_name: row.service_name ?? null,
    starts_at: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    ends_at: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function listShopPromotions(shopId, { includeInactive = true } = {}) {
  const rows = await queryAll(
    `SELECT p.*, s.name AS shop_name
       FROM shop_promotions p
       JOIN shops s ON s.id = p.shop_id
      WHERE p.shop_id = $1
        AND ($2::boolean OR p.is_active)
      ORDER BY p.sort_order ASC, p.created_at DESC`,
    [shopId, includeInactive],
  );
  return rows.map(serializePromotion);
}

export async function getShopPromotion(promotionId) {
  const row = await queryOne(
    `SELECT p.*, s.name AS shop_name
       FROM shop_promotions p
       JOIN shops s ON s.id = p.shop_id
      WHERE p.id = $1`,
    [promotionId],
  );
  return serializePromotion(row);
}

function normalizePayload(body) {
  const title = String(body.title ?? '').trim();
  if (title.length < 2) throw badRequest('El título de la oferta es obligatorio');

  const startsAt = body.starts_at ? new Date(body.starts_at) : null;
  const endsAt = body.ends_at ? new Date(body.ends_at) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) throw badRequest('Fecha de inicio inválida');
  if (endsAt && Number.isNaN(endsAt.getTime())) throw badRequest('Fecha de fin inválida');
  if (startsAt && endsAt && endsAt < startsAt) {
    throw badRequest('La fecha de fin no puede ser anterior al inicio');
  }

  const discount =
    body.discount_percent === null || body.discount_percent === undefined || body.discount_percent === ''
      ? null
      : Number(body.discount_percent);
  if (discount != null && (Number.isNaN(discount) || discount < 0 || discount > 100)) {
    throw badRequest('El descuento debe estar entre 0 y 100');
  }

  return {
    title,
    description: body.description ? String(body.description).trim().slice(0, 800) || null : null,
    badge_label: body.badge_label ? String(body.badge_label).trim().slice(0, 40) || null : null,
    discount_percent: discount,
    price_from:
      body.price_from === null || body.price_from === undefined || body.price_from === ''
        ? null
        : Number(body.price_from),
    price_to:
      body.price_to === null || body.price_to === undefined || body.price_to === ''
        ? null
        : Number(body.price_to),
    currency: String(body.currency || 'EUR').trim().slice(0, 8) || 'EUR',
    service_name: body.service_name ? String(body.service_name).trim().slice(0, 120) || null : null,
    starts_at: startsAt,
    ends_at: endsAt,
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
  };
}

export async function createShopPromotion(shopId, body) {
  const shop = await queryOne(`SELECT id, name FROM shops WHERE id = $1`, [shopId]);
  if (!shop) throw notFound('Shop not found');
  const payload = normalizePayload(body);

  const row = await queryOne(
    `INSERT INTO shop_promotions (
       shop_id, title, description, badge_label, discount_percent,
       price_from, price_to, currency, service_name,
       starts_at, ends_at, is_active, sort_order
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12, $13
     ) RETURNING *`,
    [
      shopId,
      payload.title,
      payload.description,
      payload.badge_label,
      payload.discount_percent,
      payload.price_from,
      payload.price_to,
      payload.currency,
      payload.service_name,
      payload.starts_at,
      payload.ends_at,
      payload.is_active,
      payload.sort_order,
    ],
  );
  return serializePromotion({ ...row, shop_name: shop.name });
}

export async function updateShopPromotion(promotionId, body) {
  const existing = await queryOne(`SELECT * FROM shop_promotions WHERE id = $1`, [promotionId]);
  if (!existing) throw notFound('Oferta no encontrada');

  const merged = {
    title: body.title ?? existing.title,
    description: body.description !== undefined ? body.description : existing.description,
    badge_label: body.badge_label !== undefined ? body.badge_label : existing.badge_label,
    discount_percent:
      body.discount_percent !== undefined ? body.discount_percent : existing.discount_percent,
    price_from: body.price_from !== undefined ? body.price_from : existing.price_from,
    price_to: body.price_to !== undefined ? body.price_to : existing.price_to,
    currency: body.currency ?? existing.currency,
    service_name: body.service_name !== undefined ? body.service_name : existing.service_name,
    starts_at: body.starts_at !== undefined ? body.starts_at : existing.starts_at,
    ends_at: body.ends_at !== undefined ? body.ends_at : existing.ends_at,
    is_active: body.is_active !== undefined ? body.is_active : existing.is_active,
    sort_order: body.sort_order !== undefined ? body.sort_order : existing.sort_order,
  };
  const payload = normalizePayload(merged);

  const row = await queryOne(
    `UPDATE shop_promotions SET
       title = $2,
       description = $3,
       badge_label = $4,
       discount_percent = $5,
       price_from = $6,
       price_to = $7,
       currency = $8,
       service_name = $9,
       starts_at = $10,
       ends_at = $11,
       is_active = $12,
       sort_order = $13
     WHERE id = $1
     RETURNING *`,
    [
      promotionId,
      payload.title,
      payload.description,
      payload.badge_label,
      payload.discount_percent,
      payload.price_from,
      payload.price_to,
      payload.currency,
      payload.service_name,
      payload.starts_at,
      payload.ends_at,
      payload.is_active,
      payload.sort_order,
    ],
  );
  return getShopPromotion(row.id);
}

export async function deleteShopPromotion(promotionId) {
  const { rowCount } = await query(`DELETE FROM shop_promotions WHERE id = $1`, [promotionId]);
  if (!rowCount) throw notFound('Oferta no encontrada');
  return { ok: true };
}

/**
 * Publica o retira un taller del escaparate B2C escribiendo
 * `shops.settings.marketplace.is_listed`. El trigger del marketplace
 * propaga el cambio a `marketplace_shop_listings`.
 */
export async function setShopMarketplaceListing(shopId, { isListed }) {
  const shop = await queryOne(`SELECT id, name, status, settings FROM shops WHERE id = $1`, [shopId]);
  if (!shop) throw notFound('Shop not found');

  const listed = Boolean(isListed);
  const row = await queryOne(
    `UPDATE shops
        SET settings = jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              '{marketplace}',
              COALESCE(settings -> 'marketplace', '{}'::jsonb) || jsonb_build_object('is_listed', $2::boolean),
              true
            )
      WHERE id = $1
      RETURNING id, name, status, settings`,
    [shopId, listed],
  );

  let listing = null;
  try {
    listing = await queryOne(
      `SELECT shop_id, is_listed, shop_status
         FROM marketplace_shop_listings
        WHERE shop_id = $1`,
      [shopId],
    );
  } catch {
    // El SQL del marketplace puede no estar instalado todavía.
    listing = null;
  }

  return {
    shop: {
      id: row.id,
      name: row.name,
      status: row.status,
      marketplace_listed: listing ? Boolean(listing.is_listed) : listed,
      marketplace_shop_status: listing?.shop_status ?? row.status,
    },
  };
}
