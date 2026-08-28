import config from './config.js';
import { createApp } from './app.js';
import { closePool } from './db/index.js';
import { migrate } from './db/migrate.js';
import { ensureMarketplaceSchema } from './db/ensure-marketplace.js';
import { ensureSuperAdmin } from './db/seed.js';
import { startMaintenance } from './services/maintenance.js';

const app = createApp();

try {
  // Applying pending migrations on boot keeps single-container deployments
  // (Hostinger VPS, Docker, Render) to one step — no `npm run migrate`.
  await migrate({ silent: true });
  // Marketplace B2C SQL (idempotent) — no `psql … marketplace.sql`.
  await ensureMarketplaceSchema({ silent: false });
  // Super Admin bootstrap — no `npm run seed`.
  // In non-production, sync the known default password so local/Cloud Agent
  // logins work without a manual seed. In production, only rotate when
  // SUPER_ADMIN_PASSWORD is set explicitly in the environment.
  await ensureSuperAdmin({
    rotatePassword: config.env !== 'production',
  });
} catch (error) {
  console.error(`[boot] migration/bootstrap failed: ${error.message}`);
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`${config.appName} listening on ${config.appUrl} (env: ${config.env})`);
  if (!config.zadarma.configured) {
    console.log('[boot] Zadarma is not configured — call buttons fall back to tel: and WhatsApp links.');
  }
  if (config.supabase.configured) {
    console.log(`[boot] Supabase ready (${config.supabase.url})${config.supabase.adminConfigured ? ' · service role OK' : ' · service role missing'}`);
  } else {
    console.log('[boot] Supabase is not configured — set NEXT_PUBLIC_SUPABASE_* in .env.local');
  }
  if (config.calcom.configured) {
    console.log(
      `[boot] Cal.com ready (eventTypeId=${config.calcom.eventTypeId}, api=${config.calcom.apiVersion}, tz=${config.calcom.timeZone})`,
    );
  } else {
    console.log('[boot] Cal.com is not configured — set CAL_API_KEY and CAL_EVENT_TYPE_ID on Render');
  }
});

const stopMaintenance = startMaintenance();

const shutdown = (signal) => {
  console.log(`\n[shutdown] ${signal} received, closing…`);
  stopMaintenance();
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
