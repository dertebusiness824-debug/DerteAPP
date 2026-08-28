#!/usr/bin/env node
/**
 * Arranque local / Cloud Agent en un solo paso:
 *   1) Asegura PostgreSQL local si DATABASE_URL apunta a 127.0.0.1 y no responde
 *   2) Arranca el panel B2B (migra + seed Super Admin + marketplace.sql al boot)
 *   3) Arranca la PWA de clientes (Vite)
 *
 * Uso: npm run dev
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(command, args, { cwd = root, name, env = process.env } = {}) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  children.push(child);
  const prefix = `[${name}]`;
  child.stdout.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (line.trim()) console.log(`${prefix} ${line}`);
    }
  });
  child.stderr.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (line.trim()) console.error(`${prefix} ${line}`);
    }
  });
  child.on('exit', (code, signal) => {
    if (signal) console.log(`${prefix} stopped (${signal})`);
    else if (code) console.error(`${prefix} exited with code ${code}`);
  });
  return child;
}

function canConnect(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

async function ensureLocalPostgres() {
  const url = process.env.DATABASE_URL || 'postgres://derte:derte@127.0.0.1:5432/derteapp';
  let host = '127.0.0.1';
  let port = 5432;
  try {
    const parsed = new URL(url);
    host = parsed.hostname || host;
    port = Number(parsed.port || 5432);
  } catch {
    // keep defaults
  }

  if (!['127.0.0.1', 'localhost'].includes(host)) {
    console.log(`[dev] DATABASE_URL remoto (${host}) — no se inicia Postgres local`);
    return;
  }

  if (await canConnect(host, port)) {
    console.log(`[dev] PostgreSQL ya responde en ${host}:${port}`);
    return;
  }

  console.log(`[dev] PostgreSQL no responde en ${host}:${port} — intentando arrancar clúster local…`);
  const helper = path.join(root, 'scripts', 'ensure-local-postgres.sh');
  await new Promise((resolve, reject) => {
    const child = spawn('bash', [helper], { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ensure-local-postgres exited ${code}`))));
  });

  for (let i = 0; i < 30; i += 1) {
    if (await canConnect(host, port)) {
      console.log(`[dev] PostgreSQL listo en ${host}:${port}`);
      return;
    }
    await sleep(500);
  }
  throw new Error(`PostgreSQL no respondió en ${host}:${port} tras el arranque local`);
}

function shutdown(signal) {
  console.log(`\n[dev] ${signal} — cerrando procesos…`);
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await ensureLocalPostgres();

process.env.DATABASE_URL ??= 'postgres://derte:derte@127.0.0.1:5432/derteapp';
process.env.DATABASE_SSL ??= 'disable';
process.env.JWT_SECRET ??= 'dev-jwt-secret-change-me-in-production-32';
process.env.APP_URL ??= 'http://127.0.0.1:3000';
process.env.NODE_ENV ??= 'development';
// Evitar que un DIRECT_URL de tests (derteapp_test) desvíe las migraciones
// del boot a otra base mientras el API usa derteapp.
process.env.DIRECT_URL = process.env.DATABASE_URL;

const clientAppDir = path.join(root, 'client-app');
const clientModules = path.join(clientAppDir, 'node_modules');
try {
  await fs.access(clientModules);
} catch {
  console.log('[dev] Instalando dependencias de client-app…');
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--no-fund', '--no-audit'], {
      cwd: clientAppDir,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`client-app npm install exited ${code}`))));
  });
}

console.log('[dev] Panel B2B → http://127.0.0.1:3000  (Super Admin: dertebusiness824@gmail.com)');
console.log('[dev] PWA clientes → http://127.0.0.1:4173');
console.log('[dev] Migraciones + Super Admin + marketplace.sql se aplican solos al arrancar el API');

run(process.execPath, ['--watch', 'server/index.js'], {
  name: 'api',
  env: { ...process.env },
});
run('npm', ['run', 'dev', '--silent'], {
  name: 'pwa',
  cwd: clientAppDir,
  env: {
    ...process.env,
    // La PWA puede pedir la config pública al panel B2B en el mismo origen o vía API.
    VITE_DERTEAPP_API_URL: process.env.VITE_DERTEAPP_API_URL || 'http://127.0.0.1:3000',
  },
});

// Mantener el proceso vivo mientras vivan los hijos.
await new Promise(() => {});
