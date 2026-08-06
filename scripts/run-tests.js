#!/usr/bin/env node
/**
 * Test entry point.
 *
 * Prepares an isolated test database, then runs the node:test suites one file
 * at a time (the integration suites share the database and truncate between
 * files, so they must not overlap).
 *
 * Requires a reachable PostgreSQL instance. Override the connection with
 * TEST_DATABASE_URL, e.g.
 *   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/derteapp_test npm test
 */
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL ??= 'postgres://derte:derte@127.0.0.1:5432/derteapp_test';
process.env.JWT_SECRET ??= 'test-secret-not-used-anywhere-else';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.OTP_DEBUG = 'true';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.DEFAULT_TIMEZONE = 'Europe/Madrid';
process.env.SUPER_ADMIN_PHONE = '+34600000000';
process.env.SUPER_ADMIN_PASSWORD = 'TestAdmin123';
// Fake Zadarma credentials plus a local stub API, so the telephony suite can
// exercise request signing without touching the real provider.
process.env.ZADARMA_KEY = 'test-key';
process.env.ZADARMA_SECRET = 'test-secret';
process.env.ZADARMA_API_URL = 'http://127.0.0.1:39547';
process.env.ZADARMA_VERIFY_WEBHOOKS = 'true';

const { reset, migrate } = await import('../server/db/migrate.js');
const { closePool } = await import('../server/db/index.js');

try {
  await reset();
  await migrate({ silent: true });
  console.log('[test] database prepared\n');
} catch (error) {
  console.error(`[test] could not prepare the test database: ${error.message}`);
  console.error('[test] is PostgreSQL running? See TEST_DATABASE_URL in scripts/run-tests.js');
  process.exit(1);
} finally {
  await closePool();
}

// Collected explicitly so the run order is stable: fast unit suites first.
const testsRoot = new URL('../tests/', import.meta.url);
const entries = await readdir(testsRoot, { recursive: true });
const files = entries
  .filter((entry) => entry.endsWith('.test.js'))
  .map((entry) => path.join('tests', entry))
  .sort((a, b) => Number(a.includes('integration')) - Number(b.includes('integration')) || a.localeCompare(b));

if (files.length === 0) {
  console.error('[test] no test files found under tests/');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 1));
