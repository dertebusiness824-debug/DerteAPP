/** Shop owner home screen: today at a glance, plus what needs an answer now. */
import { api, stream } from '../api.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { refreshBadges, openPlatformSupport, store } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import { emptyState, esc, icon, num, skeletonList, toast } from '../ui.js';
import { appointmentRow, openNewBookingSheet } from './appointments.js';

const openStateText = () => ({
  closed_today: t('home.closedToday'),
  before_opening: t('home.beforeOpening'),
  after_closing: t('home.afterClosing'),
  on_break: t('home.onBreak'),
});

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return t('greeting.morning');
  if (hour < 18) return t('greeting.afternoon');
  return t('greeting.evening');
};

export async function homeView() {
  const shop = requireShop({ title: 'DerteApp', navKey: 'home' });
  if (!shop) return undefined;

  screen({
    title: `${greeting()}, ${store.user.full_name.split(' ')[0]}`,
    subtitle: shop.name,
    nav: 'home',
    shopSwitcher: true,
    actions: `<button class="btn btn--icon" data-new aria-label="${esc(t('home.newBooking'))}">${icon('plus', { size: 20 })}</button>`,
    content: skeletonList(5),
  });

  document.querySelector('.header [data-new]')?.addEventListener('click', () => openNewBookingSheet(shop, load));

  async function load() {
    let overview;
    let today;
    let pending;
    try {
      [overview, today, pending] = await Promise.all([
        api.overview(shop.id),
        api.todayAppointments(shop.id),
        api.appointments({ shop_id: shop.id, status: 'pending', limit: 20 }),
      ]);
    } catch (error) {
      setContent(emptyState(t('home.loadError'), error.message, 'x'));
      return;
    }

    const stats = overview.stats;
    const hours = overview.today_hours;
    const openLabel = overview.open_now
      ? t('home.openNow')
      : (openStateText()[overview.open_state_reason] ?? t('home.closed'));
    const hoursLabel = hours?.is_closed
      ? (hours.note ?? t('home.dayOff'))
      : `${hours?.open_time ?? '—'}–${hours?.close_time ?? '—'}${hours?.break_start ? ` · ${t('home.break')} ${hours.break_start}–${hours.break_end}` : ''}`;

    const main = setContent(`
      <div class="stack">
        <div class="card ${overview.open_now ? 'card--accent' : 'card--flat'}">
          <div class="row row--between">
            <div>
              <div class="row" style="gap:7px">
                <span class="dot" style="color:${overview.open_now ? 'var(--ok)' : 'var(--muted)'}"></span>
                <strong>${esc(openLabel)}</strong>
              </div>
              <div class="list__meta" style="margin-top:2px">${esc(hoursLabel)}</div>
            </div>
            <a class="btn btn--small btn--ghost" href="/schedule">${icon('clock', { size: 16 })} ${esc(t('home.schedule'))}</a>
          </div>
        </div>

        <div class="stats">
          <div class="stat">
            <div class="stat__value">${num(stats.today_total)}</div>
            <div class="stat__label">${esc(t('home.jobsToday'))}</div>
          </div>
          <div class="stat${stats.pending ? ' stat--alert' : ''}">
            <div class="stat__value">${num(stats.pending)}</div>
            <div class="stat__label">${esc(t('home.pendingReply'))}</div>
          </div>
          <div class="stat">
            <div class="stat__value">${num(stats.in_progress)}</div>
            <div class="stat__label">${esc(t('home.inShop'))}</div>
          </div>
          <div class="stat${stats.missed_calls_today ? ' stat--alert' : ''}">
            <div class="stat__value">${num(stats.missed_calls_today)}</div>
            <div class="stat__label">${esc(t('home.missedCalls'))}</div>
          </div>
        </div>

        ${
          pending.count
            ? `<div class="section-title"><span>${esc(t('home.pendingSection'))}</span><span>${num(pending.count)}</span></div>
               <div class="list">
                 ${pending.appointments
                   .slice(0, 4)
                   .map(
                     (appointment) => `
                       <div class="list__item list__item--static" style="flex-direction:column;align-items:stretch;gap:10px">
                         <div class="row row--between">
                           <div class="grow" data-open="${esc(appointment.id)}" style="cursor:pointer">
                             <div class="list__title truncate">${esc(appointment.customer_name)}</div>
                             <div class="list__meta truncate">
                               ${esc(appointment.scheduled_local)}${appointment.service_type ? ` · ${esc(appointment.service_type)}` : ''}
                             </div>
                           </div>
                           ${
                             appointment.customer_mailto_link
                               ? `<a class="btn btn--icon" href="${esc(appointment.customer_mailto_link)}" data-native="true" aria-label="${esc(t('appointments.sendEmail'))}">
                                    ${icon('mail', { size: 17 })}
                                  </a>`
                               : ''
                           }
                         </div>
                         <div class="btn-row">
                           <button class="btn btn--small" data-accept="${esc(appointment.id)}">Aceptar</button>
                           <button class="btn btn--small btn--soft" data-open="${esc(appointment.id)}">Detalles</button>
                         </div>
                       </div>`,
                   )
                   .join('')}
               </div>
               ${pending.count > 4 ? '<a class="btn btn--soft btn--block btn--small" href="/appointments?filter=pending">Ver todas las solicitudes</a>' : ''}`
            : ''
        }

        <div class="section-title">
          <span>${esc(t('home.todaySection'))}${today.appointments.length ? '' : ''}</span>
          <a href="/appointments?filter=today" style="font-size:12px">${esc(t('home.openToday'))}</a>
        </div>
        ${
          today.appointments.length
            ? `<div class="list">${today.appointments.map((item) => appointmentRow(item)).join('')}</div>`
            : emptyState(t('appointments.empty'), '', 'car')
        }

        <div class="section-title"><span>Accesos rápidos</span></div>
        <div class="list">
          <button class="list__item" type="button" data-support-wa>
            ${icon('chat')}
            <div class="grow"><div class="list__title">Soporte DerteApp</div>
              <div class="list__meta">WhatsApp / llamada al equipo de DerteApp</div>
            </div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </button>
          <a class="list__item" href="/insights">
            ${icon('chart')}
            <div class="grow"><div class="list__title">Estadísticas web y llamadas</div>
              <div class="list__meta">${num(stats.site_views_today)} visitas a la web hoy</div>
            </div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
          <a class="list__item" href="/settings/website">
            ${icon('code')}
            <div class="grow"><div class="list__title">Formulario de reservas web</div>
              <div class="list__meta">Conecta tu sitio de Hostinger</div>
            </div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
        </div>
      </div>`);

    main.querySelector('[data-support-wa]')?.addEventListener('click', () => openPlatformSupport());

    main.addEventListener('click', async (event) => {
      const row = event.target.closest('[data-appointment], [data-open]');
      if (row) {
        navigate(`/appointments/${row.dataset.appointment ?? row.dataset.open}`);
        return;
      }
      const accept = event.target.closest('[data-accept]');
      if (accept) {
        accept.disabled = true;
        try {
          await api.acceptAppointment(accept.dataset.accept, shop.id);
          toast('Confirmada — llama al cliente desde la reserva', 'ok');
          await refreshBadges();
          await load();
        } catch (error) {
          toast(error.message, 'error');
          accept.disabled = false;
        }
      }
    });
  }

  await load();
  await refreshBadges();

  // Live nudges: a new booking or message updates the screen without a refresh.
  const stopStream = stream(`/chat/stream?shop_id=${shop.id}`, {
    appointment_created: (payload) => {
      toast(
        payload?.source === 'google' ? t('appointments.googleNewToast') : 'Nueva solicitud de reserva',
        'ok',
      );
      load();
      refreshBadges();
    },
    appointment_updated: () => load(),
    chat_message: () => refreshBadges(),
    call_event: (payload) => {
      if (payload?.event === 'NOTIFY_START') toast(`Llamada entrante ${payload.call?.caller_phone_display ?? ''}`.trim());
      load();
    },
  });

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshBadges();
  }, 60_000);

  return () => {
    stopStream();
    clearInterval(timer);
  };
}
