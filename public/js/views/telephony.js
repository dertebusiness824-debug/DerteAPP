/**
 * Llamadas y WhatsApp — estado Zadarma + histórico completo de llamadas del taller.
 * The API returns every call (all statuses); this view renders them as-is.
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { store } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import { emptyState, esc, icon, skeletonList, timeOf, dateTimeOf } from '../ui.js';

function callStatusMeta(call) {
  const kind =
    call.status_kind ||
    (call.status === 'completed'
      ? 'completed'
      : ['no_answer', 'busy', 'failed', 'cancelled'].includes(call.status)
        ? 'missed'
        : 'in_progress');
  const label =
    call.status_label ||
    (kind === 'completed' ? 'Completada' : kind === 'missed' ? 'Perdida' : 'En curso');
  return { kind, label };
}

function callRow(call, timeZone) {
  const { kind, label } = callStatusMeta(call);
  const phone =
    call.customer_phone_display ||
    call.counterparty_display ||
    call.caller_phone_display ||
    call.callee_phone_display ||
    (call.counterparty ? String(call.counterparty) : '') ||
    (call.caller_phone ? String(call.caller_phone) : '') ||
    'Desconocido/Sin ID';
  const whenIso = call.timestamp || call.created_at || call.started_at;
  const whenExact = whenIso
    ? dateTimeOf(whenIso, timeZone) || timeOf(whenIso, timeZone) || String(whenIso)
    : '—';
  const bg =
    kind === 'completed' ? 'var(--ok-soft)' : kind === 'missed' ? 'var(--danger-soft)' : 'var(--accent-soft)';
  const fg =
    kind === 'completed' ? 'var(--ok)' : kind === 'missed' ? 'var(--danger)' : 'var(--accent)';
  const iconName = kind === 'missed' ? 'missed' : 'phone';

  return `
    <div class="list__item list__item--static" data-call="${esc(call.id)}" data-call-status="${esc(call.status || '')}">
      <span class="avatar" style="background:${bg};color:${fg}">
        ${icon(iconName, { size: 17 })}
      </span>
      <div class="grow" style="min-width:0">
        <div class="row row--between" style="gap:8px;align-items:flex-start">
          <div class="list__title truncate" style="flex:1;min-width:0">${esc(phone)}</div>
          <span class="chip" style="flex:none;background:${bg};color:${fg};border:0;font-weight:650">${esc(label)}</span>
        </div>
        <div class="list__meta" style="font-variant-numeric:tabular-nums;margin-top:4px">
          ${esc(whenExact)}
        </div>
        <div class="list__meta">
          ${call.direction === 'out' ? 'Saliente' : call.direction === 'internal' ? 'Interna' : 'Entrante'}
          ${call.duration_seconds ? ` · ${Number(call.duration_seconds)}s` : ''}
          ${call.provider ? ` · ${esc(call.provider)}` : ''}
        </div>
      </div>
      ${
        call.tel_link
          ? `<a class="btn btn--icon" href="${esc(call.tel_link)}" aria-label="Llamar">${icon('phone', { size: 17 })}</a>`
          : ''
      }
    </div>`;
}

export async function telephonyView() {
  const shop = requireShop({ title: 'Llamadas', navKey: 'more' });
  if (!shop) return undefined;

  screen({ title: 'Llamadas y WhatsApp', back: '/settings', nav: 'more', content: skeletonList(3) });

  let status;
  let callsPayload;
  let shopDetail = shop;
  try {
    [status, callsPayload, shopDetail] = await Promise.all([
      api.telephonyStatus({ shop_id: shop.id }),
      // Recent history for this shop — capped so the PWA never dumps hundreds of rows.
      api.calls({ shop_id: shop.id, limit: 100 }),
      api.shop(shop.id).then((result) => result.shop).catch(() => shop),
    ]);
  } catch (error) {
    setContent(emptyState('No se pudieron cargar los ajustes de llamadas', error.message, 'x'));
    return undefined;
  }
  store.telephony = status;

  const linked = Boolean(
    status?.configured ||
      status?.shop_linked ||
      shopDetail?.zadarma_linked ||
      shopDetail?.zadarma_sip ||
      shopDetail?.zadarma_did ||
      shopDetail?.did_zadarma ||
      shopDetail?.zadarma_api_key_set,
  );

  // Render the API list as returned (already sorted newest-first).
  const calls = Array.isArray(callsPayload?.calls) ? callsPayload.calls : [];
  const timeZone = shop.timezone || shopDetail?.timezone || undefined;

  setContent(`
    <div class="stack">
      <div class="card ${linked ? 'card--ok' : 'card--flat'}">
        <div class="row" style="gap:8px">
          ${icon('phone', { size: 18 })}
          <div class="grow">
            <strong style="${linked ? 'color:var(--ok)' : ''}">${
              linked ? esc(t('telephony.zadarmaOn')) : esc(t('telephony.zadarmaOff'))
            }</strong>
            <div class="list__meta" style="margin-top:2px">
              ${
                linked
                  ? esc(t('telephony.zadarmaOnHint'))
                  : esc(t('telephony.zadarmaOffHint'))
              }
              ${
                linked && (shopDetail?.zadarma_did || shopDetail?.did_zadarma || shopDetail?.zadarma_sip)
                  ? `<div style="margin-top:4px">${esc(
                      [shopDetail.zadarma_did || shopDetail.did_zadarma, shopDetail.zadarma_sip]
                        .filter(Boolean)
                        .join(' · '),
                    )}</div>`
                  : ''
              }
            </div>
          </div>
        </div>
      </div>

      <div class="card card--flat">
        <div class="row" style="gap:8px">
          ${icon('megaphone', { size: 18 })}
          <div class="grow">
            <strong>${esc(t('telephony.retell'))}</strong>
            <div class="list__meta" style="margin-top:2px">
              ${esc(t('telephony.retellHint'))}
              ${
                shopDetail.retell_agent_id || shopDetail.retell_did
                  ? ` Vinculado${shopDetail.retell_agent_id ? ` · agente ${esc(shopDetail.retell_agent_id)}` : ''}${
                      shopDetail.retell_did ? ` · DID ${esc(shopDetail.retell_did)}` : ''
                    }.`
                  : ' Pide al soporte de DerteApp que vincule tu agente Retell o número entrante a este taller.'
              }
            </div>
          </div>
        </div>
      </div>

      <div class="section-title">
        <span>${esc(t('telephony.history'))}</span>
        <span class="list__meta">${calls.length}</span>
      </div>
      ${
        calls.length
          ? `<div class="list" data-call-history>
               ${calls.map((call) => callRow(call, timeZone)).join('')}
             </div>`
          : emptyState(t('telephony.noCalls'), '', 'phone')
      }

      <div class="card card--flat">
        <div class="card__label">URL del webhook de Zadarma</div>
        <div style="font-family:var(--mono);font-size:11.5px;word-break:break-all;margin-top:4px">${esc(
          status.webhook_url || '',
        )}</div>
        <div class="list__meta" style="margin-top:6px">
          Un Super Admin añade esta URL en el panel de Zadarma para recibir eventos de llamadas.
        </div>
      </div>
    </div>`);

  return undefined;
}
