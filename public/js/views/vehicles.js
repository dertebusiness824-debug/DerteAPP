/**
 * Vehicle finder and registry.
 *
 * Three ways in, one result: plate, photo or make/model by hand. Whatever the
 * route, the counter sees the exact commercial version, a picture and the
 * technical sheet, and can save the car to the shop's own file.
 */
import { api, ApiError } from '../api.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { requireShop, screen, setContent } from '../shell.js';
import {
  ago,
  confirmSheet,
  emptyState,
  esc,
  icon,
  sheet,
  skeletonList,
  toast,
} from '../ui.js';

/** Reads a picked file as a data URL, which is what the API expects. */
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t('vehicles.photoReadFailed')));
    reader.readAsDataURL(file);
  });
}

const SPEC_LABELS = () => [
  ['engine', t('vehicles.spec.engine')],
  ['power_hp', t('vehicles.spec.power')],
  ['fuel', t('vehicles.spec.fuel')],
  ['gearbox', t('vehicles.spec.gearbox')],
  ['displacement_cc', t('vehicles.spec.displacement')],
  ['tyres', t('vehicles.spec.tyres')],
  ['oil', t('vehicles.spec.oil')],
  ['oil_capacity_l', t('vehicles.spec.oilCapacity')],
  ['service_km', t('vehicles.spec.service')],
  ['battery', t('vehicles.spec.battery')],
  ['vin', t('vehicles.spec.vin')],
  ['tecdoc', t('vehicles.spec.tecdoc')],
  ['first_registered', t('vehicles.spec.firstRegistered')],
  ['power_kw', t('vehicles.spec.powerKw')],
];

const specValue = (vehicle, key) => {
  const raw = vehicle[key] ?? vehicle.specs?.[key] ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  if (key === 'power_hp') return `${raw} CV`;
  if (key === 'power_kw') return `${raw} kW`;
  if (key === 'displacement_cc') return `${raw} cc`;
  if (key === 'oil_capacity_l') return `${raw} L`;
  if (key === 'service_km') return `${Number(raw).toLocaleString('es-ES')} km`;
  return String(raw);
};

/** Technical sheet. Empty rows are dropped rather than shown as "—". */
export function specsHtml(vehicle) {
  const rows = SPEC_LABELS()
    .map(([key, label]) => [label, specValue(vehicle, key)])
    .filter(([, value]) => value !== null)
    .map(
      ([label, value]) =>
        `<div class="kv"><span class="kv__key">${esc(label)}</span><span class="kv__value">${esc(value)}</span></div>`,
    )
    .join('');
  if (!rows) return `<p class="list__meta">${esc(t('vehicles.noSpecs'))}</p>`;
  return `${rows}
    <p class="list__meta vehicle-card__disclaimer">${esc(t('vehicles.specsReference'))}</p>`;
}

/** Big result card: photo, exact version and specs. */
export function vehicleCardHtml(vehicle, { source = null, confidence = null } = {}) {
  const title = vehicle.label || vehicle.plate_display || t('vehicles.unknownModel');
  const meta = [vehicle.year, vehicle.fuel, vehicle.power_hp ? `${vehicle.power_hp} CV` : null]
    .filter(Boolean)
    .join(' · ');

  return `
    <div class="card vehicle-card">
      <div class="vehicle-card__photo">
        <img src="${esc(vehicle.photo_url || '/img/vehicles/hatchback.svg')}" alt="${esc(title)}" loading="lazy">
        ${
          vehicle.has_own_photo
            ? ''
            : `<span class="vehicle-card__photo-tag">${esc(t('vehicles.illustration'))}</span>`
        }
      </div>
      <div class="vehicle-card__head">
        <div class="grow">
          <h2 class="vehicle-card__title">${esc(title)}</h2>
          ${meta ? `<div class="list__meta">${esc(meta)}</div>` : ''}
        </div>
        ${
          vehicle.plate_display
            ? `<span class="plate">${esc(vehicle.plate_display)}</span>`
            : ''
        }
      </div>
      ${
        source
          ? `<div class="vehicle-card__source">${icon('inspect', { size: 14 })}
               ${esc(t(`vehicles.source.${source}`) || source)}
               ${confidence ? ` · ${Math.round(confidence * 100)}%` : ''}
             </div>`
          : ''
      }
      <div class="vehicle-card__specs">${specsHtml(vehicle)}</div>
    </div>`;
}

