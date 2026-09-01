/**
 * Inventory of spare parts and consumables, one shelf per shop.
 *
 * Every quantity change is written to `inventory_movements` and bumps
 * `shop_inventory_state.last_change_at`. That log is what makes the reminders
 * factual: "this month you have not updated your inventory" is a query, not a
 * guess.
 */
import { query, queryAll, queryOne, transaction } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  CATEGORY_KEYS,
  INVENTORY_CATEGORIES,
  categoryLabel,
  presetItems,
} from '../lib/inventory-catalog.js';
import { aiConfigured, aiJson } from './ai.js';

export { INVENTORY_CATEGORIES, CATEGORY_KEYS } from '../lib/inventory-catalog.js';

/** Whether photo recognition can run, so the UI can hide the camera path. */
export const visionAvailable = () => aiConfigured();

const num = (value) => (value === null || value === undefined ? null : Number(value));

export function serializeItem(row) {
  const quantity = Number(row.quantity);
  const minQuantity = Number(row.min_quantity);
  return {
    id: row.id,
    shop_id: row.shop_id,
    name: row.name,
    category: row.category,
    category_label: categoryLabel(row.category),
    brand: row.brand ?? null,
    spec: row.spec ?? null,
    quantity,
    unit: row.unit,
    min_quantity: minQuantity,
    low_stock: quantity <= minQuantity,
    out_of_stock: quantity <= 0,
    price: num(row.price),
    photo_url: row.photo_url ?? null,
    notes: row.notes ?? null,
    preloaded: row.preloaded,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PAGE_MAX = 200;
const PAGE_DEFAULT = 50;

export async function listItems({
  shopId,
  search = null,
  category = null,
  lowStockOnly = false,
  limit = PAGE_DEFAULT,
  offset = 0,
} = {}) {
  const capped = Math.min(Math.max(Number(limit) || PAGE_DEFAULT, 1), PAGE_MAX);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = await queryAll(
    `SELECT *, count(*) OVER()::int AS total_count
       FROM inventory_items
      WHERE shop_id = $1
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR spec ILIKE '%' || $2 || '%'
             OR brand ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR category = $3)
        AND ($4::bool IS NOT TRUE OR quantity <= min_quantity)
      ORDER BY category, name, spec NULLS FIRST
      LIMIT $5 OFFSET $6`,
    [shopId, search || null, category || null, lowStockOnly, capped, off],
  );
  const total = Number(rows[0]?.total_count ?? 0);
  return {
    items: rows,
    total,
    limit: capped,
    offset: off,
    has_more: off + rows.length < total,
  };
}

export const getItem = (shopId, itemId) =>
  queryOne(`SELECT * FROM inventory_items WHERE id = $1 AND shop_id = $2`, [itemId, shopId]);

/** Reads the reminder state, creating the default row on first access. */
export async function ensureState(shopId) {
  const existing = await queryOne(`SELECT * FROM shop_inventory_state WHERE shop_id = $1`, [shopId]);
  if (existing) return existing;
  return queryOne(
    `INSERT INTO shop_inventory_state (shop_id) VALUES ($1)
     ON CONFLICT (shop_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [shopId],
  );
}

export async function setRemindersEnabled(shopId, enabled) {
  await ensureState(shopId);
  return queryOne(
    `UPDATE shop_inventory_state SET reminders_enabled = $2 WHERE shop_id = $1 RETURNING *`,
    [shopId, Boolean(enabled)],
  );
}

async function recordMovement(client, { shopId, item, kind, source, delta, actorUserId }) {
  await client.query(
    `INSERT INTO inventory_movements
       (shop_id, item_id, item_name, kind, source, delta, quantity_after, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      shopId,
      kind === 'delete' ? null : item.id,
      [item.name, item.spec].filter(Boolean).join(' · '),
      kind,
      source,
      delta,
      kind === 'delete' ? null : Number(item.quantity),
      actorUserId,
    ],
  );
  await client.query(
    `INSERT INTO shop_inventory_state (shop_id, last_change_at)
     VALUES ($1, now())
     ON CONFLICT (shop_id) DO UPDATE SET last_change_at = now(), updated_at = now()`,
    [shopId],
  );
}

export function createItem({ shopId, input, userId = null, source = 'manual' }) {
  const category = CATEGORY_KEYS.includes(input.category) ? input.category : 'other';

  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO inventory_items
         (shop_id, name, category, brand, spec, quantity, unit, min_quantity, price, photo_url, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (shop_id, lower(btrim(name)), lower(coalesce(btrim(spec), ''))) DO UPDATE
          SET quantity = inventory_items.quantity + EXCLUDED.quantity,
              brand = COALESCE(EXCLUDED.brand, inventory_items.brand),
              unit = EXCLUDED.unit,
              min_quantity = GREATEST(EXCLUDED.min_quantity, inventory_items.min_quantity),
              price = COALESCE(EXCLUDED.price, inventory_items.price),
              photo_url = COALESCE(EXCLUDED.photo_url, inventory_items.photo_url),
              notes = COALESCE(EXCLUDED.notes, inventory_items.notes),
              preloaded = false
       -- xmax stays 0 on a real insert, so this tells apart "new" from "merged".
       RETURNING *, (xmax = 0) AS inserted`,
      [
        shopId,
        String(input.name).trim(),
        category,
        input.brand ?? null,
        input.spec ?? null,
        input.quantity ?? 0,
        input.unit ?? 'ud',
        input.min_quantity ?? 0,
        input.price ?? null,
        input.photo_url ?? null,
        input.notes ?? null,
        userId,
      ],
    );
    const item = rows[0];
    await recordMovement(client, {
      shopId,
      item,
      kind: item.inserted ? 'create' : 'add',
      source,
      delta: Number(input.quantity ?? 0),
      actorUserId: userId,
    });
    return item;
  });
}

export async function updateItem({ shopId, itemId, patch, userId = null, source = 'manual' }) {
  const current = await getItem(shopId, itemId);
  if (!current) throw notFound('Artículo no encontrado');

  const fields = ['name', 'category', 'brand', 'spec', 'unit', 'min_quantity', 'price', 'photo_url', 'notes'];
  const updates = [];
  const values = [itemId, shopId];

  for (const field of fields) {
    if (patch[field] === undefined) continue;
    if (field === 'category' && !CATEGORY_KEYS.includes(patch.category)) continue;
    values.push(patch[field]);
    updates.push(`${field} = $${values.length}`);
  }

  const nextQuantity = patch.quantity === undefined ? null : Number(patch.quantity);
  if (nextQuantity !== null) {
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) throw badRequest('La cantidad no puede ser negativa');
    values.push(nextQuantity);
    updates.push(`quantity = $${values.length}`);
  }

  if (!updates.length) return current;

  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE inventory_items SET ${updates.join(', ')}, preloaded = false
        WHERE id = $1 AND shop_id = $2 RETURNING *`,
      values,
    );
    const item = rows[0];
    const delta = nextQuantity === null ? 0 : nextQuantity - Number(current.quantity);
    await recordMovement(client, {
      shopId,
      item,
      kind: delta > 0 ? 'add' : delta < 0 ? 'remove' : 'adjust',
      source,
      delta,
      actorUserId: userId,
    });
    return item;
  });
}

