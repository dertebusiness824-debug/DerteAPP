/**
 * AI diagnostic assistant.
 *
 * The counter types what the customer reports — "¿Cuál es el motivo de la
 * consulta?" — and gets back the probable faults, ranked, each one with the
 * checks that confirm or rule it out. The vehicle box is optional but narrows
 * the answer, and it is prefilled when the screen is reached from a car file.
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { requireShop, screen } from '../shell.js';
import { ago, esc, icon, skeletonList, toast } from '../ui.js';

/** Common motives, so the field is never a blank page. */
const EXAMPLES = () => [
  t('diag.example.noStart'),
  t('diag.example.brakeNoise'),
  t('diag.example.overheat'),
  t('diag.example.warningLight'),
  t('diag.example.vibration'),
];

const SEVERITY_TONE = { alta: 'badge--danger', media: 'badge--warn', baja: 'badge--info' };

const severityBadge = (severity) => {
  const label = t(`diag.severity.${severity}`) || severity;
  return `<span class="badge ${SEVERITY_TONE[severity] ?? 'badge--info'}">${esc(label)}</span>`;
};

function causeHtml(cause, index) {
  const checks = (cause.checks ?? [])
    .map((check) => `<li>${esc(check)}</li>`)
    .join('');
  return `
    <article class="card diag-cause">
      <div class="row row--between diag-cause__head">
        <div class="grow">
          <div class="diag-cause__rank">${index + 1}</div>
          <h3 class="diag-cause__title">${esc(cause.title)}</h3>
        </div>
        ${severityBadge(cause.severity)}
      </div>
      ${
        cause.likelihood
          ? `<div class="diag-cause__meter" role="img"
                  aria-label="${esc(t('diag.likelihoodAria').replace('{n}', cause.likelihood))}">
               <span style="width:${Math.min(100, Math.max(4, cause.likelihood))}%"></span>
             </div>
             <div class="list__meta">${esc(t('diag.likelihood').replace('{n}', cause.likelihood))}</div>`
          : ''
      }
      ${cause.why ? `<p class="diag-cause__why">${esc(cause.why)}</p>` : ''}
      ${
        checks
          ? `<div class="diag-cause__checks">
               <div class="card__label">${esc(t('diag.checks'))}</div>
               <ul>${checks}</ul>
             </div>`
          : ''
      }
    </article>`;
}

/** Says plainly which engine answered — a mechanic should know. */
function providerNoteHtml(result) {
  if (result.provider === 'ai') {
    return `<div class="diag-provider">${icon('stethoscope', { size: 15 })}
      ${esc(t('diag.byModel').replace('{model}', result.model ?? 'IA'))}</div>`;
  }
  const reason = result.fallback_reason === 'ai_not_configured'
    ? t('diag.localOnly')
    : t('diag.localFallback');
  return `<div class="diag-provider diag-provider--local">${icon('wrench', { size: 15 })} ${esc(reason)}</div>`;
}