/** Second line of a registry card: last job, or customer / year as fallback. */
export function registrySubtitle(vehicle) {
  if (vehicle.last_visit_at) {
    const status = vehicle.last_visit_status ? t(`status.${vehicle.last_visit_status}`) : '';
    const statusOk = status && status !== `status.${vehicle.last_visit_status}`;
    return [t('vehicles.lastVisit'), vehicle.last_visit_service, statusOk ? status : null, ago(vehicle.last_visit_at)]
      .filter(Boolean)
      .join(' · ');
  }
  if (vehicle.customer_name) return vehicle.customer_name;
  if (vehicle.year) return String(vehicle.year);
  return t('vehicles.noLastVisit');
}

/** Workshop list row: exact model + plate badge on top, last job underneath. */
export function vehicleRegistryRow(vehicle) {
  const title = vehicle.label || t('vehicles.unknownModel');
  const subtitle = registrySubtitle(vehicle);
  return `
    <button class="list__item vehicle-row" type="button" data-vehicle="${esc(vehicle.id)}">
      <span class="list__thumb vehicle-row__thumb"><img src="${esc(vehicle.photo_url || '/img/vehicles/hatchback.svg')}" alt="" loading="lazy"></span>
      <div class="vehicle-row__body grow">
        <div class="vehicle-row__top">
          <div class="vehicle-row__title">${esc(title)}</div>
          ${
            vehicle.plate_display
              ? `<span class="plate plate--cyan">${esc(vehicle.plate_display)}</span>`
              : ''
          }
        </div>
        <div class="vehicle-row__sub">${esc(subtitle)}</div>
      </div>
      ${icon('chevron', { size: 18, className: 'chev' })}
    </button>`;
}

const TABS = () => [
  { key: 'plate', label: t('vehicles.tab.plate'), iconName: 'inspect' },
  { key: 'photo', label: t('vehicles.tab.photo'), iconName: 'camera' },
  { key: 'manual', label: t('vehicles.tab.manual'), iconName: 'wrench' },
];

/**
 * The plate lookup reports where an answer came from ("registry", "bookings",
 * "provider"), which is finer grained than the `identified_by` column accepts.
 */
const IDENTIFIED_BY = {
  registry: 'history',
  bookings: 'history',
  history: 'history',
  provider: 'plate',
  plate: 'plate',
  photo: 'photo',
  catalog: 'catalog',
  manual: 'manual',
};

