/**
 * Aplica `client-app/supabase/marketplace.sql` de forma idempotente tras las
 * migraciones del panel B2B. Así no hace falta un `psql` manual: al arrancar
 * el servidor (o `npm run dev`) el escaparate B2C queda instalado.
 *
 * En Postgres local (sin roles de Supabase) crea stubs `anon` / `authenticated`
 * y `auth.uid()` para que el mismo SQL sea aplicable sin intervención.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

const MARKER = 'client-app/marketplace.sql';
const sqlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client-app/supabase/marketplace.sql',
);

async function ensureSupabaseCompatStubs(client, log) {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END
    $$;
  `);

  // Solo en entornos sin esquema auth (Postgres local / Render sin Supabase).
  const { rows } = await client.query(
    `SELECT 1 AS ok FROM pg_namespace WHERE nspname = 'auth' LIMIT 1`,
  );
  if (rows.length === 0) {
    await client.query(`CREATE SCHEMA auth`);
    await client.query(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $fn$ SELECT NULL::uuid $fn$
    `);
    log('[marketplace] stubs locales auth/anon/authenticated creados');
  }
}

export async function ensureMarketplaceSchema({ silent = false } = {}) {
  const log = silent ? () => {} : (...args) => console.log(...args);

  let sql;
  try {
    sql = await fs.readFile(sqlPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('[marketplace] SQL no encontrado — omitido');
      return { applied: false, skipped: true };
    }
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await ensureSupabaseCompatStubs(client, log);

    // El SQL es idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE).
    // Se reaplica en cada boot para recoger cambios del fichero sin `psql` manual.
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)
       ON CONFLICT (filename) DO UPDATE SET applied_at = now()`,
      [MARKER],
    );
    log('[marketplace] schema listo (escaparate + ofertas + RLS)');
    return { applied: true };
  } finally {
    client.release();
  }
}
