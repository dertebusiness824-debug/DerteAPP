/** Histórico Anual de Reservas — card for the shop dashboard. */
import { t } from '../i18n.js';
import { barChart, esc, num } from '../ui.js';

/**
 * Renders the annual booking history card (count + month chart + year filter).
 * @param {object} history — payload from `api.yearlyHistory`
 */
export function yearlyHistoryCard(history) {
  if (!history) return '';

  const yearOptions = (history.available_years || [history.year])
    .map(
      (year) =>
        `<option value="${year}" ${year === history.year ? 'selected' : ''}>${year}</option>`,
    )
    .join('');

  const monthChart = barChart(
    (history.months || []).map((point) => ({ label: point.label, value: point.count })),
  );

  return `
    <div class="card" data-yearly-history>
      <div class="row row--between" style="align-items:flex-start;gap:12px">
        <div class="grow">
          <div class="card__label">${esc(t('home.yearlyHistory'))}</div>
          <div class="stat__value" style="margin-top:4px">${num(history.total)}</div>
          <div class="list__meta">${esc(
            t('home.yearlyHistoryCount', { year: history.year, count: history.total }),
          )}</div>
        </div>
        <label class="field" style="margin:0;min-width:96px">
          <span class="sr-only">${esc(t('home.yearlyHistoryYear'))}</span>
          <select class="input" data-history-year aria-label="${esc(t('home.yearlyHistoryYear'))}">
            ${yearOptions}
          </select>
        </label>
      </div>
      ${
        monthChart
          ? `<div style="margin-top:12px">${monthChart}</div>`
          : `<p class="list__meta" style="margin-top:10px">${esc(t('home.yearlyHistoryEmpty'))}</p>`
      }
      <div class="kv" style="margin-top:10px">
        <span class="kv__key">${esc(t('status.completed'))}</span>
        <span class="kv__value">${num(history.breakdown?.completed ?? 0)}</span>
      </div>
      <div class="kv">
        <span class="kv__key">${esc(t('status.accepted'))}</span>
        <span class="kv__value">${num(history.breakdown?.accepted ?? 0)}</span>
      </div>
    </div>`;
}

/** Binds the year selector on a card rendered by `yearlyHistoryCard`. */
export function bindYearlyHistoryCard(root, onYearChange) {
  root?.querySelector('[data-history-year]')?.addEventListener('change', (event) => {
    const year = Number(event.target.value);
    onYearChange(Number.isFinite(year) ? year : undefined);
  });
}
