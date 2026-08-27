/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Inyectado por `vite.config.ts` a partir de los .env compartidos con derteapp. */
declare const __MARKETPLACE_ENV__: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
  mode: string;
  appName: string;
  defaultCity: string;
  urgentPhone: string;
  basePath: string;
};

interface Window {
  /** Permite inyectar credenciales en caliente desde el hosting (sin recompilar). */
  __DERTE_MARKETPLACE_CONFIG__?: {
    supabaseUrl?: string;
    supabaseAnonKey?: string;
  };
}
