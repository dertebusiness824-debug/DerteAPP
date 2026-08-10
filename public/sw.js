/**
 * DerteApp service worker.
 *
 * Strategy, chosen so a mechanic on a patchy 4G connection never sees a blank
 * screen but also never sees stale business data:
 *   - app shell (HTML, CSS, JS, icons): cache first, refreshed in the background
 *   - API GETs: network first, with a short-lived cache used only when offline
 *   - anything that changes data (POST/PATCH/PUT/DELETE): network only
 */
const VERSION = 'v29-retell-sync-final';
const SHELL_CACHE = `derte-shell-${VERSION}`;
const DATA_CACHE = `derte-data-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/chat.html',
  '/offline.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/booking-filters.js',
  '/js/booking-lifecycle.js',
  '/js/i18n.js',
  '/js/router.js',
  '/js/shell.js',
  '/js/store.js',
  '/js/ui.js',
  '/js/icons.js',
  '/js/views/admin.js',
  '/js/views/appointments.js',
  '/js/views/auth.js',
  '/js/views/chat.js',
  '/js/views/home.js',
  '/js/views/urgencias.js',
  '/js/views/yearly-history.js',
  '/js/session-errors.js',
  '/js/views/insights.js',
  '/js/views/schedule.js',
  '/js/views/settings.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
  '/icons/logo.svg',
  '/icons/logo-mark.svg',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll fails as a unit, so add individually: one missing file must not
      // stop the whole worker from installing.
      await Promise.all(
        SHELL_ASSETS.map((asset) =>
          cache.add(new Request(asset, { cache: 'reload' })).catch(() => {
            console.warn('[sw] could not precache', asset);
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

const isStaticAsset = (url) =>
  url.pathname.startsWith('/css/') ||
  url.pathname.startsWith('/icons/') ||
  url.pathname === '/manifest.webmanifest';

const isScriptRequest = (url) => url.pathname.startsWith('/js/');

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Refresh in the background so the next launch has the new build.
    void fetch(request)
      .then((response) => {
        if (response.ok) void cache.put(request, response.clone());
      })
      .catch(() => {});
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, { cacheName = DATA_CACHE, fallback = null } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') void cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      // Tell the client this came from the offline cache.
      const headers = new Headers(cached.headers);
      headers.set('X-Derte-Offline', '1');
      return new Response(cached.body, { status: cached.status, headers });
    }
    if (fallback) {
      const shell = await caches.open(SHELL_CACHE);
      const page = await shell.match(fallback);
      if (page) return page;
    }
    if (request.destination === '' && request.headers.get('accept')?.includes('application/json')) {
      return new Response(
        JSON.stringify({ error: { message: 'You are offline. Reconnect to load this.', code: 'offline' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Server-Sent Events must stream straight through.
  if (request.headers.get('accept')?.includes('text/event-stream')) return;

  // JS must be network-first so Cancel / auto-complete UI updates ship immediately.
  if (isScriptRequest(url)) {
    event.respondWith(networkFirst(request, { cacheName: SHELL_CACHE }));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Navigations: serve the matching shell document, falling back offline.
  if (request.mode === 'navigate') {
    const document = url.pathname.startsWith('/c/') ? '/chat.html' : '/index.html';
    event.respondWith(networkFirst(request, { cacheName: SHELL_CACHE, fallback: document }));
  }
});
