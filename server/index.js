import config from './config.js';
import { createApp } from './app.js';
import { closePool } from './db/index.js';
import { migrate } from './db/migrate.js';
import { ensureSuperAdmin } from './db/seed.js';
import { startMaintenance } from './services/maintenance.js';

const app = createApp();

try {
  // Applying pending migrations on boot keeps single-container deployments
  // (Hostinger VPS, Docker, Render) to one step.
  await migrate({ silent: true });
  // Ensure the bootstrap Super Admin exists after every deploy (idempotent).
  // Password is only rotated when SUPER_ADMIN_PASSWORD is set in the env.
  await ensureSuperAdmin({ rotatePassword: false });
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
