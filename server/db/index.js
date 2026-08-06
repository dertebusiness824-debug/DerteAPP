import pg from 'pg';
import config from '../config.js';

// Return DATE columns as plain `YYYY-MM-DD` strings instead of Date objects so
// calendar days never shift when the server timezone differs from the shop's.
pg.types.setTypeParser(1082, (value) => value);
// NUMERIC -> number (all numeric columns in this schema are small money/count values).
pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

export const pool = new pg.Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl,
  max: config.db.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  console.error('[db] idle client error:', error.message);
});

export const query = (text, params) => pool.query(text, params);

/** First row of a query, or null. */
export async function queryOne(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

/** All rows of a query. */
export async function queryAll(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/** Runs `fn` inside a transaction, rolling back on any thrown error. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; the pool will discard it.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}

export default { pool, query, queryOne, queryAll, transaction, closePool };
