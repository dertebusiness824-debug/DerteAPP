import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, '..');

/**
 * Reads the shared derteapp env files (`../.env`, `../.env.local`) plus the
 * app-local ones, so the marketplace can reuse the Supabase credentials the
 * B2B app already has instead of duplicating them.
 *
 * Only the keys picked below reach the browser bundle: the service role key is
 * never read here.
 */
function resolvePublicEnv(mode: string) {
  const shared = loadEnv(mode, repoRoot, '');
  const local = loadEnv(mode, appDir, '');
  const merged = { ...shared, ...local };

  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = merged[name]?.trim();
      if (value) return value;
    }
    return '';
  };

  return {
    supabaseUrl: pick('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'),
    supabaseAnonKey: pick(
      'VITE_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_ANON_KEY',
    ),
    apiBaseUrl: pick('VITE_DERTEAPP_API_URL'),
    mode: pick('VITE_MARKETPLACE_MODE') || 'auto',
    appName: pick('VITE_MARKETPLACE_APP_NAME') || 'DerteApp Talleres',
    defaultCity: pick('VITE_MARKETPLACE_DEFAULT_CITY') || 'Madrid',
    urgentPhone: pick('VITE_MARKETPLACE_URGENT_PHONE'),
    basePath: pick('VITE_MARKETPLACE_BASE_PATH') || '/',
  };
}

export default defineConfig(({ mode }) => {
  const publicEnv = resolvePublicEnv(mode);

  return {
    root: appDir,
    // The service worker scope follows `base`, so the app is served from the
    // root of its own origin unless VITE_MARKETPLACE_BASE_PATH says otherwise.
    base: publicEnv.basePath,
    define: {
      __MARKETPLACE_ENV__: JSON.stringify(publicEnv),
    },
    resolve: {
      alias: { '@': path.resolve(appDir, 'src') },
    },
    server: {
      // 0.0.0.0 + allowedHosts:true permite previsualizar la PWA detrás de
      // un túnel (Cloudflare, ngrok…) sin tocar la máquina del revisor.
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
    },
    preview: {
      host: '0.0.0.0',
      port: 4174,
      allowedHosts: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'DerteApp Talleres — reserva y urgencias',
          short_name: 'DerteApp',
          description:
            'Encuentra talleres cerca de ti, reserva cita al instante y pide asistencia urgente 24h.',
          lang: 'es',
          dir: 'ltr',
          display: 'standalone',
          display_override: ['standalone', 'minimal-ui'],
          orientation: 'portrait',
          background_color: '#ffffff',
          theme_color: '#2563eb',
          categories: ['automotive', 'shopping', 'travel'],
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: 'index.html',
          runtimeCaching: [
            {
              // Supabase REST reads: keep showing the last catalogue offline.
              urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*$/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-rest',
                networkTimeoutSeconds: 6,
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
