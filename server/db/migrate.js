import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pool, closePool } from './index.js';
import config from '../config.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Prefer DIRECT_URL for DDL when it differs from the pooled DATABASE_URL
 * (typical Supabase / PgBouncer setups).
 */
function migrationClientFactory() {
  if (config.db.directUrl && config.db.directUrl !== config.db.url) {
    const migratePool = new pg.Pool({
      connectionString: config.db.directUrl,
      ssl: config.db.ssl,
      max: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });
    return {
      connect: () => migratePool.connect(),
      end: () => migratePool.end(),
    };
  }
  return {
    connect: () => pool.connect(),
    end: async () => {},
  };
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Drops every table/function in the public schema. Refuses to run in production. */
export async function reset() {
  if (config.isProduction) {
    throw new Error('Refusing to reset the database with NODE_ENV=production.');
  }
  const factory = migrationClientFactory();
  const client = await factory.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    client.release();
    await factory.end();
  }
}

export async function migrate({ silent = false } = {}) {
  const log = silent ? () => {} : (...args) => console.log(...args);
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  const factory = migrationClientFactory();
  const client = await factory.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.filename));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
      log(`[migrate] applied ${file}`);
      count += 1;
    }
    if (count === 0) log('[migrate] database already up to date');
    return count;
  } finally {
    client.release();
    await factory.end();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isDirectRun) {
  try {
    if (process.argv.includes('--reset')) {
      await reset();
      console.log('[migrate] schema dropped');
    }
    await migrate();
  } catch (error) {
    console.error(`[migrate] ${error.message}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
