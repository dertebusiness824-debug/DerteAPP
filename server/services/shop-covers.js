/**
 * Portadas de talleres para el escaparate B2C.
 *
 * Preferencia: Supabase Storage (bucket `shop-covers`, lectura pública).
 * Fallback local: `public/uploads/shop-covers/` servido por Express cuando
 * no hay service role (Cloud Agent / desarrollo sin Supabase).
 *
 * La URL se guarda en `shops.settings.marketplace.cover_image_url` y el
 * trigger del marketplace la copia a `marketplace_shop_listings`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import { query, queryAll, queryOne, transaction } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabase.js';

const BUCKET = 'shop-covers';
const MAX_BYTES = 4.5 * 1024 * 1024; // ~4.5 MiB
const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

const uploadsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/uploads/shop-covers',
);

function marketplaceCoverUrl(settings) {
  const url = settings?.marketplace?.cover_image_url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw badRequest('Imagen inválida: se espera un data URL base64');
  return { contentType: match[1].trim().toLowerCase(), base64: match[2] };
}

function decodeImagePayload({ image_base64, content_type, data_url } = {}) {
  let contentType = content_type ? String(content_type).trim().toLowerCase() : '';
  let base64 = image_base64 ? String(image_base64).replace(/\s+/g, '') : '';

  if (data_url) {
    const parsed = parseDataUrl(data_url);
    contentType = contentType || parsed.contentType;
    base64 = parsed.base64;
  }

  if (!base64) throw badRequest('Falta la imagen (image_base64 o data_url)');
  if (!ALLOWED_TYPES.has(contentType)) {
    throw badRequest('Formato no soportado. Usa JPEG, PNG, WebP o GIF');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw badRequest('La imagen está vacía');
  if (buffer.length > MAX_BYTES) {
    throw badRequest('La imagen supera el máximo de 4,5 MB');
  }

  return { buffer, contentType, ext: ALLOWED_TYPES.get(contentType) };
}

async function ensureLocalDir() {
  await fs.mkdir(uploadsDir, { recursive: true });
}

async function ensureStorageBucket(admin) {
  const { data: buckets, error: listError } = await admin.storage.listBuckets();
  if (listError) throw new Error(`No se pudieron listar buckets: ${listError.message}`);
  const exists = (buckets || []).some((bucket) => bucket.name === BUCKET);
  if (exists) return;

  const { error: createError } = await admin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: [...ALLOWED_TYPES.keys()],
  });
  if (createError && !/already exists|duplicate/i.test(createError.message || '')) {
    throw new Error(`No se pudo crear el bucket ${BUCKET}: ${createError.message}`);
  }
}

async function uploadToSupabase(shopId, { buffer, contentType, ext }) {
  const admin = getSupabaseAdmin();
  await ensureStorageBucket(admin);
  const objectPath = `${shopId}/cover.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType,
    upsert: true,
    cacheControl: '3600',
  });
  if (error) throw new Error(`Subida a Supabase Storage falló: ${error.message}`);

  const { data } = admin.storage.from(BUCKET).getPublicUrl(objectPath);
  if (!data?.publicUrl) throw new Error('No se pudo obtener la URL pública de la portada');
  // Cache-bust so the admin preview refreshes after replace.
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function uploadLocally(shopId, { buffer, ext }) {
  await ensureLocalDir();
  // Remove previous extensions for this shop.
  const existing = await fs.readdir(uploadsDir).catch(() => []);
  await Promise.all(
    existing
      .filter((name) => name.startsWith(`${shopId}.`) || name.startsWith(`${shopId}-`))
      .map((name) => fs.unlink(path.join(uploadsDir, name)).catch(() => {})),
  );
  const filename = `${shopId}.${ext}`;
  await fs.writeFile(path.join(uploadsDir, filename), buffer);
  const base = (config.appUrl || '').replace(/\/$/, '') || '';
  return `${base}/uploads/shop-covers/${filename}?v=${Date.now()}`;
}

async function persistCoverUrl(shopId, coverUrl) {
  const row = await queryOne(
    `UPDATE shops
        SET settings = jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              '{marketplace}',
              COALESCE(settings -> 'marketplace', '{}'::jsonb)
                || jsonb_build_object('cover_image_url', to_jsonb($2::text)),
              true
            )
      WHERE id = $1
      RETURNING id, name, status, settings`,
    [shopId, coverUrl],
  );
  if (!row) throw notFound('Shop not found');

  // Refuerzo por si el trigger del marketplace aún no está instalado.
  try {
    await query(
      `UPDATE marketplace_shop_listings
          SET cover_image_url = $2, updated_at = now()
        WHERE shop_id = $1`,
      [shopId, coverUrl],
    );
  } catch {
    // Tabla ausente: ok.
  }

  return row;
}

export async function setShopCoverImage(shopId, payload) {
  const shop = await queryOne(`SELECT id, name, status, settings FROM shops WHERE id = $1`, [shopId]);
  if (!shop) throw notFound('Shop not found');

  const image = decodeImagePayload(payload);
  let coverUrl;
  let storage = 'local';

  if (isSupabaseConfigured() && config.supabase.adminConfigured) {
    try {
      coverUrl = await uploadToSupabase(shopId, image);
      storage = 'supabase';
    } catch (error) {
      console.warn(`[shop-covers] Supabase falló (${error.message}) — usando disco local`);
      coverUrl = await uploadLocally(shopId, image);
      storage = 'local_fallback';
    }
  } else {
    coverUrl = await uploadLocally(shopId, image);
  }

  const row = await persistCoverUrl(shopId, coverUrl);
  return {
    shop: {
      id: row.id,
      name: row.name,
      status: row.status,
      cover_image_url: coverUrl,
      marketplace_listed: Boolean(row.settings?.marketplace?.is_listed),
    },
    storage,
  };
}

export async function clearShopCoverImage(shopId) {
  const shop = await queryOne(`SELECT id, name, status, settings FROM shops WHERE id = $1`, [shopId]);
  if (!shop) throw notFound('Shop not found');

  const previous = marketplaceCoverUrl(shop.settings);

  const row = await queryOne(
    `UPDATE shops
        SET settings = jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              '{marketplace}',
              (COALESCE(settings -> 'marketplace', '{}'::jsonb) - 'cover_image_url'),
              true
            )
      WHERE id = $1
      RETURNING id, name, status, settings`,
    [shopId],
  );

  try {
    await query(
      `UPDATE marketplace_shop_listings
          SET cover_image_url = NULL, updated_at = now()
        WHERE shop_id = $1`,
      [shopId],
    );
  } catch {
    // ignore
  }

  // Best-effort cleanup of local file / storage object.
  try {
    await ensureLocalDir();
    const existing = await fs.readdir(uploadsDir);
    await Promise.all(
      existing
        .filter((name) => name.startsWith(`${shopId}.`))
        .map((name) => fs.unlink(path.join(uploadsDir, name)).catch(() => {})),
    );
  } catch {
    // ignore
  }

  if (previous && isSupabaseConfigured() && config.supabase.adminConfigured) {
    try {
      const admin = getSupabaseAdmin();
      await admin.storage.from(BUCKET).remove([`${shopId}/cover.jpg`, `${shopId}/cover.png`, `${shopId}/cover.webp`, `${shopId}/cover.gif`]);
    } catch {
      // ignore
    }
  }

  return {
    shop: {
      id: row.id,
      name: row.name,
      status: row.status,
      cover_image_url: null,
      marketplace_listed: Boolean(row.settings?.marketplace?.is_listed),
    },
  };
}

/**
 * Elimina por completo todos los talleres excepto `keepShopId`.
 * Cascada: citas, miembros, ofertas, listings del marketplace, etc.
 */