export async function diagnosticsView({ query }) {
  const shop = requireShop({ title: t('nav.diagnostics'), navKey: 'diagnostics' });
  if (!shop) return undefined;

  // A car file can hand us its vehicle, so the counter does not retype it.
  const prefill = {
    vehicleId: query.get('vehicle_id') ?? null,
    make: query.get('make') ?? '',
    model: query.get('model') ?? '',
    year: query.get('year') ?? '',
    fuel: query.get('fuel') ?? '',
  };

  screen({
    title: t('nav.diagnostics'),
    nav: 'diagnostics',
    shopSwitcher: true,
    content: `
      <div class="stack">
        <form class="card diag-ask" data-diag-form novalidate>
          <label class="diag-ask__label" for="diag-prompt">${esc(t('diag.question'))}</label>
          <textarea class="input diag-ask__input" id="diag-prompt" rows="3" required
                    maxlength="1200" placeholder="${esc(t('diag.placeholder'))}"></textarea>

          <details class="diag-ask__vehicle"${
            prefill.make || prefill.model || prefill.vehicleId ? ' open' : ''
          }>
            <summary>${esc(t('diag.vehicleOptional'))}</summary>
            <div class="grid-2">
              <div class="field">
                <label class="field__label" for="diag-make">${esc(t('vehicles.make'))}</label>
                <input class="input" id="diag-make" value="${esc(prefill.make)}" autocomplete="off">
              </div>
              <div class="field">
                <label class="field__label" for="diag-model">${esc(t('vehicles.model'))}</label>
                <input class="input" id="diag-model" value="${esc(prefill.model)}" autocomplete="off">
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="field__label" for="diag-year">${esc(t('vehicles.year'))}</label>
                <input class="input" id="diag-year" type="number" min="1900" max="2100"
                       inputmode="numeric" value="${esc(prefill.year)}">
              </div>
              <div class="field">
                <label class="field__label" for="diag-fuel">${esc(t('vehicles.spec.fuel'))}</label>
                <input class="input" id="diag-fuel" value="${esc(prefill.fuel)}" autocomplete="off"
                       placeholder="${esc(t('diag.fuelPlaceholder'))}">
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="diag-km">${esc(t('diag.mileage'))}</label>
              <input class="input" id="diag-km" type="number" min="0" max="2000000" inputmode="numeric">
            </div>
          </details>

          <button class="btn btn--block" type="submit" data-submit>
            ${icon('stethoscope', { size: 17 })} ${esc(t('diag.submit'))}
          </button>
          <div class="field__error" data-error role="alert"></div>
        </form>

        <div class="chips" data-examples>
          ${EXAMPLES()
            .map((example) => `<button class="chip" type="button" data-example="${esc(example)}">${esc(example)}</button>`)
            .join('')}
        </div>

        <div data-result></div>

        <div class="section-title"><span>${esc(t('diag.historyTitle'))}</span></div>
        <div data-history>${skeletonList(2)}</div>
      </div>`,
  });

  const main = document.querySelector('.main');
  const form = main.querySelector('[data-diag-form]');
  const promptField = form.querySelector('#diag-prompt');
  const errorBox = form.querySelector('[data-error]');
  const resultBox = main.querySelector('[data-result]');
  const historyBox = main.querySelector('[data-history]');

  const loadHistory = async () => {
    try {
      const { queries } = await api.diagnosticHistory({ shop_id: shop.id, limit: 10 });
      historyBox.innerHTML = queries.length
        ? `<div class="list">${queries
            .map(
              (entry) => `
                <button class="list__item" type="button" data-history-entry="${esc(entry.id)}">
                  ${icon('stethoscope', { size: 18 })}
                  <div class="grow">
                    <div class="list__title truncate">${esc(entry.prompt)}</div>
                    <div class="list__meta truncate">
                      ${esc([entry.vehicle_label, ago(entry.created_at)].filter(Boolean).join(' · '))}
                      · ${esc(t('diag.causeCount').replace('{n}', (entry.causes ?? []).length))}
                    </div>
                  </div>
                  ${icon('chevron', { size: 18, className: 'chev' })}
                </button>`,
            )
            .join('')}</div>`
        : `<div class="card card--flat"><p class="list__meta">${esc(t('diag.historyEmpty'))}</p></div>`;

      historyBox.dataset.loaded = '1';
      historyBox._queries = queries;
    } catch {
      historyBox.innerHTML = `<div class="card card--flat"><p class="list__meta">${esc(t('diag.historyFailed'))}</p></div>`;
    }
  };

  const paintResult = (result) => {
    if (!result?.causes?.length) {
      resultBox.innerHTML = `
        <div class="card card--flat">
          <p class="list__meta">${esc(t('diag.noCauses'))}</p>
        </div>`;
      return;
    }
    resultBox.innerHTML = `
      <div class="section-title"><span>${esc(t('diag.resultTitle'))}</span></div>
      ${providerNoteHtml(result)}
      ${
        result.vehicle_label
          ? `<div class="list__meta diag-result__vehicle">${esc(result.vehicle_label)}</div>`
          : ''
      }
      <div class="stack stack--tight">${result.causes.map(causeHtml).join('')}</div>
      <p class="list__meta diag-disclaimer">${esc(t('diag.disclaimer'))}</p>`;
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    const prompt = promptField.value.trim();
    if (prompt.length < 4) {
      errorBox.textContent = t('diag.promptTooShort');
      promptField.focus();
      return;
    }

    const button = form.querySelector('[data-submit]');
    button.disabled = true;
    resultBox.innerHTML = skeletonList(3);

    const value = (id) => form.querySelector(id).value.trim() || undefined;
    try {
      const result = await api.diagnose({
        shop_id: shop.id,
        prompt,
        vehicle_id: prefill.vehicleId || undefined,
        make: value('#diag-make'),
        model: value('#diag-model'),
        year: value('#diag-year'),
        fuel: value('#diag-fuel'),
        mileage_km: value('#diag-km'),
      });
      paintResult(result);
      await loadHistory();
    } catch (error) {
      resultBox.innerHTML = '';
      errorBox.textContent = error.message;
      toast(t('diag.failed'), 'error');
    } finally {
      button.disabled = false;
    }
  });

  main.addEventListener('click', (event) => {
    const example = event.target.closest('[data-example]');
    if (example) {
      promptField.value = example.dataset.example;
      promptField.focus();
      return;
    }

    const entry = event.target.closest('[data-history-entry]');
    if (entry) {
      const saved = (historyBox._queries ?? []).find((item) => item.id === entry.dataset.historyEntry);
      if (!saved) return;
      promptField.value = saved.prompt;
      paintResult({
        provider: saved.provider,
        model: saved.model,
        causes: saved.causes ?? [],
        vehicle_label: saved.vehicle_label,
      });
    }
  });

  const askedFromUrl = query.get('q');
  if (askedFromUrl) {
    promptField.value = askedFromUrl;
    form.requestSubmit();
  }

  await loadHistory();
  return undefined;
}
