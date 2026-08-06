/**
 * Super Admin screens: the master dashboard across all client sites, the shop
 * directory with its switcher, the central support inbox and the global call log.
 */
import { api } from '../api.js';
import { navigate } from '../router.js';
import { refreshBadges, setActiveShop, store } from '../store.js';
import { screen, setContent } from '../shell.js';
import {
  ago,
  barChart,
  confirmSheet,
  contactButtons,
  dateTimeOf,
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
  return undefined;
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
        navigate('/settings/shop');
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

    const main = setContent(`
      <div class="stack">
        <div class="field">
          <label class="sr-only" for="shop-search">Buscar talleres</label>
          <input id="shop-search" class="input" type="search" value="${esc(search)}"
                 placeholder="Buscar por nombre, web o teléfono del propietario" autocomplete="off">
        </div>
        <div class="list">
          ${
            data.shops.length
              ? data.shops
                  .map(
                    (shop) => `
                      <div class="list__item list__item--static">
                        <div class="grow">
                          <div class="row row--between" style="gap:8px">
                            <span class="list__title truncate">${esc(shop.name)}</span>
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
                          <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
                            <button class="btn btn--small" data-open="${esc(shop.id)}">Abrir panel</button>
                            <button class="btn btn--small btn--soft" data-support="${esc(shop.id)}">Chat de soporte</button>
                            <button class="btn btn--small btn--soft" data-status="${esc(shop.id)}"
                                    data-current="${esc(shop.status)}" data-name="${esc(shop.name)}">
                              ${shop.status === 'active' ? 'Suspender' : 'Reactivar'}
                            </button>
                          </div>
                        </div>
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

    for (const button of main.querySelectorAll('[data-open]')) {
      button.addEventListener('click', async () => {
        setActiveShop(button.dataset.open);
        await refreshBadges();
        navigate('/');
      });
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
        status.configured
          ? ''
          : `<div class="banner banner--warn">
               ${icon('phone', { size: 18 })}
               <div>Zadarma no está conectado. Configura <code>ZADARMA_KEY</code> y <code>ZADARMA_SECRET</code> para registrar llamadas
               y habilitar la marcación con un toque.</div>
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

function openCreateAccountSheet(onSaved) {
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
          <label class="field__label" for="acc-shop">Nombre del taller</label>
          <input id="acc-shop" class="input" required maxlength="160" placeholder="Taller Derte Madrid">
        </div>
        <div class="field">
          <label class="field__label" for="acc-phone">Teléfono de contacto</label>
          <input id="acc-phone" class="input" type="tel" required placeholder="+34600123456">
          <span class="field__hint">Con prefijo internacional (p. ej. +34…).</span>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Crear cuenta</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('[data-form]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const errorBox = form.querySelector('[data-error]');
        errorBox.textContent = '';
        button.disabled = true;
        try {
          await api.adminCreateUser({
            email: form.querySelector('#acc-email').value.trim(),
            password: form.querySelector('#acc-password').value,
            full_name: form.querySelector('#acc-name').value.trim(),
            shop_name: form.querySelector('#acc-shop').value.trim(),
            phone: form.querySelector('#acc-phone').value.trim(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
          close();
          toast('Cuenta creada', 'ok');
          await onSaved();
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}
