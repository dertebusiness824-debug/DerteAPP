/** Bookings: filtered list, detail screen, status flow and manual entry. */
import { api } from '../api.js';
import { applyTabFilter } from '../booking-filters.js';
import {
  applyClosingAutoComplete,
  canCancelAppointment,
} from '../booking-lifecycle.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { refreshBadges, setActiveShop, store } from '../store.js';
import { screen, setContent } from '../shell.js';
import {
  confirmSheet,
  emptyState,
  esc,
  icon,
  reasonSheet,
  sheet,
  skeletonList,
  statusBadge,
  timeOf,
  toast,
} from '../ui.js';

/** One booking row with status badge + Cancelar (hidden when completed). */
export function appointmentRow(appointment, { showDay = false } = {}) {
  const vehicle = appointment.vehicle?.label;
  const plate = appointment.vehicle?.plate;
  const canCancel = canCancelAppointment(appointment);
  const when = showDay
    ? appointment.scheduled_local
    : timeOf(appointment.scheduled_at, appointment.timezone);

  return `
    <div class="list__item list__item--static" style="flex-direction:column;align-items:stretch;gap:10px"
         data-booking-row="${esc(appointment.id)}">
      <button class="grow" type="button" data-appointment="${esc(appointment.id)}"
              style="all:unset;cursor:pointer;display:block;min-width:0;width:100%;text-align:left;color:inherit">
        <div class="row row--between" style="gap:8px">
          <span class="list__title truncate">${esc(appointment.customer_name)}</span>
          ${statusBadge(appointment.status)}
        </div>
        <div class="list__meta truncate">
          ${esc(when || '')}
          ${appointment.service_type ? ` · ${esc(appointment.service_type)}` : ''}
          ${vehicle ? ` · ${esc(vehicle)}` : ''}
          ${plate ? ` · ${esc(plate)}` : ''}
        </div>
        ${
          appointment.customer_email
            ? `<div class="list__meta truncate">${esc(appointment.customer_email)}</div>`
            : ''
        }
      </button>
      <div class="btn-row">
        ${
          canCancel
            ? `<button class="btn btn--small btn--danger" type="button" data-cancel="${esc(appointment.id)}">
                 ${esc(t('appointments.cancelBooking'))}
               </button>`
            : ''
        }
        <button class="btn btn--small btn--soft" type="button" data-appointment="${esc(appointment.id)}">
          Detalles
        </button>
      </div>
    </div>`;
}

const FILTERS = () => [
  { key: 'today', label: t('appointments.filter.today') },
  { key: 'upcoming', label: t('appointments.filter.upcoming') },
  { key: 'completed', label: t('appointments.filter.completed') },
  { key: 'all', label: t('appointments.filter.all') },
];

const sourceLabel = (source) => t(`source.${source}`) || source;

function resolveShop() {
  if (store.activeShop) return store.activeShop;
  if (store.shops?.[0]?.id) {
    setActiveShop(store.shops[0].id);
    return store.activeShop || store.shops[0];
  }
  return null;
}

function filterParams(filter, shopId) {
  // Broad server fetches — strict tab logic runs client-side in applyTabFilter
  // so Hoy can fall back to recent confirmed when the calendar day is empty.
  switch (filter) {
    case 'upcoming':
      return { shop_id: shopId, status: 'confirmed', limit: 100 };
    case 'completed':
      return { shop_id: shopId, status: 'completed', limit: 100 };
    case 'today':
    case 'all':
    default:
      return { shop_id: shopId, limit: 100 };
  }
}

/**
 * Hardened fetch — NEVER throws, NEVER surfaces auth errors to the UI.
 * On any failure returns [].
 */
async function fetchBookingsSafe(shop, filter, search) {
  if (!shop?.id && !shop?.public_key) {
    console.error('[appointments] no shop context — returning empty list');
    return [];
  }

  const params = {
    ...filterParams(filter, shop.id),
    ...(search ? { search } : {}),
  };

  try {
    const result = await api.appointments(params);
    return Array.isArray(result?.appointments) ? result.appointments : [];
  } catch (error) {
    console.error('[appointments] session list failed, trying board fallback', error);
  }

  if (shop.public_key) {
    try {
      const board = await api.appointmentsBoard({
        public_key: shop.public_key,
        date: params.date,
        from: params.from,
        status: params.status,
        search: params.search,
        limit: params.limit ?? 100,
      });
      return Array.isArray(board?.appointments) ? board.appointments : [];
    } catch (error) {
      console.error('[appointments] board fallback failed', error);
    }
  }

  return [];
}

