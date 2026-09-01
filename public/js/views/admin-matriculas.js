/**
 * Super Admin official plate lookup (APIVehículo).
 *
 * Shop owners never reach this screen: the /admin guard redirects them home,
 * and the API refuses any role that is not super_admin.
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { createPlateLookupGuard, officialLookupSpent, setSubmitBusy } from '../plate-lookup-guard.js';
import { navigate } from '../router.js';
import { screen, setContent } from '../shell.js';
import { store } from '../store.js';
import { emptyState, esc, icon, sheet, skeletonList, toast } from '../ui.js';
import { vehicleCardHtml } from './vehicles.js';

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t('vehicles.photoReadFailed')));
    reader.readAsDataURL(file);
  });
}

const historyRow = (row) => `
  <div class="list__item list__item--static">
    <div class="grow">
      <div class="row row--between">
        <span class="plate" style="font-size:13px">${esc(row.plate)}</span>
        <span class="badge ${row.found ? 'badge--ok' : 'badge--warn'}">${row.found ? 'Encontrada' : 'Sin registro'}</span>
      </div>
      <div class="list__meta">
        ${esc([row.make, row.model].filter(Boolean).join(' ') || row.reason || '—')}
      </div>
    </div>
  </div>`;

export async function adminMatriculasView() {
  if (!store.isSuperAdmin) {
    navigate('/');
    return undefined;
  }

  screen({
    title: t('nav.matriculas'),
    nav: 'shops',
    content: skeletonList(3),
  });

  let status;
  try {
    status = await api.adminApivehiculoStatus();
  } catch (error) {
    setContent(emptyState('No se pudo abrir la consulta de matrículas', error.message, 'inspect'));
    return undefined;
  }

  const shops = store.shops ?? [];

  const main = setContent(`
    <div class="stack">
      <div class="card card--flat">
        <div class="section-title section-title--flush"><span>Registro oficial de matrículas</span></div>
        <p class="list__meta" style="margin:0 0 12px">
          Consulta APIVehículo y rellena marca, modelo exacto, año y ficha técnica.
          La clave vive en el servidor; los talleres identifican vehículos sin verla.
        </p>
        ${
          status.configured
            ? `<div class="list__meta">Proveedor ${esc(status.provider)} · ${esc(String(status.lookups_today))} consultas hoy</div>`
            : `<div class="banner banner--warn">
                 ${esc(t('sa.apivehiculoMissing'))}
               </div>`
        }

        <form class="stack" data-plate-form novalidate style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="sa-plate">Matrícula</label>
            <input class="input input--plate" id="sa-plate" name="plate" maxlength="12" autocomplete="off"
                   placeholder="1234 BCD" required>
          </div>
          <div class="field">
            <label class="field__label" for="sa-shop">Guardar en el taller (opcional)</label>
            <select class="input" id="sa-shop">
              <option value="">Solo consultar, no guardar</option>
              ${shops
                .map((shop) => `<option value="${esc(shop.id)}">${esc(shop.name)}</option>`)
                .join('')}
            </select>
          </div>
          <button class="btn btn--block" type="submit" data-submit data-plate-submit ${status.configured ? '' : 'disabled'}>
            ${icon('inspect', { size: 17 })} Consultar registro oficial
          </button>
          <label class="btn btn--soft btn--block${status.configured ? '' : ' is-hidden'}" for="sa-photo">
            ${icon('camera', { size: 17 })} Leer matrícula de una foto
            <input id="sa-photo" type="file" accept="image/*" capture="environment" hidden>
          </label>
          <div class="field__error" data-error role="alert"></div>
        </form>
      </div>

      <div data-result></div>

      <div class="section-title"><span>Consultas recientes</span></div>
      <div data-history>
        ${
          status.history?.length
            ? `<div class="list">${status.history.map(historyRow).join('')}</div>`
            : `<p class="list__meta">Todavía no hay consultas al registro oficial.</p>`
        }
      </div>
    </div>`);

  const form = main.querySelector('[data-plate-form]');
  const errorBox = main.querySelector('[data-error]');
  const resultBox = main.querySelector('[data-result]');
  const historyBox = main.querySelector('[data-history]');
  const plateInput = main.querySelector('#sa-plate');
  const shopSelect = main.querySelector('#sa-shop');
  const submit = main.querySelector('[data-submit]');

  const paintHistory = (rows) => {
    historyBox.innerHTML = rows?.length
      ? `<div class="list">${rows.map(historyRow).join('')}</div>`
      : `<p class="list__meta">Todavía no hay consultas al registro oficial.</p>`;
  };

  const plateGuard = createPlateLookupGuard();

  const lookup = async ({ plate }) => {
    errorBox.textContent = '';
    if (!status.configured) {
      errorBox.textContent = t('sa.apivehiculoMissing');
      toast('La consulta oficial no está configurada', 'error');
      return;
    }
    const gate = plateGuard.begin(plate);
    if (!gate.ok) {
      if (gate.reason === 'empty') errorBox.textContent = t('vehicles.plateInvalid');
      else if (gate.reason === 'already_consulted') {
        errorBox.textContent = t('vehicles.plateAlreadyConsulted');
        toast(t('vehicles.plateAlreadyConsulted'), 'warn');
      }
      return;
    }

    setSubmitBusy(submit, true);
    resultBox.innerHTML = skeletonList(1);
    const shopId = shopSelect.value || undefined;
    let spent = false;
    try {
      const payload = await api.adminLookupPlate({
        plate: plate || undefined,
        shop_id: shopId,
        save: Boolean(shopId),
      });
      if (payload.plate?.display) plateInput.value = payload.plate.display;
      spent = officialLookupSpent(payload.reason, payload.found);
      if (!payload.found || !payload.vehicle) {
        resultBox.innerHTML = `
          <div class="card card--flat">
            <div class="list__title">${esc(payload.message || 'Esa matrícula no aparece en el registro oficial.')}</div>
          </div>`;
        toast(payload.message || 'Matrícula sin coincidencias', 'error');
      } else {
        resultBox.innerHTML = `
          ${vehicleCardHtml(payload.vehicle, { source: 'apivehiculo', confidence: payload.vehicle.confidence })}
          ${
            payload.saved
              ? `<p class="list__meta">Guardado en ${esc(shops.find((shop) => shop.id === shopId)?.name ?? 'el taller')}.</p>`
              : shopId
                ? ''
                : `<p class="list__meta">Elige un taller arriba y vuelve a consultar para darlo de alta.</p>`
          }`;
        toast(payload.saved ? 'Vehículo consultado y guardado' : 'Ficha oficial cargada', 'ok');
      }
      const refreshed = await api.adminApivehiculoStatus();
      paintHistory(refreshed.history);
    } catch (error) {
      resultBox.innerHTML = '';
      errorBox.textContent = error.message;
      toast(error.message, 'error');
    } finally {
      plateGuard.settle(spent, gate.plate);
      setSubmitBusy(submit, false);
      if (!status.configured) submit.disabled = true;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void lookup({ plate: plateInput.value.trim() });
  });

  plateInput.addEventListener('input', () => plateGuard.markEdited(plateInput.value));

  // Photo only OCRs the plate into the field. Official lookup waits for Consultar.
  main.querySelector('#sa-photo')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readImage(file);
      const payload = await api.adminLookupPlate({
        data_url: dataUrl,
        ocr_only: true,
      });
      const readPlate = payload.plate?.display || payload.plate?.plate;
      if (readPlate) {
        plateInput.value = readPlate;
        plateGuard.markEdited(readPlate);
      }
      toast(payload.message || t('sa.plateOcrHint'), readPlate ? 'ok' : 'warn');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/** Compact sheet used from the shop directory to fill one tenant's file. */
