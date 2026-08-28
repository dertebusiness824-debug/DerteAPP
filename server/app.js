import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import config from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { requestContext } from './middleware/context.js';
import apiRouter from './routes/index.js';
import { mountRetellWebhookFirst } from './routes/webhooks.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const embedDir = path.join(rootDir, 'embed');

function supabaseConnectSources() {
  const sources = ["'self'", 'https://cdn.jsdelivr.net'];
  if (config.supabase.url) {
    try {
      const host = new URL(config.supabase.url).origin;
      sources.push(host, host.replace('https://', 'wss://'));
    } catch {
      // Ignore malformed URL — env validation surfaces elsewhere.
    }
  }
  // Realtime / storage hosts on the Supabase project domain.
  sources.push('https://*.supabase.co', 'wss://*.supabase.co');
  return sources;
}

export function createApp() {
  const app = express();

  // Hosting platforms (Hostinger VPS, Render, Fly, …) terminate TLS upstream.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ── Retell FIRST ──────────────────────────────────────────────────────────
  // Must be registered before helmet, compression, global body parsers, cookies,
  // requestContext, and /api routers — so no middleware can return 400
  // "Queue is full." or otherwise block Retell's delivery queue.
  // Handler: res.status(200).json({ received: true }) then async ingest.
  mountRetellWebhookFirst(app);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          // App scripts are same-origin; Supabase browser SDK is loaded from jsDelivr ESM.
          'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
          // Inline *style attributes* are required: chart bars and the growing
          // message composer size themselves at runtime. Scripts remain locked
          // down, which is where the real risk lives.
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          // Portadas de talleres pueden vivir en Supabase Storage o en /uploads.
          'img-src': ["'self'", 'data:', 'blob:', 'https://*.supabase.co', 'https://*.supabase.in'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          // Same-origin XHR/SSE, Supabase API/Realtime, and the SDK CDN.
          'connect-src': supabaseConnectSources(),
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'manifest-src': ["'self'"],
        },
      },
      // The service worker and manifest are same-origin; COEP would break the
      // tel:/wa.me hand-offs the dashboard relies on.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());

  // 6mb permite subir portadas de taller en base64 desde el panel Super Admin.
  app.use(express.json({ limit: '6mb' }));
  app.use(express.urlencoded({ extended: false, limit: '6mb' }));
  app.use(cookieParser());
  app.use(requestContext);

  // The Hostinger snippet is loaded from customer domains.
  app.use(
    '/embed',
    (_req, res, next) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'public, max-age=300');
      next();
    },
    express.static(embedDir, { extensions: ['js'] }),
  );

  app.use('/api', apiRouter);

  app.use(
    express.static(publicDir, {
      index: false,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        // The service worker must never be served from a stale cache, or
        // installed clients can get stuck on an old build.
        if (name === 'sw.js' || name === 'manifest.webmanifest') {
          res.set('Cache-Control', 'no-cache');
        } else if (/\.(png|svg|ico|woff2?)$/.test(name)) {
          res.set('Cache-Control', 'public, max-age=604800');
        } else {
          res.set('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  // Cal.com / Web Push payload uses /icon.png; the PNG lives under /icons/.
  app.get('/icon.png', (_req, res) => {
    res.redirect(302, '/icons/icon-192.png');
  });

  // Legacy customer chat links — messaging is Super Admin ↔ shop owner only.
  app.get('/c/:token', (_req, res) => {
    res.status(410).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chat closed · DerteApp</title>
<link rel="stylesheet" href="/css/app.css"></head>
<body><div class="public"><div class="empty">
<img src="/icons/icon-192.png" alt="" width="56" height="56">
<div class="empty__title">This chat is no longer available</div>
<div>Please call the workshop directly to talk about your booking.</div>
</div></div></body></html>`);
  });

  // Everything else falls through to the PWA shell for client-side routing.
  app.get(/^\/(?!api|embed).*/, (req, res, next) => {
    if (req.method !== 'GET' || req.accepts('html') !== 'html') return next();
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
