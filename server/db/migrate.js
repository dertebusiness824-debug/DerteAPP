import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './index.js';
import config from '../config.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

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
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

export async function migrate({ silent = false } = {}) {
  const log = silent ? () => {} : (...args) => console.log(...args);
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  const client = await pool.connect();
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
