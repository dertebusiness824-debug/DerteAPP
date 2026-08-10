/** Urgencias: last-24h urgent calls + history (24h–60d). Owner-only panel. */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { setActiveShop, store } from '../store.js';
import { screen } from '../shell.js';
import { contactButtons, emptyState, esc, icon, skeletonList } from '../ui.js';

const TABS = () => [
  { key: 'active', label: t('urgencias.tabActive') },
  { key: 'history', label: t('urgencias.tabHistory') },
];

function resolveShop() {
  if (store.activeShop) return store.activeShop;
  if (store.shops?.[0]?.id) {
    setActiveShop(store.shops[0].id);
    return store.activeShop || store.shops[0];
  }
  return null;
}

function urgenciaCard(item) {
  const vehicle = item.vehicle?.label;
  const plate = item.vehicle?.plate;
  const reason = item.reason || item.summary || t('urgencias.noReason');
  return `
    <article class="list__item list__item--static" style="flex-direction:column;align-items:stretch;gap:12px"
             data-urgencia="${esc(item.id)}">
      <div class="row row--between" style="gap:8px;align-items:flex-start">
        <div class="grow" style="min-width:0">
          <div class="list__title truncate">${esc(item.customer_name || t('urgencias.unknownCaller'))}</div>
          <div class="list__meta truncate">${esc(item.customer_phone_display || item.customer_phone || '')}</div>
        </div>
        <div class="list__meta" style="white-space:nowrap;font-variant-numeric:tabular-nums">
          ${icon('clock', { size: 14 })} ${esc(item.called_time || item.called_local || '')}
        </div>
      </div>

      ${
        vehicle || plate
          ? `<div class="list__meta">
               ${icon('car', { size: 14 })}
               <strong>${esc(vehicle || '—')}</strong>
               ${plate ? ` · ${esc(plate)}` : ''}
             </div>`
          : ''
      }

      <div>
        <div class="list__meta" style="margin-bottom:4px">${esc(t('urgencias.reasonLabel'))}</div>
        <div style="font-size:15px;line-height:1.35;font-weight:550">${esc(reason)}</div>
      </div>

      ${
        item.summary && item.summary !== item.reason
          ? `<div class="list__meta" style="line-height:1.4">${esc(item.summary)}</div>`
          : ''
      }

      ${contactButtons({
        telLink: item.customer_tel_link,
        whatsappLink: item.customer_whatsapp_link,
        phoneDisplay: item.customer_phone_display,
        callPrimary: true,
      })}
    </article>`;
}

export async function urgenciasView({ query }) {
  const shop = resolveShop();
  let scope = query.get('tab') === 'history' ? 'history' : 'active';

  screen({
    title: t('urgencias.title'),
    subtitle: shop?.name || 'DerteApp',
    nav: 'urgencias',
    shopSwitcher: Boolean(shop),
    content: `
      <div class="stack" data-urgencias-shell>
        <p class="list__meta" style="margin:0">${esc(t('urgencias.subtitle'))}</p>
        <div class="chips" role="tablist" data-tablist>
          ${TABS()
            .map(
              (tab) =>
                `<button class="chip" role="tab" data-scope="${tab.key}" aria-pressed="${tab.key === scope}">${esc(tab.label)}</button>`,
            )
            .join('')}
        </div>
        <div data-list>${skeletonList(3)}</div>
      </div>`,
  });

  const main = document.querySelector('.main');
  const container = main.querySelector('[data-list]');

  const paintChips = () => {
    for (const chip of main.querySelectorAll('[data-scope]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.scope === scope));
    }
  };

  const paintList = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      container.innerHTML = emptyState(
        scope === 'history' ? t('urgencias.emptyHistory') : t('urgencias.emptyActive'),
        scope === 'history' ? t('urgencias.emptyHistoryHint') : t('urgencias.emptyActiveHint'),
        'phone',
      );
      return;
    }
    container.innerHTML = `<div class="list" data-urgencia-list style="gap:10px">
      ${list.map(urgenciaCard).join('')}
    </div>`;
  };

  const syncUrl = () => {
    const next = scope === 'history' ? '/urgencias?tab=history' : '/urgencias';
    if (`${location.pathname}${location.search}` !== next) {
      history.replaceState({}, '', next);
    }
  };

  const load = async () => {
    paintChips();
    syncUrl();
    if (!shop?.id) {
      paintList([]);
      return;
    }
    try {
      const result = await api.urgencias({ shop_id: shop.id, scope, limit: 100 });
      paintList(result?.urgencias);
    } catch (error) {
      console.error('[urgencias] load failed', error);
      paintList([]);
    }
  };

  main.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-scope]');
    if (chip) {
      const next = chip.dataset.scope === 'history' ? 'history' : 'active';
      if (next === scope) return;
      scope = next;
      void load();
    }
  });

  await load();

  const poll = setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, 60_000);

  return () => clearInterval(poll);
}
