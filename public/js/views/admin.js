/**
 * Super Admin screens: the master dashboard across all client sites, the shop
 * directory with its switcher, the central support inbox and the global call log.
 */
import { api, stream } from '../api.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { refreshBadges, setActiveShop, store } from '../store.js';
import { screen, setContent } from '../shell.js';
import {
  ago,
  barChart,
  confirmSheet,
  contactButtons,
  copy,
  dateTimeOf,
  dayOf,
  duration,
  emptyState,
  esc,
  icon,
  num,
  sheet,
  skeletonList,
  toast,
} from '../ui.js';

const RANGES = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
];

const rangeTabs = (days) => `
  <div class="segmented" role="tablist">
    ${RANGES.map(
      (range) =>
        `<button role="tab" data-days="${range.days}" aria-pressed="${range.days === days}">${esc(range.label)}</button>`,
    ).join('')}
  </div>`;

const bindRangeTabs = (main, basePath) => {
  for (const tab of main.querySelectorAll('[data-days]')) {
    tab.addEventListener('click', () => navigate(`${basePath}?days=${tab.dataset.days}`));
  }
};

// --- Master dashboard --------------------------------------------------------

export async function adminOverviewView({ query }) {
  const days = Number(query.get('days')) || 30;

  screen({
    title: 'Todos los talleres',
    subtitle: `${store.shops.length} sitios`,
    nav: 'admin',
    actions: `<button class="btn btn--icon" data-broadcast aria-label="Mensaje a todos los talleres">${icon('megaphone', { size: 18 })}</button>`,
    content: skeletonList(5),
  });

  let data;
  try {
    data = await api.adminOverview(days);
  } catch (error) {
    setContent(emptyState('No se pudo cargar el panel', error.message, 'x'));
    return undefined;
  }

  const totals = data.totals;
  const calls = data.calls;
  const answerRate = calls.total ? Math.round((calls.answered / calls.total) * 100) : 0;

  const main = setContent(`
    <div class="stack">
      ${rangeTabs(days)}

      ${
        totals.pending_bookings > 0 || totals.support_unread > 0
          ? `<div class="banner">
               ${icon('bell', { size: 18 })}
               <div>
                 <strong>${num(totals.pending_bookings)} reserva${totals.pending_bookings === 1 ? '' : 's'}</strong>
                 esperando respuesta del taller · <strong>${num(totals.support_unread)}</strong> mensaje${totals.support_unread === 1 ? '' : 's'} de soporte sin leer
               </div>
             </div>`
          : ''
      }

      <div class="stats">
        <div class="stat">
          <div class="stat__value">${num(totals.active_shops)}</div>
          <div class="stat__label">Sitios activos</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(totals.bookings)}</div>
          <div class="stat__label">Reservas</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(totals.visitors)}</div>
          <div class="stat__label">Visitantes web</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(calls.total)}</div>
          <div class="stat__label">Llamadas · ${answerRate}% respondidas</div>
        </div>
      </div>

      <div class="card">
        <div class="section-title"><span>Reservas por día</span><span class="muted">${num(totals.bookings)} en total</span></div>
        ${
          data.timeline.length
            ? barChart(data.timeline.map((point) => ({ label: point.day, value: point.bookings })))
            : '<p class="muted">Aún no hay reservas en este periodo.</p>'
        }
      </div>

      ${
        data.alerts.length
          ? `<div class="card">
               <div class="section-title"><span>Requieren atención</span></div>
               <div class="list list--plain">
                 ${data.alerts
                   .map(
                     (alert) => `
                       <button class="list__item" data-shop-jump="${esc(alert.id)}">
                         <div class="grow">
                           <div class="list__title truncate">${esc(alert.name)}</div>
                           <div class="list__meta">${num(alert.stale_pending)} solicitud${alert.stale_pending === 1 ? '' : 'es'} sin responder desde hace más de 6 h</div>
                         </div>
                         ${icon('chevron', { size: 16 })}
                       </button>`,
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }

      <div class="section-title"><span>Por taller</span><span class="muted">últimos ${days} días</span></div>
      <div class="list">
        ${
          data.shops.length
            ? data.shops
                .map(
                  (shop) => `
                    <button class="list__item" data-shop-jump="${esc(shop.id)}">
                      <div class="grow">
                        <div class="row row--between" style="gap:8px">
                          <span class="list__title truncate">${esc(shop.name)}</span>
                          ${shop.pending > 0 ? `<span class="badge badge--warn">${num(shop.pending)} en espera</span>` : ''}
                        </div>
                        <div class="list__meta">
                          ${num(shop.bookings)} reservas · ${num(shop.visitors)} visitantes · ${num(shop.calls)} llamadas${
                            shop.missed_calls > 0 ? ` · ${num(shop.missed_calls)} perdidas` : ''
                          }
                        </div>
                        <div class="list__meta">${esc(shop.owner_name ?? 'Sin propietario vinculado')}${
                          shop.owner_phone_display ? ` · ${esc(shop.owner_phone_display)}` : ''
                        }</div>
                      </div>
                      ${icon('chevron', { size: 16 })}
                    </button>`,
                )
                .join('')
            : '<div class="list__item list__item--static">Aún no hay talleres</div>'
        }
      </div>
    </div>`);

  bindRangeTabs(main, '/admin');

  for (const button of main.querySelectorAll('[data-shop-jump]')) {
    button.addEventListener('click', () => openShopActions(button.dataset.shopJump));
  }

  document.querySelector('[data-broadcast]')?.addEventListener('click', openBroadcastSheet);

  // Live alert when Google Calendar creates a booking, or a shop confirms a cita.
  const stopStream = stream('/admin/inbox/stream', {
    appointment_created: (payload) => {
      const name = payload?.appointment?.customer_name || '';
      const shopName = payload?.shop_name || '';
      toast(
        `${t('appointments.googleNewToast')}${shopName ? ` · ${shopName}` : ''}${name ? ` · ${name}` : ''}`.trim(),
        'ok',
      );
      void refreshBadges();
    },
    appointment_confirmed: (payload) => {
      const name = payload?.appointment?.customer_name || '';
      const shopName = payload?.shop_name || '';
      toast(
        `Cita confirmada por el taller${shopName ? ` · ${shopName}` : ''}${name ? ` · ${name}` : ''}`.trim(),
        'ok',
      );
      void refreshBadges();
    },
  });

  return () => stopStream();
}

/** What a Super Admin can do with one tenant, from anywhere in the dashboard. */
function openShopActions(shopId) {
  const shop = store.shops.find((entry) => entry.id === shopId);
  sheet({
    title: shop?.name ?? 'Taller',
    body: `
      <div class="stack">
        <button class="btn btn--block" data-act="work">${icon('inspect', { size: 17 })}Abrir el panel de este taller</button>
        <button class="btn btn--soft btn--block" data-act="support">${icon('chat', { size: 17 })}Chat de soporte</button>
        <button class="btn btn--soft btn--block" data-act="detail">${icon('building', { size: 17 })}Datos del taller</button>
      </div>`,
    onMount(content, close) {
      content.querySelector('[data-act="work"]').addEventListener('click', async () => {
        setActiveShop(shopId);
        close();
        await refreshBadges();
        navigate('/');
      });
      content.querySelector('[data-act="support"]').addEventListener('click', async () => {
        close();
        try {
          const { thread } = await api.adminSupportThread(shopId);
          navigate(`/chat/${thread.id}`);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
      content.querySelector('[data-act="detail"]').addEventListener('click', () => {
        setActiveShop(shopId);
        close();
        navigate('/settings');
      });
    },
  });
}

function openBroadcastSheet() {
  sheet({
    title: 'Mensaje a todos los talleres',
    body: `
      <form class="stack" data-form>
        <p class="muted" style="font-size:14px">
          Se envía al chat de soporte de cada taller. Los propietarios lo reciben en el móvil con tu número adjunto.
        </p>
        <div class="field">
          <label class="field__label" for="broadcast-body">Mensaje</label>
          <textarea id="broadcast-body" class="input" rows="4" maxlength="2000" required
                    placeholder="Mantenimiento programado esta noche de 23:00 a 23:30."></textarea>
        </div>
        <button class="btn btn--block" type="submit">Enviar a todos los talleres activos</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('[data-form]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const result = await api.adminBroadcast({ body: form.querySelector('#broadcast-body').value });
          toast(`Enviado a ${result.delivered} taller${result.delivered === 1 ? '' : 'es'}`, 'ok');
          close();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    },
  });
}

