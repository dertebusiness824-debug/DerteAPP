/**
 * Browser Supabase client (anon / publishable key only).
 *
 * Fetches public config from the API so secrets stay out of the static bundle.
 * The service role key is never available here.
 *
 * Usage:
 *   import { getSupabase } from './supabase.js';
 *   const supabase = await getSupabase();
 *   const { data, error } = await supabase.from('shops').select('id, name');
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let clientPromise = null;

async function loadPublicConfig() {
  const response = await fetch('/api/public/supabase', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`No se pudo cargar la configuración de Supabase (${response.status})`);
  }
  const payload = await response.json();
  const url = payload.url || payload.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = payload.anonKey || payload.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!payload.configured || !url || !anonKey) {
    throw new Error('Supabase no está configurado en el servidor');
  }
  return { url, anonKey };
}

/** Returns a singleton Supabase browser client (anon key). */
export function getSupabase() {
  if (!clientPromise) {
    clientPromise = loadPublicConfig().then(({ url, anonKey }) =>
      createClient(url, anonKey, {
        auth: {
          // Do not persist a shared sb-*-auth-token that can leak across
          // Super Admin and taller logins in the same browser.
          // Plate / AI calls go through Express + the httpOnly cookie, never
          // supabase.auth, so they cannot sign this client out.
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: 'derte-sb-anon',
        },
      }),
    );
  }
  return clientPromise;
}

/** True when the public Supabase endpoint reports credentials. */
export async function isSupabaseReady() {
  try {
    const response = await fetch('/api/public/supabase', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return Boolean(payload.configured);
  } catch {
    return false;
  }
}