/** Relative change, which is what the +/− buttons on the list send. */
export async function adjustQuantity({ shopId, itemId, delta, userId = null, source = 'manual' }) {
  const current = await getItem(shopId, itemId);
  if (!current) throw notFound('Artículo no encontrado');
  const next = Math.max(0, Number(current.quantity) + Number(delta));
  return updateItem({ shopId, itemId, patch: { quantity: next }, userId, source });
}

export async function deleteItem({ shopId, itemId, userId = null }) {
  const current = await getItem(shopId, itemId);
  if (!current) throw notFound('Artículo no encontrado');

  return transaction(async (client) => {
    await recordMovement(client, {
      shopId,
      item: current,
      kind: 'delete',
      source: 'manual',
      delta: -Number(current.quantity),
      actorUserId: userId,
    });
    await client.query(`DELETE FROM inventory_items WHERE id = $1 AND shop_id = $2`, [itemId, shopId]);
    return { deleted: true, name: current.name };
  });
}

export const listMovements = ({ shopId, limit = 30 }) =>
  queryAll(
    `SELECT m.id, m.item_id, m.item_name, m.kind, m.source, m.delta, m.quantity_after, m.created_at,
            u.full_name AS actor_name
       FROM inventory_movements m
       LEFT JOIN users u ON u.id = m.actor_user_id
      WHERE m.shop_id = $1
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2`,
    [shopId, limit],
  );

