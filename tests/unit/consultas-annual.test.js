import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annualCloseAt,
  isAnnualCloseWindow,
  yearsDueForClose,
} from '../../server/services/consultas.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

describe('annual close window (Europe/Madrid)', () => {
  it('opens at 31 Dec 18:00 peninsular and not a minute earlier', () => {
    // CET (UTC+1) in late December.
    const open = new Date('2025-12-31T17:00:00.000Z');
    const early = new Date('2025-12-31T16:59:00.000Z');
    assert.equal(isAnnualCloseWindow(open), true);
    assert.equal(isAnnualCloseWindow(early), false);
    assert.equal(annualCloseAt(2025).toISOString(), '2025-12-31T17:00:00.000Z');
  });

  it('marks 2025 due only after 18:00 on 31 Dec, and always includes the previous year after that', () => {
    const before = new Date('2025-12-31T16:00:00.000Z');
    const after = new Date('2025-12-31T17:00:00.000Z');
    assert.deepEqual(yearsDueForClose(before), [2024]);
    assert.deepEqual(yearsDueForClose(after), [2024, 2025]);
  });
});

describe('Super Admin Consultas replaces Comisiones', () => {
  const shell = read('public/js/shell.js');
  const app = read('public/js/app.js');
  const i18n = read('public/js/i18n.js');
  const sw = read('public/sw.js');

  it('puts Consultas in the Super Admin nav and drops the Comisiones slot', () => {
    const nav = shell.match(/export const SUPERADMIN_NAV = \(\) => \[([\s\S]*?)\];/)?.[1] ?? '';
    assert.match(nav, /key: 'consultas'/);
    assert.match(nav, /path: '\/admin\/consultas'/);
    assert.doesNotMatch(nav, /key: 'sales'/);
    assert.doesNotMatch(nav, /\/admin\/commissions'/);
    assert.match(i18n, /'nav\.consultas': 'Consultas'/);
    assert.match(app, /route\('\/admin\/consultas', adminConsultasView\)/);
    assert.match(app, /route\('\/rendimiento', yearSummaryView\)/);
    assert.match(sw, /views\/admin-consultas\.js/);
    assert.match(sw, /views\/year-summary\.js/);
  });
});