export async function appointmentsView({ query }) {
  const filter = query.get('filter') ?? 'today';
  const search = query.get('q') ?? '';
  const shop = resolveShop();

  // ALWAYS paint chips + search + list shell — never an auth/error wall.
  screen({
    title: t('appointments.title'),
    subtitle: shop?.name || 'DerteApp',
    nav: 'appointments',
    shopSwitcher: Boolean(shop),
    actions: shop
      ? `<button class="btn btn--icon" data-new aria-label="${esc(t('home.newBooking'))}">${icon('plus', { size: 20 })}</button>`
      : '',
    content: `
      <div class="stack" data-appointments-shell>
        <div class="chips" role="tablist">
          ${FILTERS()
            .map(
              (item) =>
                `<button class="chip" role="tab" data-filter="${item.key}" aria-pressed="${item.key === filter}">${esc(item.label)}</button>`,
            )
            .join('')}
        </div>
        <input class="input" type="search" placeholder="${esc(t('appointments.search'))}"
               value="${esc(search)}" data-search>
        <div data-list>${skeletonList(4)}</div>
      </div>`,
  });

  const main = document.querySelector('.main');
  const container = main.querySelector('[data-list]');

  document.querySelector('.header [data-new]')?.addEventListener('click', () => {
    if (shop) openNewBookingSheet(shop, () => void loadList());
  });

  const paintList = (appointments) => {
    const rows = Array.isArray(appointments) ? appointments : [];
    container.innerHTML = rows.length
      ? `<div class="list" data-booking-list>
           ${rows.map((item) => appointmentRow(item, { showDay: filter !== 'today' })).join('')}
         </div>`
      : emptyState(
          search ? 'Nada coincide con esa búsqueda' : 'Aún no hay reservas aquí',
          search
            ? 'Prueba un nombre, teléfono o matrícula.'
            : 'Las nuevas reservas de tu web llegan ya confirmadas.',
          'calendar',
        );
  };

  const cancelBooking = async (appointmentId, button) => {
    if (!shop?.id) return;
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
      await loadList();
    } catch (error) {
      console.error('[appointments] cancel failed', error);
      toast('No se pudo cancelar ahora', 'danger');
      if (button) button.disabled = false;
    }
  };

  main.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (chip) {
      navigate(`/appointments?filter=${chip.dataset.filter}${search ? `&q=${encodeURIComponent(search)}` : ''}`);
      return;
    }
    const cancel = event.target.closest('[data-cancel]');
    if (cancel) {
      void cancelBooking(cancel.dataset.cancel, cancel);
      return;
    }
    const row = event.target.closest('[data-appointment]');
    if (row) navigate(`/appointments/${row.dataset.appointment}`);
  });

  const searchInput = main.querySelector('[data-search]');
  let timer;
  searchInput?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const value = searchInput.value.trim();
      navigate(`/appointments?filter=${filter}${value ? `&q=${encodeURIComponent(value)}` : ''}`, { replace: true });
    }, 350);
  });

  let loadSeq = 0;

  const loadList = async () => {
    const seq = ++loadSeq;
    const timeZone = shop?.timezone || 'Europe/Madrid';
    try {
      let appointments = await fetchBookingsSafe(shop, filter, search);
      if (seq !== loadSeq) return;

      if (shop) {
        try {
          const overview = await api.overview(shop.id).catch((error) => {
            console.error('[appointments] overview failed', error);
            return null;
          });
          appointments = applyClosingAutoComplete(appointments, {
            closeTime: overview?.today_hours?.close_time,
            isClosed: Boolean(overview?.today_hours?.is_closed),
            timeZone: shop.timezone || overview?.timezone || timeZone,
          });
        } catch (error) {
          console.error('[appointments] autocomplete skipped', error);
        }
      }

      // Authoritative tab filter (date-normalized in shop timezone).
      appointments = applyTabFilter(appointments, filter, { timeZone, now: new Date() });

      if (seq !== loadSeq) return;
      paintList(appointments);
    } catch (error) {
      // Absolute hard stop — UI stays on search + empty list.
      console.error('[appointments] loadList crashed', error);
      if (seq === loadSeq) paintList([]);
    }
  };

  // Paint empty list immediately so the shell never sticks on skeleton/error.
  paintList([]);
  await loadList();

  const poll = setInterval(() => {
    if (document.visibilityState === 'visible') void loadList();
  }, 20_000);

  return () => {
    clearInterval(poll);
    clearTimeout(timer);
    loadSeq += 1;
  };
}

// --- detail -----------------------------------------------------------------

const STATUS_ACTIONS = {
  cancelled: { label: 'Cancelar reserva', tone: 'btn--danger' },
  in_progress: { label: 'Empezar trabajo', tone: 'btn--ghost' },
  completed: { label: 'Marcar como completada', tone: 'btn--ghost' },
  no_show: { label: 'Marcar no presentado', tone: 'btn--soft' },
};