export async function inventorySummary(shopId) {
  const [totals, byCategory, lastMovement] = await Promise.all([
    queryOne(
      `SELECT count(*)::int AS items,
              coalesce(sum(quantity), 0)::float AS units,
              count(*) FILTER (WHERE quantity <= min_quantity)::int AS low_stock,
              count(*) FILTER (WHERE quantity <= 0)::int AS out_of_stock
         FROM inventory_items WHERE shop_id = $1`,
      [shopId],
    ),
    queryAll(
      `SELECT category, count(*)::int AS items, coalesce(sum(quantity), 0)::float AS units
         FROM inventory_items WHERE shop_id = $1
        GROUP BY category ORDER BY category`,
      [shopId],
    ),
    queryOne(
      `SELECT created_at FROM inventory_movements WHERE shop_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [shopId],
    ),
  ]);

  const changesThisMonth = await queryOne(
    `SELECT count(*)::int AS total FROM inventory_movements
      WHERE shop_id = $1 AND created_at >= date_trunc('month', now())`,
    [shopId],
  );

  return {
    ...totals,
    categories: byCategory.map((row) => ({ ...row, label: categoryLabel(row.category) })),
    last_change_at: lastMovement?.created_at ?? null,
    changes_this_month: changesThisMonth.total,
  };
}

const PHOTO_SYSTEM = [
  'Identificas recambios y consumibles de taller mecánico a partir de una foto.',
  'Responde SOLO con JSON: {"name":"","category":"","spec":"","brand":"","unit":"","confidence":0.0}.',
  `"category" debe ser uno de: ${CATEGORY_KEYS.join(', ')}.`,
  '"spec" es la medida o referencia visible (p. ej. "205/55 R16" en un neumático, "5W-30" en un aceite).',
  'Devuelve null en lo que no se lea con claridad. No inventes marcas.',
].join(' ');

/**
 * Photo → suggested item. The owner always confirms before it is saved, so a
 * low-confidence guess is useful rather than dangerous.
 */
export async function recognizeItemPhoto({ dataUrl }) {
  if (!aiConfigured()) {
    return { recognized: false, reason: 'vision_not_configured', item: null, categories: INVENTORY_CATEGORIES };
  }

  const result = await aiJson({
    system: PHOTO_SYSTEM,
    user: 'Identifica este recambio o consumible de taller.',
    images: [dataUrl],
    maxTokens: 260,
  });
  if (!result.ok) {
    return { recognized: false, reason: result.error, item: null, categories: INVENTORY_CATEGORIES };
  }

  const data = result.data ?? {};
  const name = data.name ? String(data.name).trim() : null;
  if (!name) {
    return { recognized: false, reason: 'no_item_in_photo', item: null, categories: INVENTORY_CATEGORIES };
  }

  const confidence = Number(data.confidence);
  return {
    recognized: true,
    reason: null,
    model_used: result.model,
    categories: INVENTORY_CATEGORIES,
    item: {
      name: name.slice(0, 120),
      category: CATEGORY_KEYS.includes(data.category) ? data.category : 'other',
      spec: data.spec ? String(data.spec).trim().slice(0, 120) : null,
      brand: data.brand ? String(data.brand).trim().slice(0, 80) : null,
      unit: data.unit ? String(data.unit).trim().slice(0, 12) : 'ud',
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    },
  };
}

/**
 * Super Admin bulk load. Idempotent: rows that already exist keep their
 * quantities, so running it twice never doubles a shelf.
 */
export function preloadInventory({ shopId, categories = null, userId = null }) {
  const items = presetItems(categories);
  if (!items.length) throw badRequest('Ninguna categoría seleccionada');

  return transaction(async (client) => {
    let created = 0;
    let skipped = 0;

    for (const item of items) {
      const { rows } = await client.query(
        `INSERT INTO inventory_items
           (shop_id, name, category, spec, quantity, unit, min_quantity, preloaded, created_by)
         VALUES ($1, $2, $3, $4, 0, $5, $6, true, $7)
         ON CONFLICT (shop_id, lower(btrim(name)), lower(coalesce(btrim(spec), ''))) DO NOTHING
         RETURNING id, name, spec, quantity`,
        [shopId, item.name, item.category, item.spec ?? null, item.unit ?? 'ud', item.min_quantity ?? 0, userId],
      );
      if (rows[0]) created += 1;
      else skipped += 1;
    }

    if (created > 0) {
      await client.query(
        `INSERT INTO inventory_movements (shop_id, item_name, kind, source, delta, actor_user_id)
         VALUES ($1, $2, 'preload', 'preload', 0, $3)`,
        [shopId, `Carga inicial · ${created} artículos`, userId],
      );
      await client.query(
        `INSERT INTO shop_inventory_state (shop_id, last_change_at)
         VALUES ($1, now())
         ON CONFLICT (shop_id) DO UPDATE SET last_change_at = now(), updated_at = now()`,
        [shopId],
      );
    }

    return { created, skipped, total: items.length };
  });
}

/** Deletes untouched preloaded rows, so a wrong preset can be undone. */
export async function clearPreloadedItems({ shopId }) {
  const { rowCount } = await query(
    `DELETE FROM inventory_items WHERE shop_id = $1 AND preloaded = true AND quantity = 0`,
    [shopId],
  );
  return { deleted: rowCount };
}