export async function vehiclesView() {
  const shop = requireShop({ title: t('nav.vehicles'), navKey: 'vehicles' });
  if (!shop) return undefined;

  let activeTab = 'plate';
  /** Last identified vehicle, still unsaved. */
  let candidate = null;
  let candidateSource = null;
  let candidateConfidence = null;

  screen({
    title: t('nav.vehicles'),
    nav: 'vehicles',
    shopSwitcher: true,
    content: `
      <div class="stack vehicles-page" data-vehicles>
        <section class="card vehicles-finder">
          <h2 class="vehicles-heading">${esc(t('vehicles.finderTitle'))}</h2>
          <p class="vehicles-sub">${esc(t('vehicles.finderHint'))}</p>
          <div class="chips vehicles-tabs" role="tablist" data-tabs>
            ${TABS()
              .map(
                (tab) => `
                  <button class="chip" role="tab" data-tab="${tab.key}" aria-pressed="${tab.key === activeTab}">
                    ${icon(tab.iconName, { size: 15 })}<span>${esc(tab.label)}</span>
                  </button>`,
              )
              .join('')}
          </div>
          <div class="vehicles-finder__pane" data-finder data-finder-mode="${activeTab}"></div>
        </section>

        <div data-result></div>

        <section class="vehicles-registry">
          <h2 class="vehicles-heading">${esc(t('vehicles.registryTitle'))}</h2>
          <label class="reservas-search vehicles-search">
            <span class="reservas-search__icon" aria-hidden="true">${icon('search', { size: 18 })}</span>
            <input class="input reservas-search__input" type="search" data-registry-search
                   placeholder="${esc(t('vehicles.registrySearch'))}" autocomplete="off">
          </label>
          <div data-registry>${skeletonList(3)}</div>
        </section>
      </div>`,
  });

  const main = document.querySelector('.main');
  const finderBox = main.querySelector('[data-finder]');
  const resultBox = main.querySelector('[data-result]');
  const registryBox = main.querySelector('[data-registry]');

  // --- finder panels --------------------------------------------------------

  const plateFormHtml = () => `
    <form class="stack stack--tight" data-plate-form novalidate>
      <label class="sr-only" for="vf-plate">${esc(t('vehicles.plateLabel'))}</label>
      <input class="input input--plate" id="vf-plate" maxlength="10" autocomplete="off"
             inputmode="latin" placeholder="1234 BCD" spellcheck="false">
      <button class="btn btn--block" type="submit">${icon('search', { size: 17 })} ${esc(t('vehicles.plateSubmit'))}</button>
      <div class="field__error" data-error role="alert"></div>
    </form>`;

  const photoFormHtml = () => `
    <div class="stack stack--tight">
      <label class="vehicles-drop" for="vf-photo">
        <span class="vehicles-drop__icon" aria-hidden="true">${icon('camera', { size: 32 })}</span>
        <strong class="vehicles-drop__title">${esc(t('vehicles.photoCta'))}</strong>
        <span class="vehicles-drop__hint">${esc(t('vehicles.photoHint'))}</span>
        <input id="vf-photo" type="file" accept="image/*" capture="environment" data-photo-input hidden>
      </label>
      <div class="field__error" data-error role="alert"></div>
    </div>`;

  const manualFormHtml = (catalog = null) => `
    <form class="stack stack--tight" data-manual-form novalidate>
      <div class="grid-2">
        <div class="field">
          <label class="field__label" for="vf-make">${esc(t('vehicles.make'))}</label>
          <select class="input" id="vf-make">
            <option value="">${esc(t('vehicles.makeAny'))}</option>
            ${(catalog?.makes ?? [])
              .map((make) => `<option value="${esc(make)}">${esc(make)}</option>`)
              .join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="vf-model">${esc(t('vehicles.model'))}</label>
          <input class="input" id="vf-model" autocomplete="off" placeholder="${esc(t('vehicles.modelPlaceholder'))}">
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label class="field__label" for="vf-year">${esc(t('vehicles.year'))}</label>
          <input class="input" id="vf-year" type="number" min="1900" max="2100" inputmode="numeric">
        </div>
        <div class="field">
          <label class="field__label" for="vf-manual-plate">${esc(t('vehicles.plateOptional'))}</label>
          <input class="input" id="vf-manual-plate" maxlength="10" autocomplete="off" placeholder="1234 BCD">
        </div>
      </div>
      <button class="btn btn--block" type="submit">${icon('search', { size: 17 })} ${esc(t('vehicles.manualSubmit'))}</button>
      <div class="field__error" data-error role="alert"></div>
      <div data-matches></div>
    </form>`;

  const showError = (message) => {
    const box = finderBox.querySelector('[data-error]');
    if (box) box.textContent = message;
  };

  /** Paints the identified car plus the actions that follow from it. */
  const paintResult = ({ vehicle, source, confidence, plate = null, saved = false }) => {
    candidate = vehicle;
    candidateSource = source;
    candidateConfidence = confidence;

    if (!vehicle) {
      resultBox.innerHTML = `
        <div class="card card--flat">
          <div class="empty empty--inline">
            ${icon('car', { size: 26 })}
            <div class="empty__title">${esc(t('vehicles.notFoundTitle'))}</div>
            <div>${esc(t('vehicles.notFoundBody'))}</div>
            ${plate?.display ? `<span class="plate">${esc(plate.display)}</span>` : ''}
            ${
              plate && !plate.valid
                ? `<p class="list__meta">${esc(t('vehicles.plateInvalid'))}</p>`
                : ''
            }
          </div>
          <button class="btn btn--soft btn--block" type="button" data-go-manual>
            ${icon('wrench', { size: 17 })} ${esc(t('vehicles.completeByHand'))}
          </button>
        </div>`;
      return;
    }

    resultBox.innerHTML = `
      ${vehicleCardHtml(vehicle, { source, confidence })}
      <div class="btn-row">
        ${
          saved
            ? `<button class="btn btn--soft btn--block" type="button" data-open-saved="${esc(vehicle.id)}">
                 ${icon('inspect', { size: 17 })} ${esc(t('vehicles.openFile'))}
               </button>`
            : `<button class="btn btn--block" type="button" data-save-vehicle>
                 ${icon('plus', { size: 17 })} ${esc(t('vehicles.save'))}
               </button>`
        }
        <button class="btn btn--soft btn--block" type="button" data-ask-diagnostics>
          ${icon('stethoscope', { size: 17 })} ${esc(t('vehicles.askDiagnostics'))}
        </button>
      </div>`;
  };

  let catalogCache = null;
  const loadCatalog = async () => {
    if (catalogCache) return catalogCache;
    try {
      catalogCache = await api.vehicleCatalog({ shop_id: shop.id });
    } catch {
      catalogCache = { makes: [], results: [] };
    }
    return catalogCache;
  };

  const paintFinder = async () => {
    for (const chip of main.querySelectorAll('[data-tab]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.tab === activeTab));
    }
    finderBox.dataset.finderMode = activeTab;
    if (activeTab === 'plate') {
      finderBox.innerHTML = plateFormHtml();
      finderBox.querySelector('#vf-plate')?.focus();
      return;
    }
    if (activeTab === 'photo') {
      finderBox.innerHTML = photoFormHtml();
      return;
    }
    finderBox.innerHTML = manualFormHtml(await loadCatalog());
  };

  // --- identification -------------------------------------------------------

  const identifyPlate = async (plate) => {
    showError('');
    try {
      const payload = await api.identifyPlate({ shop_id: shop.id, plate });
      paintResult({
        vehicle: payload.vehicle,
        source: payload.source,
        confidence: payload.confidence,
        plate: payload.plate,
        saved: Boolean(payload.vehicle?.id),
      });
      if (!payload.found) toast(t('vehicles.notFoundToast'), 'warn');
    } catch (error) {
      showError(error.message);
    }
  };

  const identifyPhoto = async (file) => {
    showError('');
    const label = finderBox.querySelector('.vehicles-drop, .upload');
    label?.classList.add('is-busy');
    try {
      const dataUrl = await readImage(file);
      const payload = await api.identifyVehiclePhoto({ shop_id: shop.id, data_url: dataUrl });
      if (!payload.recognized) {
        showError(
          payload.reason === 'vision_not_configured'
            ? t('vehicles.visionUnavailable')
            : t('vehicles.photoNoMatch'),
        );
        paintResult({ vehicle: null, source: 'photo', confidence: null });
        return;
      }
      paintResult({
        vehicle: payload.vehicle,
        source: 'photo',
        confidence: payload.vehicle?.confidence ?? null,
      });
    } catch (error) {
      showError(error.message);
    } finally {
      label?.classList.remove('is-busy');
    }
  };

  const identifyManual = async (form) => {
    showError('');
    const make = form.querySelector('#vf-make').value.trim();
    const model = form.querySelector('#vf-model').value.trim();
    const year = Number(form.querySelector('#vf-year').value) || null;
    const plate = form.querySelector('#vf-manual-plate').value.trim();

    if (!make && !model) {
      showError(t('vehicles.manualNeedsModel'));
      return;
    }

    try {
      const payload = await api.vehicleCatalog({
        shop_id: shop.id,
        q: [make, model].filter(Boolean).join(' '),
        make: make || undefined,
        model: model || undefined,
        year: year || undefined,
        limit: 8,
      });
      const matches = payload.results ?? [];
      const box = form.querySelector('[data-matches]');

      if (!matches.length) {
        // Nothing in the catalog: keep exactly what the counter typed.
        paintResult({
          vehicle: {
            plate: plate || null,
            plate_display: plate || null,
            make: make || null,
            model: model || null,
            version: null,
            year,
            label: [make, model].filter(Boolean).join(' ') || null,
            specs: {},
            photo_url: '/img/vehicles/hatchback.svg',
            has_own_photo: false,
          },
          source: 'manual',
          confidence: null,
        });
        if (box) box.innerHTML = '';
        return;
      }

      if (box) {
        box.innerHTML = `
          <div class="section-title section-title--flush"><span>${esc(t('vehicles.pickVersion'))}</span></div>
          <div class="list">
            ${matches
              .map(
                (entry) => `
                  <button class="list__item" type="button" data-catalog="${esc(entry.key)}">
                    <span class="list__thumb"><img src="${esc(entry.photo_url)}" alt="" loading="lazy"></span>
                    <div class="grow">
                      <div class="list__title truncate">${esc(`${entry.make} ${entry.model}`)}</div>
                      <div class="list__meta truncate">${esc(entry.version)}${
                        entry.year_from ? ` · ${entry.year_from}–${entry.year_to}` : ''
                      }</div>
                    </div>
                    ${icon('chevron', { size: 18, className: 'chev' })}
                  </button>`,
              )
              .join('')}
          </div>`;
      }

      box?.querySelectorAll('[data-catalog]').forEach((button) => {
        button.addEventListener('click', () => {
          const entry = matches.find((item) => item.key === button.dataset.catalog);
          if (!entry) return;
          paintResult({
            vehicle: {
              plate: plate || null,
              plate_display: plate || null,
              make: entry.make,
              model: entry.model,
              version: entry.version,
              year: year ?? entry.year_from,
              fuel: entry.fuel,
              engine: entry.engine,
              power_hp: entry.power_hp,
              body: entry.body,
              label: `${entry.make} ${entry.model} ${entry.version}`,
              specs: entry.specs,
              catalog_key: entry.key,
              photo_url: entry.photo_url,
              has_own_photo: false,
            },
            source: 'catalog',
            confidence: entry.match,
          });
          resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });
    } catch (error) {
      showError(error.message);
    }
  };

  // --- registry -------------------------------------------------------------

  let registrySearch = '';
  const loadRegistry = async () => {
    try {
      const { vehicles } = await api.vehicles({ shop_id: shop.id, search: registrySearch || undefined });
      registryBox.innerHTML = vehicles.length
        ? `<div class="list">${vehicles.map(vehicleRegistryRow).join('')}</div>`
        : emptyState(t('vehicles.registryEmpty'), t('vehicles.registryEmptyHint'), 'car');
    } catch (error) {
      registryBox.innerHTML = emptyState(t('vehicles.registryFailed'), error.message, 'x');
    }
  };

  const saveCandidate = async (button) => {
    if (!candidate) return;
    button.disabled = true;
    try {
      const { vehicle } = await api.saveVehicle({
        shop_id: shop.id,
        plate: candidate.plate ?? null,
        make: candidate.make ?? null,
        model: candidate.model ?? null,
        version: candidate.version ?? null,
        catalog_key: candidate.catalog_key ?? candidate.specs?.catalog_key ?? null,
        year: candidate.year ?? null,
        fuel: candidate.fuel ?? null,
        engine: candidate.engine ?? null,
        power_hp: candidate.power_hp ?? null,
        body: candidate.body ?? null,
        identified_by: candidate.identified_by ?? IDENTIFIED_BY[candidateSource] ?? 'manual',
        confidence: candidateConfidence ?? null,
        customer_name: candidate.customer_name ?? null,
        customer_phone: candidate.customer_phone ?? null,
      });
      toast(t('vehicles.saved'), 'ok');
      paintResult({
        vehicle,
        source: candidateSource,
        confidence: candidateConfidence,
        saved: true,
      });
      await loadRegistry();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : t('vehicles.saveFailed'), 'error');
      button.disabled = false;
    }
  };

  // --- events ---------------------------------------------------------------

  main.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      if (tab.dataset.tab === activeTab) return;
      activeTab = tab.dataset.tab;
      void paintFinder();
      return;
    }

    if (event.target.closest('[data-go-manual]')) {
      activeTab = 'manual';
      void paintFinder();
      return;
    }

    const save = event.target.closest('[data-save-vehicle]');
    if (save) {
      void saveCandidate(save);
      return;
    }

    const ask = event.target.closest('[data-ask-diagnostics]');
    if (ask) {
      const params = new URLSearchParams();
      if (candidate?.id) params.set('vehicle_id', candidate.id);
      if (candidate?.make) params.set('make', candidate.make);
      if (candidate?.model) params.set('model', candidate.model);
      if (candidate?.fuel) params.set('fuel', candidate.fuel);
      if (candidate?.year) params.set('year', String(candidate.year));
      navigate(`/diagnostico${params.toString() ? `?${params}` : ''}`);
      return;
    }

    const open = event.target.closest('[data-open-saved]') ?? event.target.closest('[data-vehicle]');
    if (open) {
      navigate(`/vehiculos/${open.dataset.openSaved ?? open.dataset.vehicle}`);
    }
  });

  main.addEventListener('submit', (event) => {
    const plateForm = event.target.closest('[data-plate-form]');
    if (plateForm) {
      event.preventDefault();
      void identifyPlate(plateForm.querySelector('#vf-plate').value);
      return;
    }
    const manualForm = event.target.closest('[data-manual-form]');
    if (manualForm) {
      event.preventDefault();
      void identifyManual(manualForm);
    }
  });

  main.addEventListener('change', (event) => {
    const input = event.target.closest('[data-photo-input]');
    if (!input?.files?.length) return;
    void identifyPhoto(input.files[0]);
    input.value = '';
  });

  let searchTimer;
  main.querySelector('[data-registry-search]')?.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    const value = event.target.value.trim();
    searchTimer = setTimeout(() => {
      registrySearch = value;
      void loadRegistry();
    }, 250);
  });

  await paintFinder();
  await loadRegistry();

  return () => clearTimeout(searchTimer);
}

