/**
 * Super Admin Consultas: monthly official plate lookups per shop / user,
 * plus the cumulative annual history closed on 31 Dec 18:00 peninsular.
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { screen, setContent } from '../shell.js';
import { emptyState, esc, icon, num, skeletonList } from '../ui.js';

const shopCard = (shop) => `
  <div class="card consultas-shop">
    <div class="row row--between" style="align-items:flex-start;gap:10px">
      <div class="grow">
        <div class="list__title">${esc(shop.shop_name || t('sa.consultasNoShop'))}</div>
        <div class="list__meta">${esc(t('sa.consultasShopTotal'))}</div>
      </div>
      <div class="stat__value">${num(shop.lookups)}</div>
    </div>
    ${
      shop.users?.length
        ? `<div class="consultas-users">
             ${shop.users
               .map(
                 (user) => `
                   <div class="kv">
                     <span class="kv__key">${esc(user.user_name)}</span>
                     <span class="kv__value">${num(user.lookups)}</span>
                   </div>`,
               )
               .join('')}
           </div>`
        : ''
    }
  </div>`;

const annualRow = (shop) => `
  <div class="list__item list__item--static consultas-annual-row">
    <div class="grow">
      <div class="list__title">${esc(shop.shop_name)}</div>
      <div class="list__meta">
        ${esc(t('sa.consultasBooked'))}: ${num(shop.bookings_scheduled)}
        · ${esc(t('sa.consultasCompleted'))}: ${num(shop.bookings_completed)}
        · ${esc(t('sa.consultasPlates'))}: ${num(shop.plate_lookups)}
        · ${esc(t('sa.consultasDiag'))}: ${num(shop.diagnostic_queries)}
      </div>
    </div>
    ${
      shop.closed
        ? `<span class="badge badge--ok">${esc(t('sa.consultasClosed'))}</span>`
        : `<span class="badge">${esc(t('sa.consultasLive'))}</span>`
    }
  </div>`;

export async function adminConsultasView({ query }) {
  const now = new Date();
  const year = Number(query?.get('year')) || now.getFullYear();
  const monthParam = query?.get('month');
  const month = monthParam === 'all' || monthParam === '' ? null : Number(monthParam || now.getMonth() + 1);
  const tab = query?.get('tab') === 'annual' ? 'annual' : 'month';

  screen({
    title: t('nav.consultas'),
    nav: 'consultas',
    content: skeletonList(4),
  });

  let monthly;
  let annual;
  try {
    [monthly, annual] = await Promise.all([
      api.adminConsultas({ year, month: tab === 'month' ? month : undefined }),
      api.adminConsultasAnnual({ year }),
    ]);
  } catch (error) {
    setContent(emptyState(t('sa.consultasLoadFailed'), error.message, 'inspect'));
    return undefined;
  }

  const years = monthly.available_years?.length ? monthly.available_years : [year];
  const months = monthly.months ?? [];

  const main = setContent(`
    <div class="stack consultas-page">
      <div class="segmented" role="tablist">
        <button type="button" role="tab" data-consultas-tab="month" aria-pressed="${tab === 'month'}">${esc(t('sa.consultasTabMonth'))}</button>
        <button type="button" role="tab" data-consultas-tab="annual" aria-pressed="${tab === 'annual'}">${esc(t('sa.consultasTabAnnual'))}</button>
      </div>
      <p class="list__meta" style="margin:0">${esc(t('sa.consultasHint'))}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <label class="field" style="margin:0;min-width:96px">
          <span class="sr-only">${esc(t('sa.consultasYear'))}</span>
          <select class="input" data-consultas-year>
            ${years.map((item) => `<option value="${item}" ${item === year ? 'selected' : ''}>${item}</option>`).join('')}
          </select>
        </label>
        ${
          tab === 'month'
            ? `<label class="field" style="margin:0;min-width:120px">
                 <span class="sr-only">${esc(t('sa.consultasMonth'))}</span>
                 <select class="input" data-consultas-month>
                   ${months
                     .map(
                       (item) =>
                         `<option value="${item.month}" ${item.month === month ? 'selected' : ''}>${esc(item.label)}</option>`,
                     )
                     .join('')}
                 </select>
               </label>`
            : ''
        }
      </div>
      ${
        tab === 'month'
          ? `<div class="banner">
               ${icon('inspect', { size: 18 })}
               <div>
                 <strong>${num(monthly.total_lookups)}</strong>
                 ${esc(t('sa.consultasMonthTotal', { period: monthly.month_label, year: monthly.year }))}
               </div>
             </div>
             ${
               monthly.shops.length
                 ? monthly.shops.map(shopCard).join('')
                 : emptyState(t('sa.consultasEmpty'), t('sa.consultasEmptyHint'), 'inspect')
             }
             ${
               monthly.unassigned?.length
                 ? `<div class="section-title"><span>${esc(t('sa.consultasUnassigned'))}</span></div>
                    ${shopCard({ shop_name: t('sa.consultasNoShop'), lookups: monthly.unassigned.reduce((sum, row) => sum + row.lookups, 0), users: monthly.unassigned })}`
                 : ''
             }`
          : `<div class="list">
               ${
                 annual.shops.length
                   ? annual.shops.map(annualRow).join('')
                   : emptyState(t('sa.consultasAnnualEmpty'), t('sa.consultasEmptyHint'), 'inspect')
               }
             </div>`
      }
    </div>`);

  const go = (next) => {
    const params = new URLSearchParams();
    params.set('tab', next.tab ?? tab);
    params.set('year', String(next.year ?? year));
    if ((next.tab ?? tab) === 'month') params.set('month', String(next.month ?? month ?? ''));
    navigate(`/admin/consultas?${params}`, { replace: true });
  };

  for (const button of main.querySelectorAll('[data-consultas-tab]')) {
    button.addEventListener('click', () => go({ tab: button.dataset.consultasTab }));
  }
  main.querySelector('[data-consultas-year]')?.addEventListener('change', (event) => {
    go({ year: Number(event.target.value) });
  });
  main.querySelector('[data-consultas-month]')?.addEventListener('change', (event) => {
    go({ month: Number(event.target.value) });
  });

  return undefined;
}
