import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrySubtitle, vehicleRegistryRow } from '../../public/js/views/vehicles.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
const view = readFileSync(path.join(root, 'public/js/views/vehicles.js'), 'utf8');
const shell = readFileSync(path.join(root, 'public/js/shell.js'), 'utf8');
const i18n = readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
const sw = readFileSync(path.join(root, 'public/sw.js'), 'utf8');

describe('vehicles cyan UX', () => {
  it('scopes the sky-cyan theme to the vehicles shell and nav', () => {
    assert.match(shell, /classList\.toggle\('app--vehicles', isVehicles\)/);
    assert.match(shell, /classList\.toggle\('nav--vehicles', isVehicles\)/);
    assert.match(shell, /classList\.toggle\('theme-vehicles', isVehicles\)/);
    assert.match(css, /--vehicles-cyan:\s*#00bfff/i);
    assert.match(css, /\.app--vehicles \.vehicles-finder\s*\{[^}]*background:\s*#d9f4ff/s);
    assert.match(css, /\.app--vehicles \.btn:not\(\.btn--soft\)[^{]*\{[^}]*background:\s*#00bfff/is);
    assert.match(css, /\.app--vehicles \.chip\[aria-pressed='true'\]\s*\{[^}]*background:\s*#00bfff/s);
    assert.match(css, /\.app--vehicles \.plate\s*,[\s\S]*?background:\s*#00bfff/i);
    assert.match(css, /\.nav--vehicles \.nav__item\[aria-current='page'\]\s*\{[^}]*color:\s*#00bfff/s);
    assert.match(html, /app\.css\?v=67-admin-clientes/);
    assert.match(sw, /VERSION = 'v54-admin-clientes'/);
  });

  it('keeps the search magnifier off the placeholder on every screen', () => {
    assert.match(css, /\.reservas-search__input\s*\{[^}]*padding-left:\s*44px/s);
    assert.match(css, /\.app--vehicles \.reservas-search__input\s*\{[^}]*padding-left:\s*44px/s);
    assert.match(css, /\.app--vehicles \.reservas-search__icon\s*\{[^}]*color:\s*#00bfff/s);
  });

  it('swaps the finder pane: photo is a drop zone, not a plate field', () => {
    assert.match(view, /data-finder-mode=/);
    assert.match(view, /class="vehicles-drop"/);
    assert.match(view, /vehicles-drop__title/);
    assert.match(view, /data-finder-panel="photo"/);
    assert.match(view, /showFinderTab/);
    assert.doesNotMatch(view.match(/const photoFormHtml[\s\S]+?;/)?.[0] ?? '', /vf-plate|input--plate/);
    assert.match(i18n, /'vehicles\.plateSubmit': 'Consultar vehículo'/);
  });

  it('gives section titles more weight than their subtitles', () => {
    assert.match(view, /class="vehicles-heading"/);
    assert.match(view, /class="vehicles-sub"/);
    assert.match(css, /\.vehicles-heading\s*\{[^}]*font-weight:\s*800/s);
    assert.match(css, /\.vehicles-heading\s*\{[^}]*color:\s*#0f172a/s);
    assert.match(css, /\.vehicles-sub\s*\{[^}]*color:\s*#64748b/s);
    assert.match(css, /\.vehicles-heading::before\s*\{[^}]*background:\s*#00bfff/s);
  });

  it('structures registry cards as model + plate badge over last job', () => {
    const row = vehicleRegistryRow({
      id: 'veh-1',
      label: 'Opel Corsa 1.2 Edition',
      plate_display: '1234 BCD',
      photo_url: '/img/vehicles/hatchback.svg',
      last_visit_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      last_visit_status: 'completed',
      last_visit_service: 'Revisión',
    });

    assert.match(row, /class="[^"]*vehicle-row[^"]*"/);
    assert.match(row, /class="[^"]*vehicle-row__title[^"]*"/);
    assert.match(row, /Opel Corsa 1\.2 Edition/);
    assert.match(row, /class="[^"]*plate plate--cyan[^"]*"/);
    assert.match(row, /1234 BCD/);
    assert.match(row, /class="[^"]*vehicle-row__sub[^"]*"/);
    assert.match(row, /Última intervención/);
    assert.match(row, /Revisión/);
    assert.match(row, /Completada/);
    assert.doesNotMatch(row, /list__title truncate/);
    assert.equal(
      registrySubtitle({ customer_name: 'María', year: 2018 }),
      'María',
    );
    assert.equal(registrySubtitle({}), 'Sin intervenciones registradas');
  });
});
