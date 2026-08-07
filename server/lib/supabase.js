/**
 * Server-side Supabase clients for DerteApp.
 *
 * - `getSupabaseAdmin()` → service role (bypasses RLS). Server routes only.
 * - `getSupabaseAnon()`  → publishable/anon key for server code that must
 *   respect RLS (prefer this unless elevated privileges are required).
 *
 * Never import this module from browser code and never expose the service role.
 */
import { createClient } from '@supabase/supabase-js';
import config from '../config.js';

let adminClient = null;
let anonClient = null;

function requirePublicConfig() {
  const { url, anonKey } = config.supabase;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase no está configurado (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    );
  }
  return { url, anonKey };
}

/** Admin client with SUPABASE_SERVICE_ROLE_KEY — elevated privileges. */
export function getSupabaseAdmin() {
  if (adminClient) return adminClient;
  const { url } = requirePublicConfig();
  const serviceRoleKey = config.supabase.serviceRoleKey;
  if (!serviceRoleKey) {
    throw new Error('Supabase service role no configurada (SUPABASE_SERVICE_ROLE_KEY)');
  }
  adminClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return adminClient;
}

/** Anon/publishable client for server-side RLS-aware access. */
export function getSupabaseAnon() {
  if (anonClient) return anonClient;
  const { url, anonKey } = requirePublicConfig();
  anonClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return anonClient;
}

/** Public shape safe to send to the browser (never includes the service role). */
export function getSupabasePublicConfig() {
  const { url, anonKey, configured } = config.supabase;
  return {
    configured,
    url: configured ? url : null,
    anonKey: configured ? anonKey : null,
    // Aliases matching the env names the frontend may look for.
    NEXT_PUBLIC_SUPABASE_URL: configured ? url : null,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: configured ? anonKey : null,
  };
}

export function isSupabaseConfigured() {
  return config.supabase.configured;
}
