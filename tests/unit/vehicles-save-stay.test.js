import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const view = read('public/js/views/vehicles.js');
const shell = read('public/js/shell.js');
const workshop = read('server/routes/workshop.js');

describe('saving an identified vehicle stays in Vehículos', () => {
  it('never lets a finder form do a native submit (that reloads Inicio)', () => {
    const submit = view.match(/main\.addEventListener\('submit',[\s\S]+?\n  \}\);/)?.[0] ?? '';
    assert.match(submit, /event\.preventDefault\(\)/);
    assert.ok(
      submit.indexOf('event.preventDefault()') < submit.indexOf('data-plate-form'),
      'preventDefault must run before the plate/manual branches',
    );
  });

  it('saves with type=button and then opens the vehicle file, not /', () => {
    assert.match(view, /type="button" data-save-vehicle/);
    assert.match(view, /suppressHomeGhostClick/);
    assert.match(view, /navigate\(`\/vehiculos\/\$\{vehicle\.id\}`\)/);
    assert.doesNotMatch(view.match(/const saveCandidate[\s\S]+?^\s{2}\};/m)?.[0] ?? view, /navigate\('\/'\)/);
    assert.match(view, /type="button" role="tab"/);
  });

  it('stops a delayed tap on the header brand or Inicio tab after save', () => {
    assert.match(view, /\[data-nav="home"\]/);
    assert.match(view, /\.header__brand/);
    assert.match(view, /a\[href="\/"\]/);
    assert.match(view, /stopImmediatePropagation/);
  });

  it('uses a button for the header brand so href=\/ cannot dump the PWA on Inicio', () => {
    assert.match(shell, /<button type="button" class="header__brand"/);
    assert.doesNotMatch(shell, /<a class="header__brand" href="\/"/);
  });

  it('accepts official specs when the shop file is created', () => {
    assert.match(workshop, /specs:\s*z\.record/);
    assert.match(view, /specs: candidate\.specs/);
  });
});
