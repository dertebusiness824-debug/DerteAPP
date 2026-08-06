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

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const embedDir = path.join(rootDir, 'embed');

export function createApp() {
  const app = express();

  // Hosting platforms (Hostinger VPS, Render, Fly, …) terminate TLS upstream.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          // Same-origin XHR/SSE plus tel:/whatsapp: hand-offs.
          'connect-src': ["'self'"],
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
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
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

  // Customer chat link: a standalone page, deliberately outside the app shell so
  // it stays tiny and works for people who have never seen DerteApp.
  app.get('/c/:token', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'chat.html'));
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
