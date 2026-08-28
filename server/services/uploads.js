/**
 * Shared image storage for shop-generated photos (vehicles, inventory items).
 *
 * Same strategy as shop covers: Supabase Storage when a service role is
 * available, otherwise `public/uploads/<folder>/` served by Express. Callers
 * get back a URL and never need to know which one answered.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import { badRequest } from '../lib/errors.js';
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabase.js';

/**
 * 4 MiB of image. Base64 inflates that by a third, which still fits inside the
 * 6 MB JSON body limit the app sets in `server/app.js`.
 */
const MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

const uploadsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/uploads');

/** Accepts `data_url` or `image_base64` + `content_type`. */
export function decodeImagePayload({ image_base64: imageBase64, content_type: contentTypeInput, data_url: dataUrl } = {}) {
  let contentType = contentTypeInput ? String(contentTypeInput).trim().toLowerCase() : '';
  let base64 = imageBase64 ? String(imageBase64).replace(/\s+/g, '') : '';

  if (dataUrl) {
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw badRequest('Imagen inválida: se espera un data URL base64');
    contentType = contentType || match[1].trim().toLowerCase();
    base64 = match[2].replace(/\s+/g, '');
  }

  if (!base64) throw badRequest('Falta la imagen (data_url o image_base64)');
  if (!ALLOWED_TYPES.has(contentType)) throw badRequest('Formato no soportado. Usa JPEG, PNG, WebP o GIF');

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw badRequest('La imagen está vacía');
  if (buffer.length > MAX_BYTES) throw badRequest('La imagen supera el máximo de 4 MB');

  return { buffer, base64, contentType, ext: ALLOWED_TYPES.get(contentType) };
}

/** Data URL rebuilt from a decoded payload, for vision requests. */
export const toDataUrl = (image) => `data:${image.contentType};base64,${image.base64}`;

async function uploadToSupabase(bucket, objectPath, { buffer, contentType }) {
  const admin = getSupabaseAdmin();
  const { data: buckets, error: listError } = await admin.storage.listBuckets();
  if (listError) throw new Error(`No se pudieron listar buckets: ${listError.message}`);
  if (!(buckets || []).some((item) => item.name === bucket)) {
    const { error } = await admin.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: [...ALLOWED_TYPES.keys()],
    });
    if (error && !/already exists|duplicate/i.test(error.message || '')) {
      throw new Error(`No se pudo crear el bucket ${bucket}: ${error.message}`);
    }
  }

  const { error: uploadError } = await admin.storage.from(bucket).upload(objectPath, buffer, {
    contentType,
    upsert: true,
    cacheControl: '3600',
  });
  if (uploadError) throw new Error(`Subida a Supabase Storage falló: ${uploadError.message}`);

  const { data } = admin.storage.from(bucket).getPublicUrl(objectPath);
  if (!data?.publicUrl) throw new Error('No se pudo obtener la URL pública de la imagen');
  return data.publicUrl;
}

async function uploadLocally(folder, objectPath, { buffer }) {
  const target = path.join(uploadsRoot, folder, objectPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  const base = (config.appUrl || '').replace(/\/$/, '');
  return `${base}/uploads/${folder}/${objectPath}`;
}

/**
 * Stores an image and returns `{ url, storage }`.
 * `folder` doubles as the Supabase bucket name.
 */
export async function storeImage({ folder, shopId, name = null, image }) {
  const filename = `${name || crypto.randomUUID()}.${image.ext}`;
  const objectPath = `${shopId}/${filename}`;

  if (isSupabaseConfigured() && config.supabase.adminConfigured) {
    try {
      const url = await uploadToSupabase(folder, objectPath, image);
      return { url, storage: 'supabase' };
    } catch (error) {
      console.warn(`[uploads] Supabase falló (${error.message}) — usando disco local`);
      const url = await uploadLocally(folder, objectPath, image);
      return { url, storage: 'local_fallback' };
    }
  }

  const url = await uploadLocally(folder, objectPath, image);
  return { url, storage: 'local' };
}
