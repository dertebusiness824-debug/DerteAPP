/**
 * Shop owner Dashboard (home).
 *
 * Intentionally has NO pending-accept queue:
 * - no metric "Pendientes de respuesta"
 * - no section "PENDIENTES DE TU RESPUESTA"
 * - no "Aceptar" button
 *
 * Bookings land as Confirmada; each card offers Cancelar + Detalles only.
 * Near shop closing (close − 30 min) cards flip to Completada.
 */
import { api, stream } from '../api.js';
import {
  applyClosingAutoComplete,
  canCancelAppointment,
} from '../booking-lifecycle.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { refreshBadges, openPlatformSupport, store, loadSession, setActiveShop } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import { bindReauthPanel, isSessionLinkError, reauthPanel } from '../session-errors.js';
import { confirmSheet, emptyState, esc, icon, num, skeletonList, statusBadge, toast } from '../ui.js';
import { openNewBookingSheet } from './appointments.js';
import { bindYearlyHistoryCard, yearlyHistoryCard } from './yearly-history.js';

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

const emptyHistory = (year = new Date().getFullYear()) => ({
  year,
  total: 0,
  months: Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    label: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][index],
    count: 0,
  })),
  breakdown: { completed: 0, confirmed: 0 },
  available_years: [year],
});

function showReauth(title, body) {
  const main = setContent(reauthPanel({ title, body }));
  bindReauthPanel(main);
  return main;
}

/** Only confirmed / completed / in_progress — never pending/accepted. */
function dashboardTodayList(appointments) {
  return (appointments || []).filter((item) =>
    ['confirmed', 'completed', 'in_progress'].includes(item.status),
  );
}

function bookingCard(appointment) {
  const vehicle = appointment.vehicle?.label;
  const plate = appointment.vehicle?.plate;
  const canCancel = canCancelAppointment(appointment);
  return `
    <div class="list__item list__item--static" style="flex-direction:column;align-items:stretch;gap:10px"
         data-booking-card="${esc(appointment.id)}">
      <button class="grow" type="button" data-open="${esc(appointment.id)}"
              style="text-align:left;background:none;border:0;padding:0;color:inherit">
        <div class="row row--between" style="gap:8px">
          <div class="list__title truncate">${esc(appointment.customer_name)}</div>
          ${statusBadge(appointment.status)}
        </div>
        <div class="list__meta truncate">
          ${esc(appointment.scheduled_local)}
          ${appointment.service_type ? ` · ${esc(appointment.service_type)}` : ''}
          ${vehicle ? ` · ${esc(vehicle)}` : ''}
          ${plate ? ` · ${esc(plate)}` : ''}
        </div>
      </button>
      <div class="btn-row">
        ${
          canCancel
            ? `<button class="btn btn--small btn--danger" type="button" data-cancel="${esc(appointment.id)}">
                 ${esc(t('appointments.cancelBooking'))}
               </button>`
            : ''
        }
        <button class="btn btn--small btn--soft" type="button" data-open="${esc(appointment.id)}">Detalles</button>
      </div>
    </div>`;
}

