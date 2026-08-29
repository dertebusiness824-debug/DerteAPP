/**
 * Super Admin CLIENTES — platform sales leads from the Retell receptionist.
 * Layout mirrors the shop-owner Urgencias list: tabs, cards, call / WhatsApp.
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { refreshBadges, store } from '../store.js';
import { screen } from '../shell.js';
import { confirmSheet, contactButtons, emptyState, esc, icon, skeletonList, toast } from '../ui.js';
import { formatUrgenciaCanaryDateTime } from './urgencias.js';

const TABS = () => [
  { key: 'active', label: t('clientes.tabActive') },
  { key: 'history', label: t('clientes.tabHistory') },
];

function statusLine(item) {
  let label = t('clientes.statusPending');
  let modifier = 'urgencia-status--pending clientes-status--pending';
  if (item.status === 'contacted') {
    label = t('clientes.statusContacted');
    modifier = 'urgencia-status--accepted clientes-status--contacted';
  } else if (item.status === 'closed') {
    label = t('clientes.statusClosed');
    modifier = 'urgencia-status--cancelled clientes-status--closed';
  }
  return `<div class="urgencia-status ${modifier}">${esc(label)}</div>`;
}

function leadCard(item) {
  const name = item.customer_name || t('clientes.nameMissing');
  const shop = item.shop_name || t('clientes.shopMissing');
  const island = item.island || t('clientes.islandMissing');
  const whenLabel = formatUrgenciaCanaryDateTime(item) || '';
  const phoneDisplay = item.customer_phone_display || item.customer_phone;
  return `
    <article class="list__item list__item--static urgencia-card clientes-card" data-lead="${esc(item.id)}">
      <div class="urgencia-card__open">
        <div class="urgencia-card__head">
          <div class="grow urgencia-card__titles">
            <div class="list__title">${esc(name)}</div>
            ${statusLine(item)}
          </div>
          <div class="list__meta urgencia-card__when">
            ${icon('clock', { size: 14 })} ${esc(whenLabel)}
          </div>
        </div>
        <div class="urgencia-card__fields">
          <div class="kv"><span class="kv__key">${esc(t('clientes.fieldName'))}</span><span class="kv__value truncate">${esc(name)}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('clientes.fieldShop'))}</span><span class="kv__value truncate">${esc(shop)}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('clientes.fieldIsland'))}</span><span class="kv__value truncate">${esc(island)}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('clientes.fieldPhone'))}</span><span class="kv__value truncate">${esc(phoneDisplay || '—')}</span></div>
          ${
            item.summary
              ? `<div class="kv"><span class="kv__key">${esc(t('clientes.fieldSummary'))}</span><span class="kv__value">${esc(item.summary)}</span></div>`
              : ''
          }
        </div>
      </div>
      ${contactButtons({
        telLink: item.customer_tel_link,
        whatsappLink: item.customer_whatsapp_link,
        phoneDisplay: phoneDisplay ? `${t('clientes.call')} (${phoneDisplay})` : t('clientes.call'),
        callPrimary: true,
      })}
      ${
        item.status !== 'closed'
          ? `<div class="urgencia-card__actions">
              ${
                item.status === 'pending'
                  ? `<button class="btn btn--block" type="button" data-lead-contact="${esc(item.id)}">${esc(t('clientes.markContacted'))}</button>`
                  : ''
              }
              <button class="btn btn--soft btn--block" type="button" data-lead-close="${esc(item.id)}">${esc(t('clientes.markClosed'))}</button>
            </div>`
          : ''
      }
    </article>`;
}

export async function adminClientesView({ query }) {
  if (!store.isSuperAdmin) {
    navigate('/', { replace: true });
    return undefined;
  }

  let scope = query.get('tab') === 'history' ? 'history' : 'active';
  /** @type {Map<string, object>} */
  let byId = new Map();

  screen({
    title: t('nav.clientes'),
    nav: 'clientes',
    content: `
      <div class="stack" data-clientes-shell data-error-boundary>
        <p class="list__meta" style="margin:0">${esc(t('clientes.subtitle'))}</p>
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
    byId = new Map(list.map((row) => [row.id, row]));
    if (!list.length) {
      container.innerHTML = emptyState(
        scope === 'history' ? t('clientes.emptyHistory') : t('clientes.emptyActive'),
        scope === 'history' ? t('clientes.emptyHistoryHint') : t('clientes.emptyActiveHint'),
        'team',
      );
      return;
    }
    container.innerHTML = `<div class="list urgencia-list clientes-list">${list.map(leadCard).join('')}</div>`;
  };

  const syncUrl = () => {
    const next = scope === 'history' ? '/admin/clientes?tab=history' : '/admin/clientes';
    if (`${location.pathname}${location.search}` !== next) {
      history.replaceState({}, '', next);
    }
  };

  const load = async () => {
    paintChips();
    syncUrl();
    try {
      const payload = await api.adminClientes({ scope });
      store.unread = { ...store.unread, leads: Number(payload.pending) || 0 };
      paintList(payload.leads);
      void refreshBadges();
    } catch (error) {
      container.innerHTML = emptyState(t('clientes.loadFailed'), error.message, 'x');
    }
  };

  const setStatus = async (id, status) => {
    const lead = byId.get(id);
    if (!lead) return;
    if (status === 'closed') {
      const ok = await confirmSheet({
        title: t('clientes.closeTitle'),
        message: t('clientes.closeHint'),
        confirmLabel: t('clientes.markClosed'),
      });
      if (!ok) return;
    }
    try {
      await api.adminUpdateCliente(id, { status });
      toast(status === 'closed' ? t('clientes.closedToast') : t('clientes.contactedToast'), 'ok');
      await load();
    } catch (error) {
      toast(error.message || t('clientes.updateFailed'), 'error');
    }
  };

  main.addEventListener('click', (event) => {
    const contact = event.target.closest('[data-lead-contact]');
    if (contact) {
      event.preventDefault();
      void setStatus(contact.dataset.leadContact, 'contacted');
      return;
    }
    const close = event.target.closest('[data-lead-close]');
    if (close) {
      event.preventDefault();
      void setStatus(close.dataset.leadClose, 'closed');
      return;
    }
    const chip = event.target.closest('[data-scope]');
    if (chip) {
      const next = chip.dataset.scope === 'history' ? 'history' : 'active';
      if (next === scope) return;
      scope = next;
      void load();
    }
  });

  await load();
  return undefined;
}
