/**
 * Loads environment files in Next.js-compatible order:
 *   1. `.env`
 *   2. `.env.local` (overrides — keep secrets here; gitignored)
 *
 * Import this module before reading `process.env` anywhere else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadFile(filename, { override = false } = {}) {
  const fullPath = path.join(rootDir, filename);
  if (!fs.existsSync(fullPath)) return false;
  dotenv.config({ path: fullPath, override });
  return true;
}

loadFile('.env', { override: false });
loadFile('.env.local', { override: true });

export default rootDir;