// --- vehicle file -----------------------------------------------------------

export async function vehicleView({ params }) {
  const shop = requireShop({ title: t('nav.vehicles'), navKey: 'vehicles' });
  if (!shop) return undefined;

  screen({
    title: t('nav.vehicles'),
    back: '/vehiculos',
    nav: 'vehicles',
    content: skeletonList(3),
  });

  const render = async () => {
    let vehicle;
    try {
      ({ vehicle } = await api.vehicle(params.id, shop.id));
    } catch (error) {
      setContent(emptyState(t('vehicles.fileNotFound'), error.message, 'car'));
      return;
    }

    const main = setContent(`
      <div class="stack">
        ${vehicleCardHtml(vehicle, { source: vehicle.identified_by, confidence: vehicle.confidence })}

        <div class="card">
          <div class="kv"><span class="kv__key">${esc(t('vehicles.customer'))}</span>
            <span class="kv__value">${esc(vehicle.customer_name ?? '—')}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('vehicles.customerPhone'))}</span>
            <span class="kv__value">${esc(vehicle.customer_phone ?? '—')}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('vehicles.notes'))}</span>
            <span class="kv__value">${esc(vehicle.notes ?? '—')}</span></div>
        </div>

        <label class="upload" for="vd-photo">
          ${icon('camera', { size: 22 })}
          <span class="grow">${esc(t('vehicles.replacePhoto'))}</span>
          <input id="vd-photo" type="file" accept="image/*" capture="environment" data-photo-input hidden>
        </label>

        <div class="stack stack--tight">
          <button class="btn btn--soft btn--block" type="button" data-edit>
            ${icon('wrench', { size: 17 })} ${esc(t('vehicles.editFile'))}
          </button>
          <button class="btn btn--soft btn--block" type="button" data-diagnose>
            ${icon('stethoscope', { size: 17 })} ${esc(t('vehicles.askDiagnostics'))}
          </button>
          <button class="btn btn--danger btn--block" type="button" data-delete>
            ${icon('trash', { size: 17 })} ${esc(t('vehicles.deleteFile'))}
          </button>
        </div>
      </div>`);

    main.querySelector('[data-diagnose]')?.addEventListener('click', () => {
      navigate(`/diagnostico?vehicle_id=${encodeURIComponent(vehicle.id)}`);
    });

    main.querySelector('[data-edit]')?.addEventListener('click', () =>
      openVehicleEditSheet(shop, vehicle, render),
    );

    main.querySelector('[data-photo-input]')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const label = main.querySelector('.upload');
      label?.classList.add('is-busy');
      try {
        const dataUrl = await readImage(file);
        await api.uploadVehiclePhoto(vehicle.id, { shop_id: shop.id, data_url: dataUrl });
        toast(t('vehicles.photoSaved'), 'ok');
        await render();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        label?.classList.remove('is-busy');
      }
    });

    main.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const confirmed = await confirmSheet({
        title: t('vehicles.deleteFile'),
        message: t('vehicles.deleteConfirm'),
        confirmLabel: t('vehicles.deleteFile'),
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.deleteVehicle(vehicle.id, shop.id);
        toast(t('vehicles.deleted'), 'ok');
        navigate('/vehiculos');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  };

  await render();
  return undefined;
}