export async function appointmentView({ params }) {
  const shop = resolveShop();

  screen({
    title: 'Reserva',
    back: '/appointments',
    nav: 'appointments',
    content: skeletonList(3),
  });

  if (!shop?.id) {
    setContent(
      emptyState('Reserva no disponible', 'Vuelve al listado de reservas.', 'calendar'),
    );
    return undefined;
  }

  const render = async () => {
    let appointment;
    try {
      ({ appointment } = await api.appointment(params.id, shop.id));
    } catch (error) {
      console.error('[appointments] detail failed', error);
      setContent(emptyState('Reserva no encontrada', 'Vuelve al listado.', 'calendar'));
      return;
    }

    try {
      const overview = await api.overview(shop.id).catch(() => null);
      [appointment] = applyClosingAutoComplete([appointment], {
        closeTime: overview?.today_hours?.close_time,
        isClosed: Boolean(overview?.today_hours?.is_closed),
        timeZone: shop.timezone || overview?.timezone || appointment.timezone || 'Europe/Madrid',
      });
      if (appointment._autoCompleted) {
        await api
          .setAppointmentStatus(appointment.id, { shop_id: shop.id, status: 'completed' })
          .catch((err) => console.error('[appointments] auto-complete persist failed', err));
        appointment = { ...appointment, status: 'completed', allowed_transitions: [], _autoCompleted: false };
      }
    } catch (error) {
      console.error('[appointments] detail autocomplete skipped', error);
    }

    const vehicle = appointment.vehicle || {};
    const mailLink = appointment.customer_mailto_link;
    const canCancel = canCancelAppointment(appointment);
    const main = setContent(`
      <div class="stack">
        <div class="card">
          <div class="row row--between">
            <div class="grow">
              <h1 style="font-size:22px">${esc(appointment.customer_name)}</h1>
              <div class="list__meta">${esc(appointment.reference)}</div>
            </div>
            ${statusBadge(appointment.status)}
          </div>
          <div style="height:12px"></div>
          ${
            mailLink
              ? `<div class="contact-actions">
                   <a class="btn btn--block" href="${esc(mailLink)}" data-native="true">
                     ${icon('mail', { size: 17 })} ${esc(t('appointments.sendEmail'))}
                   </a>
                 </div>`
              : `<p class="list__meta">${esc(t('appointments.noEmail'))}</p>`
          }
        </div>

        <div class="card">
          <div class="kv"><span class="kv__key">Cuándo</span><span class="kv__value">${esc(appointment.scheduled_local)}</span></div>
          <div class="kv"><span class="kv__key">Duración</span><span class="kv__value">${esc(appointment.duration_minutes)} min</span></div>
          <div class="kv"><span class="kv__key">Servicio</span><span class="kv__value">${esc(appointment.service_type ?? '—')}</span></div>
          <div class="kv"><span class="kv__key">Email</span><span class="kv__value truncate">${esc(appointment.customer_email ?? '—')}</span></div>
          <div class="kv"><span class="kv__key">Vehículo</span><span class="kv__value">${esc(vehicle.label ?? '—')}</span></div>
          <div class="kv"><span class="kv__key">Matrícula</span><span class="kv__value" style="font-family:var(--mono)">${esc(vehicle.plate ?? '—')}</span></div>
          <div class="kv"><span class="kv__key">Origen</span><span class="kv__value">${esc(sourceLabel(appointment.source))}</span></div>
        </div>

        <div class="stack stack--tight" data-actions>
          ${
            canCancel
              ? `<button class="btn btn--danger btn--block" data-status="cancelled">${esc(t('appointments.cancelBooking'))}</button>`
              : ''
          }
          ${
            ['in_progress', 'completed', 'no_show']
              .filter((status) => (appointment.allowed_transitions || []).includes(status))
              .map((status) => {
                const action = STATUS_ACTIONS[status];
                if (!action) return '';
                return `<button class="btn ${action.tone} btn--block" data-status="${status}">${esc(action.label)}</button>`;
              })
              .join('')
          }
          <button class="btn btn--soft btn--block" data-edit>Editar detalles</button>
        </div>
      </div>`);

    main.querySelector('[data-edit]')?.addEventListener('click', () => openEditSheet(shop, appointment, render));

    for (const button of main.querySelectorAll('[data-status]')) {
      button.addEventListener('click', async () => {
        const status = button.dataset.status;
        const needsReason = status === 'cancelled' || status === 'no_show';
        const outcome = needsReason
          ? await reasonSheet({
              title: STATUS_ACTIONS[status]?.label || t('appointments.cancelBooking'),
              message:
                status === 'cancelled'
                  ? t('appointments.cancelConfirm')
                  : 'Esto marca que el cliente no se ha presentado.',
              confirmLabel: STATUS_ACTIONS[status]?.label || t('appointments.cancelBooking'),
              danger: true,
              placeholder: status === 'cancelled' ? 'Motivo (opcional)' : 'Nota (opcional)',
            })
          : { confirmed: true, reason: null };
        if (!outcome.confirmed) return;

        button.disabled = true;
        try {
          await api.setAppointmentStatus(appointment.id, {
            shop_id: shop.id,
            status,
            reason: outcome.reason,
          });
          if (status === 'cancelled') toast(t('appointments.cancelToast'), 'ok');
          await refreshBadges();
          await render();
        } catch (error) {
          console.error('[appointments] status update failed', error);
          toast('No se pudo actualizar el estado', 'danger');
          button.disabled = false;
        }
      });
    }
  };

  await render();
  return undefined;
}

