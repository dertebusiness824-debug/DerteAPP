#!/usr/bin/env node
/**
 * Purga CLI (opcional): conserva un solo taller y borra el resto.
 *
 *   node scripts/purge-shops.js --keep=<uuid> --confirm=ELIMINAR
 *
 * Preferible usar el botón del panel Super Admin (misma lógica).
 */
import { closePool } from '../server/db/index.js';
import { purgeShopsExcept } from '../server/services/shop-covers.js';

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const keep = arg('keep');
const confirm = arg('confirm');

if (!keep || confirm !== 'ELIMINAR') {
  console.error('Uso: node scripts/purge-shops.js --keep=<shop-uuid> --confirm=ELIMINAR');
  process.exit(1);
}

try {
  const result = await purgeShopsExcept(keep, { confirm: 'ELIMINAR' });
  console.log(
    `[purge] conservado ${result.kept.name} (${result.kept.id}); eliminados ${result.deleted_count}`,
  );
  for (const shop of result.deleted) {
    console.log(`  - ${shop.name} (${shop.id})`);
  }
} catch (error) {
  console.error(`[purge] ${error.message}`);
  process.exit(1);
} finally {
  await closePool();
}