// --- Shop directory ----------------------------------------------------------

export async function adminShopsView({ query }) {
  const search = query.get('q') ?? '';

  screen({
    title: 'Talleres',
    nav: 'shops',
    actions: `<button class="btn btn--icon" data-new-shop aria-label="Añadir taller">${icon('plus', { size: 18 })}</button>`,
    content: skeletonList(6),
  });

  const render = async () => {
    let data;
    try {
      data = await api.adminShops({ search: search || undefined, limit: 200 });
    } catch (error) {
      setContent(emptyState('No se pudieron cargar los talleres', error.message, 'x'));
      return;
    }

    const activeId = store.activeShopId;
    const activeShop = data.shops.find((shop) => shop.id === activeId) ?? data.shops[0] ?? null;
    const otherCount = Math.max(0, data.shops.length - (activeShop ? 1 : 0));

    const main = setContent(`
      <div class="stack">
        <div class="field">
          <label class="sr-only" for="shop-search">Buscar talleres</label>
          <input id="shop-search" class="input" type="search" value="${esc(search)}"
                 placeholder="Buscar por nombre, web o teléfono del propietario" autocomplete="off">
        </div>
        ${
          data.marketplace_ready === false
            ? `<div class="banner banner--warn">El SQL del marketplace aún no está instalado: el interruptor «Publicar en la app de clientes» guardará el flag, pero la PWA no lo verá hasta que el schema se aplique al arrancar.</div>`
            : `<p class="list__meta" style="margin:0">Publica cada taller activo en la PWA de clientes, sube su foto de portada y crea ofertas que aparecen en su ficha.</p>`
        }
        ${
          data.shops.length > 1 && activeShop
            ? `<div class="banner banner--warn">
                 <strong>Limpieza del marketplace.</strong>
                 Conserva solo el taller activo del panel
                 (<em>${esc(activeShop.name)}</em>) y elimina los otros ${num(otherCount)}.
                 Esta acción es irreversible.
                 <div class="row" style="margin-top:10px">
                   <button class="btn btn--small btn--danger" type="button" data-purge-others
                           data-keep="${esc(activeShop.id)}" data-name="${esc(activeShop.name)}"
                           data-count="${otherCount}">
                     Eliminar los otros ${num(otherCount)} talleres
                   </button>
                 </div>
               </div>`
            : ''
        }
        <div class="list">
          ${
            data.shops.length
              ? data.shops
                  .map(
                    (shop) => `
                      <div class="list__item list__item--static" data-shop-card="${esc(shop.id)}">
                        <div class="row" style="gap:12px;align-items:flex-start">
                          <div class="shop-cover-thumb" style="width:56px;height:56px;border-radius:12px;overflow:hidden;background:var(--surface-2,#eef2f7);flex-shrink:0;display:grid;place-items:center">
                            ${
                              shop.cover_image_url
                                ? `<img src="${esc(shop.cover_image_url)}" alt="" width="56" height="56" style="width:100%;height:100%;object-fit:cover">`
                                : `<span style="font-size:12px;font-weight:700;opacity:.55">${esc(
                                    shop.name
                                      .split(' ')
                                      .filter((word) => word.length > 2)
                                      .slice(0, 2)
                                      .map((word) => word[0]?.toUpperCase())
                                      .join('') || '·',
                                  )}</span>`
                            }
                          </div>
                          <div class="grow" style="min-width:0">
                          <div class="row row--between" style="gap:8px">
                            <span class="list__title truncate">${esc(shop.name)}${
                              shop.id === activeId ? ' · <span class="badge badge--ok">En panel</span>' : ''
                            }</span>
                            ${
                              shop.status === 'active'
                                ? `<span class="badge badge--ok">Activo</span>`
                                : `<span class="badge badge--danger">${esc(shop.status)}</span>`
                            }
                          </div>
                          <div class="list__meta">
                            ${esc(shop.owner_name ?? 'Sin propietario')}${shop.owner_phone_display ? ` · ${esc(shop.owner_phone_display)}` : ''}
                          </div>
                          <div class="list__meta">
                            ${num(shop.total_bookings)} reservas${shop.pending_bookings > 0 ? ` · ${num(shop.pending_bookings)} en espera` : ''}
                            · ${esc(shop.timezone)}
                            ${shop.active_promotions > 0 ? ` · ${num(shop.active_promotions)} oferta${shop.active_promotions === 1 ? '' : 's'}` : ''}
                          </div>
                          ${
                            shop.site_url
                              ? `<div class="list__meta truncate"><a href="${esc(shop.site_url)}" target="_blank" rel="noopener" data-native="true">${esc(
                                  shop.site_url.replace(/^https?:\/\//, ''),
                                )}</a></div>`
                              : ''
                          }
                          ${contactButtons({
                            telLink: shop.owner_tel_link,
                            whatsappLink: shop.owner_whatsapp_link,
                            phoneDisplay: shop.owner_phone_display,
                            compact: true,
                          })}
                          <div class="row row--between" style="gap:12px;margin-top:10px;align-items:center">
                            <label class="switch" title="Visible en la PWA de clientes">
                              <input type="checkbox" data-marketplace="${esc(shop.id)}"
                                     data-name="${esc(shop.name)}"
                                     ${shop.marketplace_listed ? 'checked' : ''}
                                     ${shop.status !== 'active' ? 'disabled' : ''}>
                              <span class="field__hint">${
                                shop.marketplace_listed ? 'Publicado en la app de clientes' : 'Oculto en la app de clientes'
                              }</span>
                            </label>
                          </div>
                          <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
                            <button class="btn btn--small" data-open="${esc(shop.id)}">Abrir panel</button>
                            <button class="btn btn--small btn--soft" data-cover="${esc(shop.id)}"
                                    data-name="${esc(shop.name)}" data-has-cover="${shop.cover_image_url ? '1' : '0'}">
                              ${shop.cover_image_url ? 'Cambiar foto' : 'Foto portada'}
                            </button>
                            ${
                              shop.cover_image_url
                                ? `<button class="btn btn--small btn--soft" data-clear-cover="${esc(shop.id)}" data-name="${esc(shop.name)}">Quitar foto</button>`
                                : ''
                            }
                            <button class="btn btn--small btn--soft" data-promos="${esc(shop.id)}"
                                    data-name="${esc(shop.name)}">Ofertas</button>
                            <button class="btn btn--small btn--soft" data-zadarma="${esc(shop.id)}"
                                    data-name="${esc(shop.name)}">Zadarma</button>
                            <button class="btn btn--small btn--soft" data-support="${esc(shop.id)}">Chat de soporte</button>
                            <button class="btn btn--small btn--soft" data-status="${esc(shop.id)}"
                                    data-current="${esc(shop.status)}" data-name="${esc(shop.name)}">
                              ${shop.status === 'active' ? 'Suspender' : 'Reactivar'}
                            </button>
                          </div>
                          </div>
                        </div>
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
                               data-cover-input="${esc(shop.id)}" data-name="${esc(shop.name)}">
                      </div>`,
                  )
                  .join('')
              : emptyState('Ningún taller coincide', 'Prueba con otro término de búsqueda.', 'building')
          }
        </div>
      </div>`);

    const input = main.querySelector('#shop-search');
    input.addEventListener('change', () => {
      const value = input.value.trim();
      navigate(value ? `/admin/shops?q=${encodeURIComponent(value)}` : '/admin/shops');
    });

    main.querySelector('[data-purge-others]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const keepId = button.dataset.keep;
      const keepName = button.dataset.name;
      const count = Number(button.dataset.count || 0);
      const confirmed = await confirmSheet({
        title: `¿Eliminar ${count} talleres?`,
        message: `Solo se conservará «${keepName}» (el taller abierto en el panel). Se borrarán citas, ofertas, chats y fichas del marketplace del resto. Escribe ELIMINAR en el siguiente paso mentalmente — esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar el resto',
        danger: true,
      });
      if (!confirmed) return;
      const typed = window.prompt('Escribe ELIMINAR para confirmar la purga de talleres:', '');
      if (String(typed || '').trim().toUpperCase() !== 'ELIMINAR') {
        toast('Purga cancelada', 'error');
        return;
      }
      button.disabled = true;
      try {
        const result = await api.adminPurgeShopsExcept({
          keep_shop_id: keepId,
          confirm: 'ELIMINAR',
        });
        setActiveShop(keepId);
        toast(`Conservado ${result.kept.name}. Eliminados: ${result.deleted_count}`, 'ok');
        await refreshBadges();
        await render();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    for (const button of main.querySelectorAll('[data-open]')) {
      button.addEventListener('click', async () => {
        setActiveShop(button.dataset.open);
        await refreshBadges();
        navigate('/');
      });
    }

    for (const toggle of main.querySelectorAll('[data-marketplace]')) {
      toggle.addEventListener('change', async () => {
        const listed = toggle.checked;
        const hint = toggle.parentElement.querySelector('.field__hint');
        toggle.disabled = true;
        try {
          await api.adminSetShopMarketplace(toggle.dataset.marketplace, { is_listed: listed });
          if (hint) {
            hint.textContent = listed
              ? 'Publicado en la app de clientes'
              : 'Oculto en la app de clientes';
          }
          toast(
            listed
              ? `${toggle.dataset.name} ya es visible en la PWA`
              : `${toggle.dataset.name} retirado de la PWA`,
            'ok',
          );
        } catch (error) {
          toggle.checked = !listed;
          toast(error.message, 'error');
        } finally {
          toggle.disabled = false;
        }
      });
    }

    for (const button of main.querySelectorAll('[data-cover]')) {
      button.addEventListener('click', () => {
        const fileInput = main.querySelector(`[data-cover-input="${button.dataset.cover}"]`);
        fileInput?.click();
      });
    }

    for (const fileInput of main.querySelectorAll('[data-cover-input]')) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        if (file.size > 4.5 * 1024 * 1024) {
          toast('La foto supera 4,5 MB', 'error');
          return;
        }
        const shopId = fileInput.dataset.coverInput;
        const shopName = fileInput.dataset.name;
        try {
          toast('Subiendo portada…', 'ok');
          const dataUrl = await readFileAsDataUrl(file);
          await api.adminUploadShopCover(shopId, {
            data_url: dataUrl,
            content_type: file.type || 'image/jpeg',
          });
          toast(`Portada de ${shopName} actualizada`, 'ok');
          await render();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }

    for (const button of main.querySelectorAll('[data-clear-cover]')) {
      button.addEventListener('click', async () => {
        const confirmed = await confirmSheet({
          title: `¿Quitar la foto de ${button.dataset.name}?`,
          message: 'La ficha del marketplace volverá a mostrar solo las iniciales del taller.',
          confirmLabel: 'Quitar foto',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api.adminClearShopCover(button.dataset.clearCover);
          toast('Foto de portada eliminada', 'ok');
          await render();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }

    for (const button of main.querySelectorAll('[data-promos]')) {
      button.addEventListener('click', () =>
        openShopPromotionsSheet({
          shopId: button.dataset.promos,
          shopName: button.dataset.name,
          onChanged: render,
        }),
      );
    }

    for (const button of main.querySelectorAll('[data-zadarma]')) {
      button.addEventListener('click', () =>
        openShopZadarmaSheet({
          shopId: button.dataset.zadarma,
          shopName: button.dataset.name,
          onSaved: render,
        }),
      );
    }

    for (const button of main.querySelectorAll('[data-support]')) {
      button.addEventListener('click', async () => {
        try {
          const { thread } = await api.adminSupportThread(button.dataset.support);
          navigate(`/chat/${thread.id}`);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }

    for (const button of main.querySelectorAll('[data-status]')) {
      button.addEventListener('click', async () => {
        const suspending = button.dataset.current === 'active';
        const confirmed = await confirmSheet({
          title: suspending ? `¿Suspender ${button.dataset.name}?` : `¿Reactivar ${button.dataset.name}?`,
          message: suspending
            ? 'El taller deja de aceptar reservas online y el propietario no puede entrar a su panel.'
            : 'Se restauran las reservas online y el acceso al panel.',
          confirmLabel: suspending ? 'Suspender' : 'Reactivar',
          danger: suspending,
        });
        if (!confirmed) return;
        try {
          await api.adminSetShopStatus(button.dataset.status, { status: suspending ? 'suspended' : 'active' });
          toast(suspending ? 'Taller suspendido' : 'Taller reactivado', 'ok');
          await render();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }
  };

  await render();
  document.querySelector('[data-new-shop]')?.addEventListener('click', () => openNewShopSheet(render));
  return undefined;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

/** Ofertas del taller: listado + alta/edición/borrado desde Super Admin. */
function openShopPromotionsSheet({ shopId, shopName, onChanged }) {
  sheet({
    title: `Ofertas · ${shopName}`,
    body: `
      <div class="stack" data-promos-root>
        <p class="list__meta" style="margin:0">
          Las ofertas activas se muestran en la ficha del taller dentro de la PWA de clientes.
        </p>
        <button class="btn btn--block" type="button" data-new-promo>
          ${icon('plus', { size: 17 })}Nueva oferta
        </button>
        <div data-list>${skeletonList(3)}</div>
      </div>`,
    onMount(content) {
      const list = content.querySelector('[data-list]');
      const reload = async () => {
        try {
          const payload = await api.adminShopPromotions(shopId);
          if (!payload.promotions.length) {
            list.innerHTML = emptyState(
              'Sin ofertas todavía',
              'Crea una promoción para destacar precios o servicios en la app de clientes.',
              'megaphone',
            );
            return;
          }
          list.innerHTML = `<div class="list">${payload.promotions
            .map((promo) => {
              const windowLabel = [
                promo.starts_at ? `desde ${dayOf(promo.starts_at)}` : null,
                promo.ends_at ? `hasta ${dayOf(promo.ends_at)}` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              const priceBits = [];
              if (promo.discount_percent != null) priceBits.push(`-${num(promo.discount_percent)}%`);
              if (promo.price_from != null) {
                priceBits.push(
                  promo.price_to != null && promo.price_to !== promo.price_from
                    ? `${num(promo.price_from)}–${num(promo.price_to)} ${promo.currency}`
                    : `desde ${num(promo.price_from)} ${promo.currency}`,
                );
              }
              return `
                <div class="list__item list__item--static">
                  <div class="grow">
                    <div class="row row--between" style="gap:8px">
                      <span class="list__title truncate">${esc(promo.title)}</span>
                      ${
                        promo.is_active
                          ? `<span class="badge badge--ok">Activa</span>`
                          : `<span class="badge">Pausada</span>`
                      }
                    </div>
                    ${
                      promo.badge_label
                        ? `<div class="list__meta">${esc(promo.badge_label)}${
                            promo.service_name ? ` · ${esc(promo.service_name)}` : ''
                          }</div>`
                        : promo.service_name
                          ? `<div class="list__meta">${esc(promo.service_name)}</div>`
                          : ''
                    }
                    ${
                      promo.description
                        ? `<div class="list__meta">${esc(promo.description)}</div>`
                        : ''
                    }
                    ${
                      priceBits.length || windowLabel
                        ? `<div class="list__meta">${esc(
                            [...priceBits, windowLabel].filter(Boolean).join(' · '),
                          )}</div>`
                        : ''
                    }
                    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
                      <button class="btn btn--small btn--soft" data-edit="${esc(promo.id)}">Editar</button>
                      <button class="btn btn--small btn--soft" data-toggle="${esc(promo.id)}"
                              data-active="${promo.is_active ? '1' : '0'}">
                        ${promo.is_active ? 'Pausar' : 'Activar'}
                      </button>
                      <button class="btn btn--small btn--soft" data-delete="${esc(promo.id)}"
                              data-title="${esc(promo.title)}">Eliminar</button>
                    </div>
                  </div>
                </div>`;
            })
            .join('')}</div>`;

          for (const button of list.querySelectorAll('[data-edit]')) {
            button.addEventListener('click', async () => {
              const promo = payload.promotions.find((entry) => entry.id === button.dataset.edit);
              if (!promo) return;
              openPromotionEditor({ shopId, shopName, promotion: promo, onSaved: reload });
            });
          }
          for (const button of list.querySelectorAll('[data-toggle]')) {
            button.addEventListener('click', async () => {
              const next = button.dataset.active !== '1';
              try {
                await api.adminUpdatePromotion(button.dataset.toggle, { is_active: next });
                toast(next ? 'Oferta activada' : 'Oferta pausada', 'ok');
                await reload();
                onChanged?.();
              } catch (error) {
                toast(error.message, 'error');
              }
            });
          }
          for (const button of list.querySelectorAll('[data-delete]')) {
            button.addEventListener('click', async () => {
              const confirmed = await confirmSheet({
                title: `¿Eliminar «${button.dataset.title}»?`,
                message: 'Desaparecerá de la ficha del taller en la PWA de clientes.',
                confirmLabel: 'Eliminar',
                danger: true,
              });
              if (!confirmed) return;
              try {
                await api.adminDeletePromotion(button.dataset.delete);
                toast('Oferta eliminada', 'ok');
                await reload();
                onChanged?.();
              } catch (error) {
                toast(error.message, 'error');
              }
            });
          }
        } catch (error) {
          list.innerHTML = emptyState('No se pudieron cargar las ofertas', error.message, 'x');
        }
      };

      content.querySelector('[data-new-promo]')?.addEventListener('click', () => {
        openPromotionEditor({
          shopId,
          shopName,
          promotion: null,
          onSaved: async () => {
            await reload();
            onChanged?.();
          },
        });
      });

      void reload();
    },
  });
}

function openPromotionEditor({ shopId, shopName, promotion, onSaved }) {
  const isEdit = Boolean(promotion);
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  sheet({
    title: isEdit ? `Editar oferta · ${shopName}` : `Nueva oferta · ${shopName}`,
    body: `
      <form class="stack" data-form>
        <div class="field">
          <label class="field__label" for="promo-title">Título</label>
          <input id="promo-title" class="input" required maxlength="120"
                 value="${esc(promotion?.title ?? '')}"
                 placeholder="Cambio de aceite -20%">
        </div>
        <div class="field">
          <label class="field__label" for="promo-badge">Etiqueta (opcional)</label>
          <input id="promo-badge" class="input" maxlength="40"
                 value="${esc(promotion?.badge_label ?? '')}"
                 placeholder="Oferta, -20%, Flash…">
        </div>
        <div class="field">
          <label class="field__label" for="promo-desc">Descripción</label>
          <textarea id="promo-desc" class="input" rows="3" maxlength="800"
                    placeholder="Incluye filtro y revisión de niveles">${esc(promotion?.description ?? '')}</textarea>
        </div>
        <div class="field">
          <label class="field__label" for="promo-service">Servicio asociado (opcional)</label>
          <input id="promo-service" class="input" maxlength="120"
                 value="${esc(promotion?.service_name ?? '')}"
                 placeholder="Cambio de aceite">
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="promo-discount">Descuento %</label>
            <input id="promo-discount" class="input" type="number" min="0" max="100" step="1"
                   value="${promotion?.discount_percent ?? ''}" placeholder="20">
          </div>
          <div class="field">
            <label class="field__label" for="promo-from">Precio desde (€)</label>
            <input id="promo-from" class="input" type="number" min="0" step="0.01"
                   value="${promotion?.price_from ?? ''}" placeholder="49">
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="promo-start">Inicio</label>
            <input id="promo-start" class="input" type="datetime-local"
                   value="${esc(toLocalInput(promotion?.starts_at))}">
          </div>
          <div class="field">
            <label class="field__label" for="promo-end">Fin</label>
            <input id="promo-end" class="input" type="datetime-local"
                   value="${esc(toLocalInput(promotion?.ends_at))}">
          </div>
        </div>
        <label class="switch">
          <input type="checkbox" id="promo-active" ${promotion?.is_active === false ? '' : 'checked'}>
          <span class="field__hint">Oferta activa y visible en la PWA</span>
        </label>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">${isEdit ? 'Guardar cambios' : 'Publicar oferta'}</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('[data-form]');
      const errorBox = form.querySelector('[data-error]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        errorBox.textContent = '';
        const localToIso = (value) => (value ? new Date(value).toISOString() : null);
        const payload = {
          title: form.querySelector('#promo-title').value.trim(),
          badge_label: form.querySelector('#promo-badge').value.trim() || null,
          description: form.querySelector('#promo-desc').value.trim() || null,
          service_name: form.querySelector('#promo-service').value.trim() || null,
          discount_percent: form.querySelector('#promo-discount').value
            ? Number(form.querySelector('#promo-discount').value)
            : null,
          price_from: form.querySelector('#promo-from').value
            ? Number(form.querySelector('#promo-from').value)
            : null,
          currency: 'EUR',
          starts_at: localToIso(form.querySelector('#promo-start').value),
          ends_at: localToIso(form.querySelector('#promo-end').value),
          is_active: form.querySelector('#promo-active').checked,
        };
        try {
          if (isEdit) await api.adminUpdatePromotion(promotion.id, payload);
          else await api.adminCreatePromotion(shopId, payload);
          toast(isEdit ? 'Oferta actualizada' : 'Oferta publicada', 'ok');
          close();
          await onSaved?.();
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}

/** Per-shop Zadarma credentials (API key/secret + SIP) from Superadmin shops list. */
function openShopZadarmaSheet({ shopId, shopName, onSaved }) {
  sheet({
    title: `Zadarma · ${shopName}`,
    body: `
      <form class="stack" data-form>
        <p class="list__meta" style="margin:0">${esc(t('sa.zadarmaShopHint'))}</p>
        <div class="field">
          <label class="field__label" for="zd-key">${esc(t('sa.zadarmaKey'))}</label>
          <input id="zd-key" class="input" type="password" autocomplete="off" placeholder="••••••••">
          <span class="field__hint">${esc(t('sa.zadarmaKeyHint'))}</span>
        </div>
        <div class="field">
          <label class="field__label" for="zd-secret">${esc(t('sa.zadarmaSecret'))}</label>
          <input id="zd-secret" class="input" type="password" autocomplete="off" placeholder="••••••••">
          <span class="field__hint">${esc(t('sa.zadarmaSecretHint'))}</span>
        </div>
        <div class="field">
          <label class="field__label" for="zd-sip">${esc(t('sa.zadarmaSip'))}</label>
          <input id="zd-sip" class="input" maxlength="120" placeholder="100 o sip:100@pbx.zadarma.com">
          <span class="field__hint">Extensión interna o SIP URI del taller.</span>
        </div>
        <div class="field">
          <label class="field__label" for="zd-did">${esc(t('sa.zadarmaDid'))}</label>
          <input id="zd-did" class="input" type="tel" maxlength="40" placeholder="+3491…">
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">${esc(t('sa.saveShop'))}</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('[data-form]');
      const errorBox = form.querySelector('[data-error]');
      const sipInput = form.querySelector('#zd-sip');
      const didInput = form.querySelector('#zd-did');
      const keyInput = form.querySelector('#zd-key');
      const secretInput = form.querySelector('#zd-secret');

      void (async () => {
        try {
          const payload = await api.shop(shopId);
          const shop = payload?.shop || payload;
          if (shop?.zadarma_sip) sipInput.value = shop.zadarma_sip;
          if (shop?.zadarma_did) didInput.value = shop.zadarma_did;
          if (shop?.zadarma_api_key_set) keyInput.placeholder = '•••••••• (configurada)';
          if (shop?.zadarma_api_secret_set) secretInput.placeholder = '•••••••• (configurada)';
        } catch (error) {
          errorBox.textContent = error.message;
        }
      })();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        errorBox.textContent = '';
        try {
          const payload = {
            zadarma_sip: sipInput.value.trim() || null,
            zadarma_did: didInput.value.trim() || null,
            did_zadarma: didInput.value.trim() || null,
          };
          const key = keyInput.value.trim();
          const secret = secretInput.value.trim();
          if (key) payload.zadarma_api_key = key;
          if (secret) payload.zadarma_api_secret = secret;
          await api.updateShop(shopId, payload);
          toast(t('sa.zadarmaSaved'), 'ok');
          close();
          await onSaved?.();
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}

/** Onboards a new Hostinger site: shop plus its owner account. */
function openNewShopSheet(onSaved) {
  sheet({
    title: 'Añadir un taller',
    body: `
      <form class="stack" data-form>
        <div class="field">
          <label class="field__label" for="new-shop-name">Nombre del taller</label>
          <input id="new-shop-name" class="input" required maxlength="160" placeholder="Talleres Norte">
        </div>
        <div class="field">
          <label class="field__label" for="new-shop-site">URL del sitio Hostinger</label>
          <input id="new-shop-site" class="input" type="url" placeholder="https://talleres-norte.com">
        </div>
        <div class="field">
          <label class="field__label" for="new-shop-tz">Zona horaria</label>
          <input id="new-shop-tz" class="input" value="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}" maxlength="64">
        </div>
        <div class="section-title"><span>Propietario</span></div>
        <div class="field">
          <label class="field__label" for="new-owner-name">Nombre completo</label>
          <input id="new-owner-name" class="input" maxlength="120" placeholder="Elena Costa">
        </div>
        <div class="field">
          <label class="field__label" for="new-owner-phone">Teléfono (con prefijo del país)</label>
          <input id="new-owner-phone" class="input" type="tel" placeholder="+34600333444">
          <span class="field__hint">Será su acceso y el número que los clientes pulsan para llamar.</span>
        </div>
        <button class="btn btn--block" type="submit">Crear taller</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('[data-form]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;

        const ownerName = form.querySelector('#new-owner-name').value.trim();
        const ownerPhone = form.querySelector('#new-owner-phone').value.trim();
        const payload = {
          name: form.querySelector('#new-shop-name').value.trim(),
          site_url: form.querySelector('#new-shop-site').value.trim() || null,
          timezone: form.querySelector('#new-shop-tz').value.trim() || null,
          ...(ownerName && ownerPhone ? { owner: { full_name: ownerName, phone: ownerPhone } } : {}),
        };

        try {
          const result = await api.post('/shops', payload);
          close();
          if (result.temporary_password) {
            sheet({
              title: 'Taller creado',
              body: `
                <div class="stack">
                  <p class="muted" style="font-size:14px">
                    Comparte estos datos con ${esc(result.owner?.full_name ?? 'el propietario')}. Puede cambiar la
                    contraseña desde su perfil.
                  </p>
                  <div class="kv"><span>Teléfono</span><strong>${esc(result.owner?.phone ?? '')}</strong></div>
                  <div class="kv"><span>Contraseña temporal</span><strong>${esc(result.temporary_password)}</strong></div>
                </div>`,
            });
          } else {
            toast('Taller creado', 'ok');
          }
          await onSaved();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    },
  });
}

// --- Support inbox -----------------------------------------------------------

export async function adminInboxView() {
  screen({
    title: 'Bandeja de soporte',
    nav: 'inbox',
    actions: `<button class="btn btn--icon" data-broadcast aria-label="Mensaje a todos los talleres">${icon('megaphone', { size: 18 })}</button>`,
    content: skeletonList(6),
  });

  let data;
  try {
    data = await api.adminInbox({ limit: 200 });
  } catch (error) {
    setContent(emptyState('No se pudo cargar la bandeja', error.message, 'x'));
    return undefined;
  }

  const main = setContent(
    data.threads.length
      ? `<div class="list">
           ${data.threads
             .map(
               (thread) => `
                 <button class="list__item" data-thread="${esc(thread.id)}">
                   <div class="grow">
                     <div class="row row--between" style="gap:8px">
                       <span class="list__title truncate">${esc(thread.shop_name)}</span>
                       ${
                         thread.unread_for_other > 0
                           ? `<span class="badge badge--warn">${num(thread.unread_for_other)} nuevo${thread.unread_for_other === 1 ? '' : 's'}</span>`
                           : `<span class="list__meta">${esc(ago(thread.last_message_at))}</span>`
                       }
                     </div>
                     <div class="list__meta truncate">${esc(thread.last_message_preview ?? 'Sin mensajes aún')}</div>
                     <div class="list__meta">
                       ${esc(thread.owner_name ?? 'Sin propietario')}${thread.owner_phone_display ? ` · ${esc(thread.owner_phone_display)}` : ''}
                     </div>
                   </div>
                   ${icon('chevron', { size: 16 })}
                 </button>`,
             )
             .join('')}
         </div>`
      : emptyState('La bandeja está vacía', 'Las conversaciones de soporte de tus talleres llegan aquí.', 'inbox'),
  );

  for (const button of main.querySelectorAll('[data-thread]')) {
    button.addEventListener('click', () => navigate(`/chat/${button.dataset.thread}`));
  }
  document.querySelector('[data-broadcast]')?.addEventListener('click', openBroadcastSheet);
  return undefined;
}

// --- Global call log ---------------------------------------------------------

export async function adminCallsView() {
  screen({ title: 'Llamadas', subtitle: 'Todos los talleres', nav: 'calls', content: skeletonList(6) });

  let data;
  let status;
  try {
    [data, status] = await Promise.all([api.allCalls({ limit: 100 }), api.telephonyStatus()]);
  } catch (error) {
    setContent(emptyState('No se pudieron cargar las llamadas', error.message, 'x'));
    return undefined;
  }

  setContent(`
    <div class="stack">
      ${
        status.configured || status.platform_configured
          ? ''
          : `<div class="banner banner--warn">
               ${icon('phone', { size: 18 })}
               <div>Zadarma no está conectado a nivel de plataforma. Configura <code>ZADARMA_KEY</code> /
               <code>ZADARMA_SECRET</code>, o el API Key / SIP / DID de cada taller en Superadmin.</div>
             </div>`
      }
      ${
        data.calls.length
          ? `<div class="list">
               ${data.calls
                 .map(
                   (call) => `
                     <div class="list__item list__item--static">
                       <div class="grow">
                         <div class="row row--between" style="gap:8px">
                           <span class="list__title truncate">
                             ${icon(call.direction === 'out' ? 'phone' : call.status === 'completed' ? 'phone' : 'missed', { size: 15 })}
                             ${esc(call.caller_phone_display ?? call.caller_phone ?? 'Desconocido')}
                           </span>
                           <span class="list__meta">${esc(ago(call.started_at))}</span>
                         </div>
                         <div class="list__meta">
                           ${esc(call.shop_name ?? 'Sin asignar')} · ${esc(call.direction === 'out' ? 'Saliente' : 'Entrante')}
                           · ${esc(call.status)}${call.duration_seconds ? ` · ${esc(duration(call.duration_seconds))}` : ''}
                         </div>
                         <div class="list__meta">${esc(dateTimeOf(call.started_at))}</div>
                       </div>
                     </div>`,
                 )
                 .join('')}
             </div>`
          : emptyState('Aún no hay llamadas', 'Las llamadas aparecen aquí cuando empiecen a llegar los webhooks de Zadarma.', 'phone')
      }
    </div>`);
  return undefined;
}

// --- Account management (Super Admin only) -----------------------------------

const ROLE_LABELS = {
  shop_owner: 'Dueño de taller',
  super_admin: 'Super Admin',
};

export async function adminUsersView({ query }) {
  if (!store.isSuperAdmin) {
    navigate('/', { replace: true });
    return undefined;
  }

  const search = query.get('q') ?? '';

  screen({
    title: 'Cuentas',
    subtitle: 'Gestión exclusiva del Super Admin',
    nav: 'users',
    actions: `<button class="btn btn--icon" data-new-user aria-label="Crear cuenta">${icon('plus', { size: 18 })}</button>`,
    content: skeletonList(6),
  });

  const render = async () => {
    let data;
    try {
      data = await api.adminUsers({ search: search || undefined, limit: 200 });
    } catch (error) {
      setContent(emptyState('No se pudieron cargar las cuentas', error.message, 'x'));
      return;
    }

    const main = setContent(`
      <div class="stack">
        <div class="field">
          <label class="sr-only" for="user-search">Buscar cuentas</label>
          <input id="user-search" class="input" type="search" value="${esc(search)}"
                 placeholder="Buscar por nombre, correo o teléfono" autocomplete="off">
        </div>
        <div class="list">
          ${
            data.users.length
              ? data.users
                  .map((user) => {
                    const shops = (user.shops || [])
                      .map((shop) => shop.name)
                      .filter(Boolean)
                      .join(', ');
                    const canDelete = user.role !== 'super_admin' && user.id !== store.user?.id;
                    return `
                      <div class="list__item list__item--static">
                        <div class="grow">
                          <div class="row row--between" style="gap:8px">
                            <span class="list__title truncate">${esc(user.full_name)}</span>
                            ${
                              user.status === 'active'
                                ? `<span class="badge badge--ok">Activa</span>`
                                : `<span class="badge badge--danger">${esc(user.status)}</span>`
                            }
                          </div>
                          <div class="list__meta truncate">${esc(user.email || 'Sin correo')}</div>
                          <div class="list__meta">
                            ${esc(ROLE_LABELS[user.role] ?? user.role)}
                            ${user.phone_display ? ` · ${esc(user.phone_display)}` : ''}
                          </div>
                          ${shops ? `<div class="list__meta truncate">${esc(shops)}</div>` : ''}
                          <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
                            ${
                              canDelete
                                ? `<button class="btn btn--small btn--danger" data-delete="${esc(user.id)}"
                                          data-name="${esc(user.full_name)}" data-email="${esc(user.email || '')}">
                                     Eliminar cuenta
                                   </button>`
                                : `<span class="list__meta">Cuenta protegida</span>`
                            }
                          </div>
                        </div>
                      </div>`;
                  })
                  .join('')
              : emptyState('Ninguna cuenta coincide', 'Prueba con otro término o crea una cuenta nueva.', 'team')
          }
        </div>
      </div>`);

    main.querySelector('#user-search').addEventListener('change', (event) => {
      const value = event.target.value.trim();
      navigate(value ? `/admin/users?q=${encodeURIComponent(value)}` : '/admin/users');
    });

    for (const button of main.querySelectorAll('[data-delete]')) {
      button.addEventListener('click', async () => {
        const confirmed = await confirmSheet({
          title: `¿Eliminar a ${button.dataset.name}?`,
          message: `Se borrará la cuenta${button.dataset.email ? ` (${button.dataset.email})` : ''} y, si no quedan más miembros, también su taller. Esta acción no se puede deshacer.`,
          confirmLabel: 'Eliminar definitivamente',
          danger: true,
        });
        if (!confirmed) return;
        button.disabled = true;
        try {
          await api.adminDeleteUser(button.dataset.delete);
          toast('Cuenta eliminada', 'ok');
          await render();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    }
  };

  await render();
  document.querySelector('[data-new-user]')?.addEventListener('click', () => openCreateAccountSheet(render));
  return undefined;
}

async function openCreateAccountSheet(onSaved) {
  let shops = [];
  try {
    const payload = await api.shops();
    shops = (payload.shops ?? []).filter((shop) => shop.status !== 'archived');
  } catch {
    shops = [];
  }

  const shopOptions = shops
    .map((shop) => `<option value="${esc(shop.id)}">${esc(shop.name)}${shop.city ? ` · ${esc(shop.city)}` : ''}</option>`)
    .join('');

  sheet({
    title: 'Crear nueva cuenta',
    body: `
      <form class="stack" data-form novalidate>
        <p style="color:var(--muted);font-size:13.5px;margin:0">
          Alta de dueño de taller con correo y contraseña. El teléfono es el contacto que verán los clientes.
        </p>
        <div class="field">
          <label class="field__label" for="acc-email">Correo electrónico</label>
          <input id="acc-email" class="input" type="email" required autocomplete="off" placeholder="taller@gmail.com">
        </div>
        <div class="field">
          <label class="field__label" for="acc-password">Contraseña</label>
          <input id="acc-password" class="input" type="password" required minlength="8" autocomplete="new-password">
          <span class="field__hint">Mínimo 8 caracteres, con letra y número.</span>
        </div>
        <div class="field">
          <label class="field__label" for="acc-name">Nombre del propietario</label>
          <input id="acc-name" class="input" required maxlength="120" placeholder="Marco Ruiz">
        </div>
        <div class="field">
          <label class="field__label" for="acc-phone">Teléfono de contacto</label>
          <input id="acc-phone" class="input" type="tel" required placeholder="+34600123456">
          <span class="field__hint">Con prefijo internacional (p. ej. +34…).</span>
        </div>

        <div class="section-title"><span>Taller</span></div>
        <label class="row" style="gap:8px;align-items:flex-start">
          <input type="checkbox" id="acc-create-shop" checked style="margin-top:3px">
          <span>
            <strong>Crear nuevo taller automático</strong>
            <div class="list__meta">Si lo desmarcas, elige un taller existente abajo.</div>
          </span>
        </label>
        <div class="field" data-new-shop-fields>
          <label class="field__label" for="acc-shop">Nombre del taller</label>
          <input id="acc-shop" class="input" maxlength="160" placeholder="Taller Derte Madrid">
        </div>
        <div class="field" data-existing-shop-fields hidden>
          <label class="field__label" for="acc-shop-id">Taller existente</label>
          <select id="acc-shop-id" class="input">
            <option value="">Selecciona un taller…</option>
            ${shopOptions || '<option value="" disabled>No hay talleres todavía</option>'}
          </select>
        </div>

        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Crear cuenta</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('[data-form]');
      const createToggle = form.querySelector('#acc-create-shop');
      const newFields = form.querySelector('[data-new-shop-fields]');
      const existingFields = form.querySelector('[data-existing-shop-fields]');
      const shopNameInput = form.querySelector('#acc-shop');
      const shopSelect = form.querySelector('#acc-shop-id');

      const syncShopMode = () => {
        const createNew = createToggle.checked;
        newFields.hidden = !createNew;
        existingFields.hidden = createNew;
        shopNameInput.required = createNew;
        shopSelect.required = !createNew;
      };
      createToggle.addEventListener('change', syncShopMode);
      syncShopMode();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const errorBox = form.querySelector('[data-error]');
        errorBox.textContent = '';
        button.disabled = true;
        try {
          const createNew = createToggle.checked;
          const payload = {
            email: form.querySelector('#acc-email').value.trim(),
            password: form.querySelector('#acc-password').value,
            full_name: form.querySelector('#acc-name').value.trim(),
            phone: form.querySelector('#acc-phone').value.trim(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            create_shop: createNew,
          };
          if (createNew) {
            const shopName = shopNameInput.value.trim();
            if (shopName.length < 2) {
              throw new Error('El nombre del taller es obligatorio');
            }
            payload.shop_name = shopName;
            payload.create_shop = true;
            // Never send an empty/invalid shop_id when creating a new shop.
          } else {
            const shopId = shopSelect.value.trim();
            if (!shopId) {
              throw new Error('Selecciona un taller existente o marca «Crear nuevo taller automático».');
            }
            payload.shop_id = shopId;
            payload.create_shop = false;
          }
          await api.adminCreateUser(payload);
          close();
          toast('Cuenta creada', 'ok');
          await onSaved();
        } catch (error) {
          const message = error?.message || 'No se pudo crear la cuenta';
          // Show the error once in the form — avoid a duplicate toast.
          errorBox.textContent = message;
          button.disabled = false;
        }
      });
    },
  });
}

// --- Sales reps & commissions -----------------------------------------------

const money = (value) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));

const salesTabs = (tab) => `
  <div class="segmented" role="tablist">
    <button role="tab" data-sales-tab="commissions" aria-pressed="${tab === 'commissions'}">${esc(t('sa.salesTabCommissions'))}</button>
    <button role="tab" data-sales-tab="reps" aria-pressed="${tab === 'reps'}">${esc(t('sa.salesTabReps'))}</button>
  </div>`;

function openAddSalesRepSheet(onSaved) {
  sheet({
    title: t('sa.salesAddRep'),
    body: `
      <form class="stack" data-create-rep novalidate>
        <div class="field">
          <label class="field__label" for="rep-name">${esc(t('sa.salesName'))}</label>
          <input class="input" id="rep-name" required autocomplete="name">
        </div>
        <div class="field">
          <label class="field__label" for="rep-phone">${esc(t('sa.salesPhone'))}</label>
          <input class="input" id="rep-phone" type="tel" placeholder="+34600…" autocomplete="tel">
        </div>
        <div class="field">
          <label class="field__label" for="rep-email">${esc(t('sa.salesEmail'))}</label>
          <input class="input" id="rep-email" type="email" autocomplete="email">
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">${esc(t('sa.salesCreateSubmit'))}</button>
      </form>`,
    onMount(content, close) {
      content.querySelector('[data-create-rep]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const errorBox = form.querySelector('[data-error]');
        const button = form.querySelector('button[type="submit"]');
        errorBox.textContent = '';
        button.disabled = true;
        try {
          const created = await api.adminCreateSalesRep({
            name: form.querySelector('#rep-name').value.trim(),
            phone: form.querySelector('#rep-phone').value.trim() || null,
            email: form.querySelector('#rep-email').value.trim() || null,
          });
          close();
          toast(t('sa.salesCreated'), 'ok');
          await copy(created.sales_rep.referral_link, t('sa.salesLinkCopied'));
          await onSaved?.();
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}

function commissionRow(row) {
  const statusLabel = row.status === 'paid' ? t('sa.commissionPaid') : t('sa.commissionPending');
  const signup = row.shop_created_at ? dayOf(row.shop_created_at) : ago(row.earned_at);
  return `
    <div class="comm-row">
      <div class="comm-row__cell">
        <span class="comm-row__label">${esc(t('sa.commissionColRep'))}</span>
        <span class="comm-row__value">${esc(row.sales_rep_name || '—')}</span>
      </div>
      <div class="comm-row__cell">
        <span class="comm-row__label">${esc(t('sa.commissionColShop'))}</span>
        <span class="comm-row__value">${esc(row.shop_name || '—')}</span>
      </div>
      <div class="comm-row__cell">
        <span class="comm-row__label">${esc(t('sa.commissionColDate'))}</span>
        <span class="comm-row__value comm-row__value--muted">${esc(signup)}</span>
      </div>
      <div class="comm-row__cell">
        <span class="comm-row__label">${esc(t('sa.commissionColAmount'))}</span>
        <span class="comm-row__value">${esc(money(row.amount ?? 50))}</span>
      </div>
      <div class="comm-row__cell">
        <span class="comm-row__label">${esc(t('sa.commissionColStatus'))}</span>
        <span class="badge ${row.status === 'paid' ? '' : 'badge--warn'}">${esc(statusLabel)}</span>
      </div>
      <div class="comm-row__action">
        ${
          row.status === 'pending'
            ? `<button class="btn btn--small" data-pay="${esc(row.id)}">${esc(t('sa.commissionMarkPaid'))}</button>`
            : `<span class="list__meta">${esc(t('sa.commissionPaid'))}</span>`
        }
      </div>
    </div>`;
}

export async function adminSalesView({ query }) {
  // Default landing is the commissions panel.
  const tab = query?.get('tab') === 'reps' ? 'reps' : 'commissions';

  screen({
    title: t('sa.salesPanelTitle'),
    subtitle: tab === 'commissions' ? t('sa.salesTabCommissions') : t('sa.salesTabReps'),
    nav: 'sales',
    actions: `<button class="btn btn--small" data-add-rep>${esc(t('sa.salesAddRep'))}</button>`,
    content: skeletonList(5),
  });

  const bindChrome = (main, reloadPath) => {
    document.querySelector('.header [data-add-rep]')?.addEventListener('click', () =>
      openAddSalesRepSheet(() => navigate(reloadPath, { replace: true })),
    );
    for (const button of main.querySelectorAll('[data-sales-tab]')) {
      button.addEventListener('click', () =>
        navigate(`/admin/commissions?tab=${button.dataset.salesTab}`),
      );
    }
  };

  if (tab === 'commissions') {
    const filter = query?.get('status') || 'pending';
    let data;
    try {
      data = await api.adminCommissions({ status: filter });
    } catch (error) {
      setContent(emptyState('No se pudieron cargar las comisiones', error.message, 'x'));
      return undefined;
    }

    const main = setContent(`
      <div class="stack">
        ${salesTabs(tab)}
        <div class="chips" role="tablist">
          ${['pending', 'paid', 'all']
            .map(
              (status) =>
                `<button class="chip" data-comm-filter="${status}" aria-pressed="${filter === status}">${esc(
                  status === 'pending'
                    ? t('sa.filterPending')
                    : status === 'paid'
                      ? t('sa.filterPaid')
                      : t('sa.filterAll'),
                )}</button>`,
            )
            .join('')}
        </div>
        ${
          filter !== 'paid'
            ? `<div class="banner">
                 ${icon('bell', { size: 18 })}
                 <div><strong>${esc(money(data.pending_total))}</strong> ${esc(t('sa.commissionPendingTotal'))}</div>
               </div>`
            : ''
        }
        ${
          data.commissions.length
            ? `<div class="comm-table">
                 <div class="comm-row comm-row--head" aria-hidden="true">
                   <div class="comm-row__cell"><span class="comm-row__label">${esc(t('sa.commissionColRep'))}</span><span class="comm-row__value"></span></div>
                   <div class="comm-row__cell"><span class="comm-row__label">${esc(t('sa.commissionColShop'))}</span><span class="comm-row__value"></span></div>
                   <div class="comm-row__cell"><span class="comm-row__label">${esc(t('sa.commissionColDate'))}</span><span class="comm-row__value"></span></div>
                   <div class="comm-row__cell"><span class="comm-row__label">${esc(t('sa.commissionColAmount'))}</span><span class="comm-row__value"></span></div>
                   <div class="comm-row__cell"><span class="comm-row__label">${esc(t('sa.commissionColStatus'))}</span><span class="comm-row__value"></span></div>
                   <div class="comm-row__action"><span class="comm-row__label">${esc(t('sa.commissionColAction'))}</span></div>
                 </div>
                 ${data.commissions.map((row) => commissionRow(row)).join('')}
               </div>`
            : emptyState(t('sa.commissionsEmpty'), t('sa.commissionsEmptyHint'), 'megaphone')
        }
      </div>`);

    bindChrome(main, `/admin/commissions?tab=commissions&status=${filter}`);
    for (const chip of main.querySelectorAll('[data-comm-filter]')) {
      chip.addEventListener('click', () =>
        navigate(`/admin/commissions?tab=commissions&status=${chip.dataset.commFilter}`),
      );
    }
    for (const button of main.querySelectorAll('[data-pay]')) {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api.adminPayCommission(button.dataset.pay);
          toast(t('sa.commissionMarked'), 'ok');
          navigate(`/admin/commissions?tab=commissions&status=${filter}&r=${Date.now()}`, { replace: true });
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    }
    return undefined;
  }

  let data;
  try {
    data = await api.adminSalesReps();
  } catch (error) {
    setContent(emptyState('No se pudieron cargar los comerciales', error.message, 'x'));
    return undefined;
  }

  const main = setContent(`
    <div class="stack">
      ${salesTabs(tab)}
      <p class="list__meta" style="margin:0">${esc(t('sa.salesEmptyHint'))}</p>
      ${
        data.sales_reps.length
          ? `<div class="list">
               ${data.sales_reps
                 .map(
                   (rep) => `
                     <div class="list__item list__item--static" style="flex-direction:column;align-items:stretch;gap:8px">
                       <div class="row row--between" style="gap:8px">
                         <div class="grow">
                           <div class="list__title truncate">${esc(rep.name)}</div>
                           <div class="list__meta truncate">
                             ${esc(t('sa.salesReferral'))}: <code>${esc(rep.referral_code)}</code>
                           </div>
                           <div class="list__meta">
                             ${num(rep.shop_count ?? 0)} ${esc(t('sa.salesShops'))}
                             · ${num(rep.pending_commissions ?? 0)} ${esc(t('sa.salesPending'))}
                             · ${esc(t('sa.salesTotalPaid'))}: ${esc(money(rep.total_commissions))}
                           </div>
                         </div>
                       </div>
                       <div class="row" style="gap:8px;flex-wrap:wrap">
                         <button class="btn btn--soft btn--small" data-copy-link="${esc(rep.referral_link)}">
                           ${icon('link', { size: 15 })} ${esc(t('sa.salesCopyLink'))}
                         </button>
                       </div>
                     </div>`,
                 )
                 .join('')}
             </div>`
          : emptyState(t('sa.salesEmpty'), t('sa.salesEmptyHint'), 'megaphone')
      }
    </div>`);

  bindChrome(main, '/admin/commissions?tab=reps');
  for (const button of main.querySelectorAll('[data-copy-link]')) {
    button.addEventListener('click', async () => {
      await copy(button.dataset.copyLink, t('sa.salesLinkCopied'));
    });
  }

  return undefined;
}