function openVehicleEditSheet(shop, vehicle, onSaved) {
  sheet({
    title: t('vehicles.editFile'),
    body: `
      <form class="stack" novalidate>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="ve-plate">${esc(t('vehicles.plateOptional'))}</label>
            <input class="input" id="ve-plate" maxlength="10" value="${esc(vehicle.plate ?? '')}">
          </div>
          <div class="field">
            <label class="field__label" for="ve-year">${esc(t('vehicles.year'))}</label>
            <input class="input" id="ve-year" type="number" min="1900" max="2100" value="${esc(vehicle.year ?? '')}">
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="ve-make">${esc(t('vehicles.make'))}</label>
            <input class="input" id="ve-make" value="${esc(vehicle.make ?? '')}">
          </div>
          <div class="field">
            <label class="field__label" for="ve-model">${esc(t('vehicles.model'))}</label>
            <input class="input" id="ve-model" value="${esc(vehicle.model ?? '')}">
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="ve-version">${esc(t('vehicles.version'))}</label>
          <input class="input" id="ve-version" value="${esc(vehicle.version ?? '')}">
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="ve-customer">${esc(t('vehicles.customer'))}</label>
            <input class="input" id="ve-customer" value="${esc(vehicle.customer_name ?? '')}">
          </div>
          <div class="field">
            <label class="field__label" for="ve-phone">${esc(t('vehicles.customerPhone'))}</label>
            <input class="input" id="ve-phone" type="tel" value="${esc(vehicle.customer_phone ?? '')}">
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="ve-notes">${esc(t('vehicles.notes'))}</label>
          <textarea class="input" id="ve-notes">${esc(vehicle.notes ?? '')}</textarea>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">${esc(t('common.save'))}</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const errorBox = form.querySelector('[data-error]');
        errorBox.textContent = '';
        button.disabled = true;
        const value = (id) => form.querySelector(id).value.trim() || null;
        try {
          await api.updateVehicle(vehicle.id, {
            shop_id: shop.id,
            plate: value('#ve-plate'),
            make: value('#ve-make'),
            model: value('#ve-model'),
            version: value('#ve-version'),
            year: Number(form.querySelector('#ve-year').value) || null,
            customer_name: value('#ve-customer'),
            customer_phone: value('#ve-phone'),
            notes: value('#ve-notes'),
          });
          close();
          toast(t('vehicles.saved'), 'ok');
          await onSaved();
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}