export function openShopPlateSheet({ shopId, shopName }) {
  sheet({
    title: `Matrícula · ${shopName}`,
    body: `
      <form class="stack" data-form novalidate>
        <p class="list__meta" style="margin:0">
          Consulta el registro oficial y guarda la ficha técnica en este taller.
        </p>
        <div class="field">
          <label class="field__label" for="sheet-plate">Matrícula</label>
          <input class="input input--plate" id="sheet-plate" maxlength="12" autocomplete="off"
                 placeholder="1234 BCD" required>
        </div>
        <button class="btn btn--block" type="submit">Consultar y guardar</button>
        <div class="field__error" data-error role="alert"></div>
        <div data-sheet-result></div>
      </form>`,
    onMount(content) {
      const form = content.querySelector('[data-form]');
      const errorBox = content.querySelector('[data-error]');
      const resultBox = content.querySelector('[data-sheet-result]');
      const plateInput = content.querySelector('#sheet-plate');
      const button = form.querySelector('button[type="submit"]');
      const plateGuard = createPlateLookupGuard();
      plateInput.addEventListener('input', () => plateGuard.markEdited(plateInput.value));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const gate = plateGuard.begin(plateInput.value);
        if (!gate.ok) {
          if (gate.reason === 'empty') errorBox.textContent = t('vehicles.plateInvalid');
          else if (gate.reason === 'already_consulted') {
            errorBox.textContent = t('vehicles.plateAlreadyConsulted');
            toast(t('vehicles.plateAlreadyConsulted'), 'warn');
          }
          return;
        }
        setSubmitBusy(button, true);
        errorBox.textContent = '';
        resultBox.innerHTML = skeletonList(1);
        let spent = false;
        try {
          const payload = await api.adminLookupPlate({
            plate: plateInput.value.trim(),
            shop_id: shopId,
            save: true,
          });
          spent = officialLookupSpent(payload.reason, payload.found);
          if (!payload.found || !payload.vehicle) {
            resultBox.innerHTML = `<p class="list__meta">${esc(payload.message || 'Sin registro.')}</p>`;
            toast(payload.message || 'Matrícula sin coincidencias', 'error');
          } else {
              resultBox.innerHTML = vehicleCardHtml(payload.vehicle, {
                source: 'apivehiculo',
                confidence: payload.vehicle.confidence,
              });
            toast(`Guardado en ${shopName}`, 'ok');
          }
        } catch (error) {
          resultBox.innerHTML = '';
          errorBox.textContent = error.message;
          toast(error.message, 'error');
        } finally {
          plateGuard.settle(spent, gate.plate);
          setSubmitBusy(button, false);
        }
      });
    },
  });
}
