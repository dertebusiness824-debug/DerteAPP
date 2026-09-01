/**
 * Year-end rendimiento opened from the 31 Dec push: «Consulta tu rendimiento anual».
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { screen, setContent } from '../shell.js';
import { emptyState, esc, icon, num, skeletonList } from '../ui.js';

function kpi(label, value) {
  return `
    <div class="year-summary__kpi">
      <div class="year-summary__kpi-value">${num(value)}</div>
      <div class="year-summary__kpi-label">${esc(label)}</div>
    </div>`;
}

function shopBlock(shop) {
  return `
    <div class="card">
      <div class="list__title">${esc(shop.shop_name)}</div>
      <div class="kv"><span class="kv__key">${esc(t('year.booked'))}</span><span class="kv__value">${num(shop.bookings_scheduled)}</span></div>
      <div class="kv"><span class="kv__key">${esc(t('year.completed'))}</span><span class="kv__value">${num(shop.bookings_completed)}</span></div>
      <div class="kv"><span class="kv__key">${esc(t('year.plates'))}</span><span class="kv__value">${num(shop.plate_lookups)}</span></div>
      <div class="kv"><span class="kv__key">${esc(t('year.diag'))}</span><span class="kv__value">${num(shop.diagnostic_queries)}</span></div>
    </div>`;
}

export async function yearSummaryView({ query }) {
  const year = Number(query?.get('year')) || new Date().getFullYear();

  screen({
    title: t('year.title'),
    back: '/',
    nav: 'home',
    content: skeletonList(3),
  });

  let summary;
  try {
    summary = await api.yearSummary(year);
  } catch (error) {
    setContent(emptyState(t('year.loadFailed'), error.message, 'chart'));
    return undefined;
  }

  const totals = summary.totals || {
    bookings_scheduled: 0,
    bookings_completed: 0,
    plate_lookups: 0,
    diagnostic_queries: 0,
  };

  setContent(`
    <div class="stack year-summary">
      <div class="card year-summary__hero">
        ${icon('chart', { size: 28 })}
        <h1 class="year-summary__thanks">${esc(summary.message || t('year.thanks'))}</h1>
        <p class="list__meta">${esc(t('year.subtitle', { year: summary.year }))}</p>
      </div>
      <div class="year-summary__grid">
        ${kpi(t('year.booked'), totals.bookings_scheduled)}
        ${kpi(t('year.completed'), totals.bookings_completed)}
        ${kpi(t('year.plates'), totals.plate_lookups)}
        ${kpi(t('year.diag'), totals.diagnostic_queries)}
      </div>
      ${
        (summary.shops || []).length > 1
          ? `<div class="section-title"><span>${esc(t('year.byShop'))}</span></div>
             ${summary.shops.map(shopBlock).join('')}`
          : ''
      }
    </div>`);

  return undefined;
}
