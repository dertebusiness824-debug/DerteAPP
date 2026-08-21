/** Urgencias: last-24h urgent calls + history (24h–60d). Owner panel + detail accept. */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { setActiveShop, store, refreshBadges } from '../store.js';
import { screen, setContent } from '../shell.js';
import { contactButtons, confirmSheet, emptyState, esc, icon, sheet, skeletonList, toast } from '../ui.js';

/** Canarias timezone for urgencia card timestamps. */
const CANARY_TZ = 'Atlantic/Canary';

const TABS = () => [
  { key: 'active', label: t('urgencias.tabActive') },
  { key: 'history', label: t('urgencias.tabHistory') },
];

/**
 * Full date + 24h time in Atlantic/Canary, e.g. "20/08/2026 16:01".
 * Always rebuilds from ISO timestamps so English labels like "Thu 20 Aug" never show.
 */
export function formatUrgenciaCanaryDateTime(solicitud = {}) {
  const raw = solicitud.created_at || solicitud.called_at || null;
  if (!raw) {
    if (solicitud.called_local && /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(solicitud.called_local)) {
      return solicitud.called_local;
    }
    return '';
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';

  return date
    .toLocaleString('es-ES', {
      timeZone: CANARY_TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(/\s*,\s*/g, ' ');
}

/** Replace Retell placeholders ("The user", "Sin nombre", …) for card display. */
export function formatUrgenciaCustomerDisplayName(name) {
  const text = String(name ?? '').trim();
  if (!text) return 'Cliente por confirmar';
  if (/^sin nombre$/i.test(text)) return 'Cliente por confirmar';
  if (/^cliente por confirmar$/i.test(text)) return 'Cliente por confirmar';
  if (/^llamada telef[oó]nica$/i.test(text)) return 'Llamada telefónica';
  if (/^(the\s+)?user$/i.test(text)) return 'Cliente por confirmar';
  if (/^the user\b/i.test(text) && !/,/.test(text)) return 'Cliente por confirmar';
  if (/^caller(\s*\+?\d.*)?$/i.test(text)) return 'Cliente por confirmar';
  if (/^unknown(\s+caller)?$/i.test(text)) return 'Cliente por confirmar';
  if (/^cliente$/i.test(text)) return 'Cliente por confirmar';
  return text;
}

/**
 * Clean Spanglish call summaries using vehicle + motivo fields.
 * Always uses a name-free template to avoid "El cliente El cliente…".
 */
export function formatUrgenciaDisplaySummary(solicitud = {}) {
  const vehicle =
    solicitud.vehicle?.label ||
    [solicitud.vehicle?.make, solicitud.vehicle?.model].filter(Boolean).join(' ') ||
    null;
  const reason = solicitud.reason || null;
  const summary = String(solicitud.summary || '');
  const genericReason =
    !reason ||
    /^(consulta urgente|consulta sobre aver[ií]a|no especificado)$/i.test(String(reason).trim());
  const dirty =
    !summary.trim() ||
    /\b(the user|called|brakes|coche make|due to|appointment|vehicle|engine|breakdown|request)\b/i.test(
      summary,
    ) ||
    /El cliente\s+El cliente/i.test(summary) ||
    /El cliente .+ llamó solicitando/i.test(summary) ||
    /El cliente llamó solicitando/i.test(summary) ||
    /Motivo:\s*(Consulta urgente|Consulta sobre aver[ií]a)/i.test(summary);

  if (dirty) {
    const veh = vehicle && vehicle !== 'Sin vehículo' ? vehicle : 'No especificado';
    const motivo = !genericReason ? String(reason).trim() : 'No especificado';
    return `El cliente solicitó atención urgente para su vehículo (${veh}). Motivo: ${motivo}.`;
  }
  return summary.trim().replace(/^(El cliente\s+)+/i, 'El cliente ');
}

/** Prefer real motivo over generic placeholders on cards. */
export function formatUrgenciaDisplayReason(solicitud = {}) {
  const reason = String(solicitud.reason || '').trim();
  if (
    reason &&
    !/^(consulta urgente|consulta sobre aver[ií]a|no especificado)$/i.test(reason)
  ) {
    return reason;
  }
  const summary = formatUrgenciaDisplaySummary(solicitud);
  const match = String(summary || '').match(/Motivo:\s*(.+?)\.?\s*$/i);
  const fromSummary = match?.[1]?.trim();
  if (
    fromSummary &&
    !/^(consulta urgente|consulta sobre aver[ií]a|no especificado)$/i.test(fromSummary)
  ) {
    return fromSummary;
  }
  return 'No especificado';
}

function resolveShop() {
  if (store.activeShop) return store.activeShop;
  if (store.shops?.[0]?.id) {
    setActiveShop(store.shops[0].id);
    return store.activeShop || store.shops[0];
  }
  return null;
}

function statusLine(item) {
  let label = t('urgencias.statusPending');
  let modifier = 'urgencia-status--pending';
  if (item.status === 'accepted') {
    label = t('urgencias.statusAccepted');
    modifier = 'urgencia-status--accepted';
  } else if (item.status === 'cancelled') {
    label = t('urgencias.statusCancelled');
    modifier = 'urgencia-status--cancelled';
  }
  return `<div class="urgencia-status ${modifier}">${esc(label)}</div>`;
}

/** YYYY-MM-DD from an ISO timestamp or shop-local called_date. */
function dateInputValue(isoOrDate) {
  if (!isoOrDate) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(isoOrDate))) return String(isoOrDate);
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultTimeValue() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

/**
 * Bottom sheet: Date + Time pickers. Min date = call day (or today if later).
 * Resolves `{ scheduled_date, scheduled_time }` or null if cancelled.
 */
export function openAcceptBookingSheet(urgencia) {
  const callDate = dateInputValue(urgencia.called_date || urgencia.called_at) || todayInputValue();
  const today = todayInputValue();
  const minDate = callDate && callDate > today ? callDate : callDate || today;
  const defaultDate = today >= minDate ? today : minDate;

  return new Promise((resolve) => {
    let result = null;
    sheet({
      title: t('urgencias.acceptTitle'),
      body: `
        <div class="stack">
          <p class="list__meta" style="margin:0">${esc(t('urgencias.acceptHint'))}</p>
          <div class="field">
            <label class="field__label" for="urgencia-accept-date">${esc(t('urgencias.acceptDate'))}</label>
            <input class="input" type="date" id="urgencia-accept-date" data-accept-date
                   min="${esc(minDate)}" value="${esc(defaultDate)}" required>
            <span class="field__hint">${esc(t('urgencias.acceptMinDateHint', { date: minDate }))}</span>
          </div>
          <div class="field">
            <label class="field__label" for="urgencia-accept-time">${esc(t('urgencias.acceptTime'))}</label>
            <input class="input" type="time" id="urgencia-accept-time" data-accept-time
                   value="${esc(defaultTimeValue())}" required step="300">
          </div>
          <button class="btn btn--block" type="button" data-accept-confirm>${esc(t('urgencias.acceptConfirm'))}</button>
          <button class="btn btn--soft btn--block" type="button" data-accept-cancel>${esc(t('common.cancel'))}</button>
        </div>`,
      onMount(content, close) {
        content.querySelector('[data-accept-cancel]')?.addEventListener('click', () => close());
        content.querySelector('[data-accept-confirm]')?.addEventListener('click', () => {
          const dateEl = content.querySelector('[data-accept-date]');
          const timeEl = content.querySelector('[data-accept-time]');
          const scheduled_date = String(dateEl?.value || '').trim();
          const scheduled_time = String(timeEl?.value || '').trim();
          if (!scheduled_date || !scheduled_time) {
            toast(t('urgencias.acceptNeedSlot'), 'warn');
            return;
          }
          if (scheduled_date < minDate) {
            toast(t('urgencias.acceptMinDateHint', { date: minDate }), 'warn');
            return;
          }
          result = { scheduled_date, scheduled_time };
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}

async function acceptUrgenciaFlow(urgencia, shop, { onAccepted } = {}) {
  const slot = await openAcceptBookingSheet(urgencia);
  if (!slot) return null;

  const result = await api.acceptUrgencia(urgencia.id, {
    shop_id: shop.id,
    scheduled_date: slot.scheduled_date,
    scheduled_time: slot.scheduled_time,
  });

  toast(
    result?.already_accepted ? t('urgencias.alreadyAccepted') : t('urgencias.acceptToast'),
    'ok',
  );
  await refreshBadges();
  onAccepted?.(result);
  return result;
}

async function cancelUrgenciaFlow(urgencia, shop, { onCancelled } = {}) {
  const confirmed = await confirmSheet({
    title: t('urgencias.cancelTitle'),
    message: t('urgencias.cancelHint'),
    confirmLabel: t('urgencias.cancelConfirm'),
    danger: true,
  });
  if (!confirmed) return null;

  const result = await api.cancelUrgencia(urgencia.id, { shop_id: shop.id });
  toast(
    result?.already_cancelled ? t('urgencias.alreadyCancelled') : t('urgencias.cancelToast'),
    'ok',
  );
  await refreshBadges();
  onCancelled?.(result);
  return result;
}

function urgenciaCard(item) {
  const title = item.title || t('urgencias.requestTitle');
  const vehicle = item.vehicle?.label;
  const plate = item.vehicle?.plate;
  const customerName = formatUrgenciaCustomerDisplayName(item.customer_name);
  const displaySummary = formatUrgenciaDisplaySummary(item);
  const reason = formatUrgenciaDisplayReason(item);
  const canAccept = item.can_accept !== false && item.status === 'pending';
  const canCancel = item.can_cancel !== false && item.status === 'pending';
  const whenLabel = formatUrgenciaCanaryDateTime(item) || item.called_local || item.called_time || '';
  return `
    <article class="list__item list__item--static urgencia-card" style="flex-direction:column;align-items:stretch;gap:10px"
             data-urgencia="${esc(item.id)}">
      <button class="urgencia-card__open" type="button" data-urgencia-open="${esc(item.id)}">
        <div class="urgencia-card__head">
          <div class="grow" style="min-width:0">
            <div class="list__title">${esc(title)}</div>
            ${statusLine(item)}
          </div>
          <div class="list__meta urgencia-card__when" style="white-space:nowrap;font-variant-numeric:tabular-nums">
            ${icon('clock', { size: 14 })} ${esc(whenLabel)}
          </div>
        </div>

        <div class="urgencia-card__fields">
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldName'))}</span><span class="kv__value truncate">${esc(customerName)}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldPhone'))}</span><span class="kv__value truncate">${esc(item.customer_phone_display || item.customer_phone || '—')}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldVehicle'))}</span><span class="kv__value truncate">${esc(vehicle || '—')}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldPlate'))}</span><span class="kv__value" style="font-family:var(--mono)">${esc(plate || '—')}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.reasonLabel'))}</span><span class="kv__value">${esc(reason)}</span></div>
        </div>
      </button>

      ${contactButtons({
        telLink: item.customer_tel_link,
        whatsappLink: item.customer_whatsapp_link,
        phoneDisplay: item.customer_phone_display,
        callPrimary: true,
      })}

      ${
        canAccept || canCancel
          ? `<div class="urgencia-card__actions">
              ${
                canAccept
                  ? `<button class="btn btn--block" type="button" data-accept-card="${esc(item.id)}">${esc(t('urgencias.acceptCta'))}</button>`
                  : ''
              }
              ${
                canCancel
                  ? `<button class="btn btn--danger btn--block" type="button" data-cancel-card="${esc(item.id)}">${esc(t('urgencias.cancelCta'))}</button>`
                  : ''
              }
            </div>`
          : ''
      }
    </article>`;
}

export async function urgenciasView({ query }) {
  const shop = resolveShop();
  let scope = query.get('tab') === 'history' ? 'history' : 'active';
  /** @type {Map<string, object>} */
  let byId = new Map();

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
    byId = new Map(list.map((row) => [row.id, row]));
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
    const cancelBtn = event.target.closest('[data-cancel-card]');
    if (cancelBtn) {
      event.preventDefault();
      event.stopPropagation();
      const urgencia = byId.get(cancelBtn.dataset.cancelCard);
      if (!urgencia || !shop?.id) return;
      cancelBtn.disabled = true;
      void cancelUrgenciaFlow(urgencia, shop, {
        onCancelled: () => {
          byId.delete(urgencia.id);
          const remaining = [...byId.values()];
          paintList(remaining);
          void load();
        },
      })
        .catch((error) => {
          console.error('[urgencias] cancel failed', error);
          toast(t('urgencias.cancelError'), 'danger');
        })
        .finally(() => {
          cancelBtn.disabled = false;
        });
      return;
    }

    const acceptBtn = event.target.closest('[data-accept-card]');
    if (acceptBtn) {
      event.preventDefault();
      event.stopPropagation();
      const urgencia = byId.get(acceptBtn.dataset.acceptCard);
      if (!urgencia || !shop?.id) return;
      acceptBtn.disabled = true;
      void acceptUrgenciaFlow(urgencia, shop, {
        onAccepted: (result) => {
          if (result?.appointment?.id) {
            navigate(`/appointments/${result.appointment.id}`);
            return;
          }
          void load();
        },
      })
        .catch((error) => {
          console.error('[urgencias] accept failed', error);
          toast(t('urgencias.acceptError'), 'danger');
        })
        .finally(() => {
          acceptBtn.disabled = false;
        });
      return;
    }

    const open = event.target.closest('[data-urgencia-open]');
    if (open) {
      navigate(`/urgencias/${open.dataset.urgenciaOpen}`);
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

  const poll = setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, 60_000);

  return () => clearInterval(poll);
}

export async function urgenciaDetailView({ params }) {
  const shop = resolveShop();

  screen({
    title: t('urgencias.detailTitle'),
    back: '/urgencias',
    nav: 'urgencias',
    content: skeletonList(3),
  });

  if (!shop?.id) {
    setContent(emptyState(t('urgencias.notFound'), t('urgencias.notFoundHint'), 'phone'));
    return undefined;
  }

  const render = async () => {
    let urgencia;
    try {
      ({ urgencia } = await api.urgencia(params.id, shop.id));
    } catch (error) {
      console.error('[urgencias] detail failed', error);
      setContent(emptyState(t('urgencias.notFound'), t('urgencias.notFoundHint'), 'phone'));
      return;
    }

    const title = urgencia.title || t('urgencias.requestTitle');
    const vehicle = urgencia.vehicle?.label || '—';
    const plate = urgencia.vehicle?.plate || '—';
    const customerName = formatUrgenciaCustomerDisplayName(urgencia.customer_name);
    const displaySummary = formatUrgenciaDisplaySummary(urgencia);
    const reason = formatUrgenciaDisplayReason(urgencia);
    const canAccept = urgencia.can_accept !== false && urgencia.status === 'pending';
    const canCancel = urgencia.can_cancel !== false && urgencia.status === 'pending';
    const whenLabel = formatUrgenciaCanaryDateTime(urgencia) || urgencia.called_local || '—';

    const main = setContent(`
      <div class="stack">
        <div class="card">
          <h1 class="urgencia-detail__title">${esc(title)}</h1>
          ${statusLine(urgencia)}
          <div style="height:14px"></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldName'))}</span><span class="kv__value">${esc(customerName)}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldPhone'))}</span><span class="kv__value">${esc(urgencia.customer_phone_display || urgencia.customer_phone || '—')}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldVehicle'))}</span><span class="kv__value">${esc(vehicle)}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldPlate'))}</span><span class="kv__value" style="font-family:var(--mono)">${esc(plate)}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.reasonLabel'))}</span><span class="kv__value">${esc(reason)}</span></div>
          <div class="kv"><span class="kv__key">${esc(t('urgencias.fieldCalledAt'))}</span><span class="kv__value">${esc(whenLabel)}</span></div>
          ${
            displaySummary && displaySummary !== reason
              ? `<div class="list__meta" style="margin-top:10px;line-height:1.4">${esc(displaySummary)}</div>`
              : ''
          }
        </div>

        ${contactButtons({
          telLink: urgencia.customer_tel_link,
          whatsappLink: urgencia.customer_whatsapp_link,
          phoneDisplay: urgencia.customer_phone_display,
          callPrimary: true,
        })}

        <div class="stack stack--tight" data-actions>
          ${
            canAccept || canCancel
              ? `<div class="urgencia-card__actions">
                  ${
                    canAccept
                      ? `<button class="btn btn--block" type="button" data-accept>${esc(t('urgencias.acceptCta'))}</button>`
                      : ''
                  }
                  ${
                    canCancel
                      ? `<button class="btn btn--danger btn--block" type="button" data-cancel>${esc(t('urgencias.cancelCta'))}</button>`
                      : ''
                  }
                </div>`
              : urgencia.appointment_id
                ? `<button class="btn btn--soft btn--block" type="button" data-open-booking="${esc(urgencia.appointment_id)}">${esc(t('urgencias.openBooking'))}</button>`
                : urgencia.status === 'cancelled'
                  ? `<p class="list__meta" style="margin:0;text-align:center">${esc(t('urgencias.alreadyCancelled'))}</p>`
                  : `<p class="list__meta" style="margin:0;text-align:center">${esc(t('urgencias.alreadyAccepted'))}</p>`
          }
        </div>
      </div>`);

    main.querySelector('[data-open-booking]')?.addEventListener('click', (event) => {
      navigate(`/appointments/${event.currentTarget.dataset.openBooking}`);
    });

    main.querySelector('[data-cancel]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await cancelUrgenciaFlow(urgencia, shop);
        if (!result) {
          button.disabled = false;
          return;
        }
        navigate('/urgencias');
      } catch (error) {
        console.error('[urgencias] cancel failed', error);
        toast(t('urgencias.cancelError'), 'danger');
        button.disabled = false;
      }
    });

    main.querySelector('[data-accept]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await acceptUrgenciaFlow(urgencia, shop);
        if (!result) {
          button.disabled = false;
          return;
        }
        if (result?.appointment?.id) {
          navigate(`/appointments/${result.appointment.id}`);
          return;
        }
        await render();
      } catch (error) {
        console.error('[urgencias] accept failed', error);
        toast(t('urgencias.acceptError'), 'danger');
        button.disabled = false;
      }
    });
  };

  await render();
  return undefined;
}