// --- create / edit ----------------------------------------------------------

const serviceOptions = (services, selected) =>
  ['', ...(services ?? [])]
    .map(
      (service) =>
        `<option value="${esc(service)}" ${service === selected ? 'selected' : ''}>${esc(service || 'Sin especificar')}</option>`,
    )
    .join('');

export function openNewBookingSheet(shop, onSaved) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  sheet({
    title: 'Nueva reserva',
    body: `
      <form class="stack" novalidate>
        <div class="field">
          <label class="field__label" for="nb-name">Nombre del cliente</label>
          <input class="input" id="nb-name" required autocomplete="name">
        </div>
        <div class="field">
          <label class="field__label" for="nb-phone">Teléfono</label>
          <input class="input" id="nb-phone" type="tel" inputmode="tel" placeholder="+34600123456" required>
        </div>
        <div class="field">
          <label class="field__label" for="nb-email">Email</label>
          <input class="input" id="nb-email" type="email" autocomplete="email" placeholder="cliente@email.com">
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="nb-date">Fecha</label>
            <input class="input" id="nb-date" type="date" value="${date}" required>
          </div>
          <div class="field">
            <label class="field__label" for="nb-time">Hora</label>
            <input class="input" id="nb-time" type="time" value="10:00" required>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="nb-service">Servicio</label>
          <select class="input" id="nb-service">${serviceOptions(shop.services, '')}</select>
        </div>
        <div class="field">
          <label class="field__label" for="nb-notes">Notas</label>
          <textarea class="input" id="nb-notes"></textarea>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Guardar reserva confirmada</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const errorBox = form.querySelector('[data-error]');
        errorBox.textContent = '';
        button.disabled = true;
        const value = (id) => form.querySelector(id).value.trim() || null;
        try {
          const result = await api.createAppointment({
            shop_id: shop.id,
            customer_name: value('#nb-name'),
            customer_phone: value('#nb-phone'),
            customer_email: value('#nb-email'),
            scheduled_at: new Date(
              `${form.querySelector('#nb-date').value}T${form.querySelector('#nb-time').value}`,
            ).toISOString(),
            service_type: value('#nb-service'),
            notes: value('#nb-notes'),
            status: 'confirmed',
            enforce_schedule: false,
          });
          close();
          toast('Reserva confirmada', 'ok');
          await refreshBadges();
          if (onSaved) await onSaved();
          else navigate(`/appointments/${result.appointment.id}`);
        } catch (error) {
          console.error('[appointments] create failed', error);
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}

function openEditSheet(shop, appointment, onSaved) {
  const local = (iso) => {
    const date = new Date(iso);
    const pad = (value) => String(value).padStart(2, '0');
    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    };
  };
  const when = local(appointment.scheduled_at);

  sheet({
    title: 'Editar reserva',
    body: `
      <form class="stack" novalidate>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="ed-date">Fecha</label>
            <input class="input" id="ed-date" type="date" value="${esc(when.date)}">
          </div>
          <div class="field">
            <label class="field__label" for="ed-time">Hora</label>
            <input class="input" id="ed-time" type="time" value="${esc(when.time)}">
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="ed-service">Servicio</label>
          <select class="input" id="ed-service">${serviceOptions(shop.services, appointment.service_type)}</select>
        </div>
        <div class="field">
          <label class="field__label" for="ed-notes">Notas</label>
          <textarea class="input" id="ed-notes">${esc(appointment.notes ?? '')}</textarea>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Guardar cambios</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const errorBox = form.querySelector('[data-error]');
        errorBox.textContent = '';
        button.disabled = true;
        try {
          await api.updateAppointment(appointment.id, {
            shop_id: shop.id,
            scheduled_at: new Date(
              `${form.querySelector('#ed-date').value}T${form.querySelector('#ed-time').value}`,
            ).toISOString(),
            service_type: form.querySelector('#ed-service').value || null,
            notes: form.querySelector('#ed-notes').value.trim() || null,
          });
          close();
          toast('Reserva actualizada', 'ok');
          await onSaved();
        } catch (error) {
          console.error('[appointments] edit failed', error);
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}