export async function homeView() {
  if (!store.user?.id && !store.user?.uid) {
    screen({ title: 'DerteApp', nav: 'home', content: reauthPanel() });
    bindReauthPanel(document.querySelector('.main'));
    return undefined;
  }

  let shop = store.activeShop;
  if (!shop) {
    try {
      await loadSession();
      shop = store.activeShop;
      if (!shop && store.shops?.[0]) {
        setActiveShop(store.shops[0].id);
        shop = store.activeShop;
      }
    } catch {
      // fall through
    }
  }

  shop = requireShop({ title: 'DerteApp', navKey: 'home' });
  if (!shop) return undefined;

  let historyYear;
  let loading = false;

  screen({
    title: `${greeting()}, ${(store.user.full_name || 'Taller').split(' ')[0]}`,
    subtitle: shop.name,
    nav: 'home',
    shopSwitcher: true,
    actions: `<button class="btn btn--icon" data-new aria-label="${esc(t('home.newBooking'))}">${icon('plus', { size: 20 })}</button>`,
    content: skeletonList(5),
  });

  document.querySelector('.header [data-new]')?.addEventListener('click', () => openNewBookingSheet(shop, load));

  async function cancelBooking(appointmentId, button) {
    const outcome = await confirmSheet({
      title: t('appointments.cancelBooking'),
      message: t('appointments.cancelConfirm'),
      confirmLabel: t('appointments.cancelBooking'),
      danger: true,
    });
    if (!outcome) return;
    if (button) button.disabled = true;
    try {
      await api.setAppointmentStatus(appointmentId, { shop_id: shop.id, status: 'cancelled' });
      toast(t('appointments.cancelToast'), 'ok');
      await refreshBadges();
      await load();
    } catch (error) {
      if (isSessionLinkError(error)) {
        showReauth();
        return;
      }
      if (button) button.disabled = false;
    }
  }

  async function load() {
    if (loading) return;
    loading = true;
    let overview;
    let today;
    let history;
    try {
      const settled = await Promise.allSettled([
        api.overview(shop.id),
        api.todayAppointments(shop.id),
        api.yearlyHistory(shop.id, historyYear),
      ]);
      const [overviewResult, todayResult, historyResult] = settled;
      if (overviewResult.status === 'rejected') throw overviewResult.reason;
      if (todayResult.status === 'rejected') throw todayResult.reason;
      overview = overviewResult.value;
      today = todayResult.value;
      history = historyResult.status === 'fulfilled' ? historyResult.value : emptyHistory(historyYear);
    } catch (error) {
      loading = false;
      if (isSessionLinkError(error)) {
        showReauth();
        return;
      }
      setContent(emptyState(t('home.loadError'), 'Recarga en un momento o vuelve más tarde.', 'x'));
      return;
    } finally {
      loading = false;
    }

    historyYear = history.year;
    const stats = overview.stats || {};
    const hours = overview.today_hours;
    const timeZone = shop.timezone || overview.timezone || 'Europe/Madrid';
    const openLabel = overview.open_now
      ? t('home.openNow')
      : (openStateText()[overview.open_state_reason] ?? t('home.closed'));
    const hoursLabel = hours?.is_closed
      ? (hours.note ?? t('home.dayOff'))
      : `${hours?.open_time ?? '—'}–${hours?.close_time ?? '—'}${hours?.break_start ? ` · ${t('home.break')} ${hours.break_start}–${hours.break_end}` : ''}`;

    // Auto-complete near closing (close − 30 min) inside the Dashboard render.
    let todayAppointments = applyClosingAutoComplete(today.appointments || [], {
      closeTime: hours?.close_time,
      isClosed: Boolean(hours?.is_closed),
      timeZone,
    });
    const toPersist = todayAppointments.filter((item) => item._autoCompleted);
    if (toPersist.length) {
      await Promise.all(
        toPersist.map((item) =>
          api
            .setAppointmentStatus(item.id, { shop_id: shop.id, status: 'completed' })
            .catch(() => null),
        ),
      );
      todayAppointments = todayAppointments.map((item) =>
        item._autoCompleted
          ? { ...item, status: 'completed', allowed_transitions: [], _autoCompleted: false }
          : item,
      );
    }

    const activeToday = dashboardTodayList(todayAppointments);

    const main = setContent(`
      <div class="stack" data-dashboard-home="confirmed-only">
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
            <div class="stat__value">${num(stats.confirmed_today ?? stats.today_total ?? 0)}</div>
            <div class="stat__label">Confirmadas hoy</div>
          </div>
          <div class="stat">
            <div class="stat__value">${num(stats.in_progress ?? 0)}</div>
            <div class="stat__label">${esc(t('home.inShop'))}</div>
          </div>
          <div class="stat">
            <div class="stat__value">${num(stats.upcoming ?? 0)}</div>
            <div class="stat__label">${esc(t('appointments.filter.upcoming'))}</div>
          </div>
          <div class="stat${stats.missed_calls_today ? ' stat--alert' : ''}">
            <div class="stat__value">${num(stats.missed_calls_today ?? 0)}</div>
            <div class="stat__label">${esc(t('home.missedCalls'))}</div>
          </div>
        </div>

        ${yearlyHistoryCard(history)}

        <div class="section-title">
          <span>Hoy</span>
          <a href="/appointments?filter=today" style="font-size:12px">${esc(t('home.openToday'))}</a>
        </div>
        ${
          activeToday.length
            ? `<div class="list" data-today-confirmed>${activeToday.map(bookingCard).join('')}</div>`
            : emptyState('No hay reservas confirmadas hoy', '', 'car')
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
              <div class="list__meta">${num(stats.site_views_today ?? 0)} visitas a la web hoy</div>
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
    bindYearlyHistoryCard(main, (year) => {
      historyYear = year;
      void load();
    });

    main.addEventListener('click', async (event) => {
      if (event.target.closest('[data-accept]')) {
        // Hard block — Accept workflow is gone.
        event.preventDefault();
        toast('Las reservas ya llegan confirmadas', 'ok');
        return;
      }
      const cancel = event.target.closest('[data-cancel]');
      if (cancel) {
        await cancelBooking(cancel.dataset.cancel, cancel);
        return;
      }
      const row = event.target.closest('[data-open]');
      if (row) navigate(`/appointments/${row.dataset.open}`);
    });
  }

  await load();
  await refreshBadges();

  const stopStream = stream(`/chat/stream?shop_id=${shop.id}`, {
    appointment_created: (payload) => {
      toast(
        payload?.source === 'google' ? t('appointments.googleNewToast') : 'Nueva reserva confirmada',
        'ok',
      );
      void load();
      void refreshBadges();
    },
    appointment_updated: () => void load(),
    chat_message: () => void refreshBadges(),
    call_event: (payload) => {
      if (payload?.event === 'NOTIFY_START') toast(`Llamada entrante ${payload.call?.caller_phone_display ?? ''}`.trim());
      void load();
    },
  });

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshBadges();
  }, 60_000);

  return () => {
    stopStream();
    clearInterval(timer);
  };
}
