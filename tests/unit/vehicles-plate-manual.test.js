/**
 * Plate lookup must be a single manual submit — never mount, input, or photo.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const view = read('public/js/views/vehicles.js');
const admin = read('public/js/views/admin-matriculas.js');
const cache = read('public/js/data-cache.js');
const vehicles = read('server/services/vehicles.js');
const workshop = read('server/routes/workshop.js');

describe('plate lookup is manual-only', () => {
  it('Identificar only calls identifyPlate from the plate form submit', () => {
    assert.match(view, /createPlateLookupGuard/);
    assert.match(view, /data-plate-submit/);
    assert.match(view, /plateGuard\.begin/);
    assert.match(view, /Never from mount/);

    const submit = view.match(/main\.addEventListener\('submit',[\s\S]+?\n  \}\);/)?.[0] ?? '';
    assert.match(submit, /identifyPlate/);

    const afterSubmit = view.slice(view.indexOf("main.addEventListener('submit'"));
    const mountBlock = afterSubmit.match(/mountFinderPanes\(\);[\s\S]+?await loadRegistry\(\);/)?.[0] ?? '';
    assert.doesNotMatch(mountBlock, /identifyPlate/);

    const inputHandler = view.match(/main\.addEventListener\('input',[\s\S]+?\n  \}\);/)?.[0] ?? '';
    assert.match(inputHandler, /plateGuard\.markEdited/);
    assert.doesNotMatch(inputHandler, /identifyPlate/);
    assert.doesNotMatch(inputHandler, /api\.identifyPlate/);
  });

  it('does not prefetch or auto-identify plates in the data cache', () => {
    assert.doesNotMatch(cache, /identifyPlate/);
    assert.doesNotMatch(cache, /identify\/plate/);
    assert.doesNotMatch(cache, /adminLookupPlate/);
  });

  it('Super Admin photo change only OCRs — it does not consult or save', () => {
    assert.match(admin, /ocr_only:\s*true/);
    assert.match(admin, /plateGuard\.begin/);
    const photo = admin.match(/#sa-photo[\s\S]+?\n  \}\);/)?.[0] ?? '';
    assert.match(photo, /ocr_only:\s*true/);
    assert.doesNotMatch(photo, /save:\s*true/);
    assert.doesNotMatch(admin, /useEffect/);
  });

  it('workshop identify is the only shop path that may call the official API', () => {
    assert.match(workshop, /\/vehicles\/identify\/plate/);
    assert.match(vehicles, /shouldRecordOfficialLookup/);
    assert.match(vehicles, /lookupPlate/);
  });
});
