/**
 * Configuración de la PWA de clientes.
 *
 * Las credenciales de Supabase se resuelven en este orden:
 *   1. `window.__DERTE_MARKETPLACE_CONFIG__` (inyección en caliente del hosting).
 *   2. Variables de compilación (`VITE_/NEXT_PUBLIC_/SUPABASE_*` de los .env
 *      compartidos con derteapp, ver `vite.config.ts`).
 *   3. `GET {apiBaseUrl}/api/public/supabase`, el endpoint que ya expone el
 *      backend B2B con la URL y la clave anon.
 *
 * Si no hay credenciales por ninguna vía, la app arranca en modo demo con un
 * catálogo local para poder navegar y desarrollar sin backend.
 */

export type DataMode = 'auto' | 'supabase' | 'demo';

export interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

const env = typeof __MARKETPLACE_ENV__ === 'undefined' ? undefined : __MARKETPLACE_ENV__;

function normalizeMode(value: string | undefined): DataMode {
  return value === 'supabase' || value === 'demo' ? value : 'auto';
}

export const appConfig = {
  appName: env?.appName || 'DerteApp Talleres',
  defaultCity: env?.defaultCity || 'Madrid',
  urgentPhone: env?.urgentPhone || '',
  apiBaseUrl: (env?.apiBaseUrl || '').replace(/\/+$/, ''),
  dataMode: normalizeMode(env?.mode),
  buildCredentials:
    env?.supabaseUrl && env?.supabaseAnonKey
      ? { url: env.supabaseUrl, anonKey: env.supabaseAnonKey }
      : null,
} as const;

function readInjectedCredentials(): SupabaseCredentials | null {
  if (typeof window === 'undefined') return null;
  const injected = window.__DERTE_MARKETPLACE_CONFIG__;
  if (injected?.supabaseUrl && injected?.supabaseAnonKey) {
    return { url: injected.supabaseUrl, anonKey: injected.supabaseAnonKey };
  }
  return null;
}

async function fetchCredentialsFromDerteapp(): Promise<SupabaseCredentials | null> {
  if (typeof fetch !== 'function') return null;
  const endpoint = `${appConfig.apiBaseUrl}/api/public/supabase`;
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      credentials: appConfig.apiBaseUrl ? 'omit' : 'same-origin',
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    const url = (payload.url ?? payload.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
    const anonKey = (payload.anonKey ?? payload.NEXT_PUBLIC_SUPABASE_ANON_KEY) as
      | string
      | undefined;
    if (payload.configured === false || !url || !anonKey) return null;
    return { url, anonKey };
  } catch {
    return null;
  }
}

/** Devuelve las credenciales de Supabase o `null` si no hay ninguna vía. */
export async function resolveSupabaseCredentials(): Promise<SupabaseCredentials | null> {
  if (appConfig.dataMode === 'demo') return null;
  return (
    readInjectedCredentials() ??
    appConfig.buildCredentials ??
    (await fetchCredentialsFromDerteapp())
  );
}