export async function purgeShopsExcept(keepShopId, { confirm } = {}) {
  if (String(confirm || '').trim().toUpperCase() !== 'ELIMINAR') {
    throw badRequest('Confirma escribiendo ELIMINAR para vaciar el directorio de talleres');
  }
  if (!keepShopId) throw badRequest('Indica keep_shop_id (el taller activo que se conserva)');

  const keep = await queryOne(`SELECT id, name, status FROM shops WHERE id = $1`, [keepShopId]);
  if (!keep) throw notFound('El taller a conservar no existe');

  const victims = await queryAll(
    `SELECT id, name, status FROM shops WHERE id <> $1 ORDER BY name`,
    [keepShopId],
  );

  const deleted = await transaction(async (client) => {
    // Asegura que el conservado quede usable.
    await client.query(
      `UPDATE shops SET status = 'active' WHERE id = $1 AND status <> 'active'`,
      [keepShopId],
    );

    const { rows } = await client.query(
      `DELETE FROM shops WHERE id <> $1 RETURNING id, name`,
      [keepShopId],
    );

    // Listings del marketplace: ON DELETE CASCADE cuando el SQL está instalado.
    // No tocamos esa tabla aquí — un DELETE fallido abortaría toda la transacción.
    return rows;
  });

  return {
    kept: { id: keep.id, name: keep.name, status: 'active' },
    deleted_count: deleted.length,
    deleted: deleted.map((row) => ({ id: row.id, name: row.name })),
    previewed_victims: victims.length,
  };
}

export function coverUrlFromSettings(settings) {
  return marketplaceCoverUrl(settings);
}
