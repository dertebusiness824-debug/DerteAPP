/** Bookings: filtered list, detail screen, status flow and manual entry. */
import { api } from '../api.js';
import {
  applyClosingAutoComplete,
  canCancelAppointment,
} from '../booking-lifecycle.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { bindReauthPanel, isSessionLinkError, reauthPanel } from '../session-errors.js';
import { refreshBadges } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
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
          ${esc(when)}
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
        ${
          appointment.customer_mailto_link
            ? `<a class="btn btn--small btn--soft" href="${esc(appointment.customer_mailto_link)}" data-native="true"
                 aria-label="${esc(t('appointments.emailContact'))}">
                 ${icon('mail', { size: 16 })}
               </a>`
            : ''
        }
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

function filterParams(filter, shopId) {
  const today = new Date().toISOString().slice(0, 10);
  switch (filter) {
    case 'today':
      return { shop_id: shopId, date: today };
    case 'upcoming':
      // Active confirmed work only — no pending/accept queue.
      return { shop_id: shopId, from: today, status: ['confirmed', 'in_progress'] };
    case 'completed':
      return { shop_id: shopId, status: 'completed', limit: 100 };
    default:
      return { shop_id: shopId, limit: 100 };
  }
}

/** Persist rows the list marked completed via close−30m logic. */
async function persistAutoCompleted(appointments, shopId) {
  const pending = appointments.filter((item) => item._autoCompleted);
  if (!pending.length) return;
  await Promise.all(
    pending.map((item) =>
      api
        .setAppointmentStatus(item.id, { shop_id: shopId, status: 'completed' })
        .catch(() => null),
    ),
  );
}

export async function appointmentsView({ query }) {
  const shop = requireShop({ title: t('appointments.title'), navKey: 'appointments' });
  if (!shop) return undefined;

  const filter = query.get('filter') ?? 'today';
  const search = query.get('q') ?? '';

  screen({
    title: t('appointments.title'),
    subtitle: shop.name,
    nav: 'appointments',
    shopSwitcher: true,
    actions: `<button class="btn btn--icon" data-new aria-label="${esc(t('home.newBooking'))}">${icon('plus', { size: 20 })}</button>`,
    content: `
      <div class="stack">
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
  document.querySelector('.header [data-new]')?.addEventListener('click', () => openNewBookingSheet(shop));

  const cancelBooking = async (appointmentId, button) => {
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
      if (isSessionLinkError(error)) {
        const host = setContent(reauthPanel());
        bindReauthPanel(host);
        return;
      }
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
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const value = searchInput.value.trim();
      navigate(`/appointments?filter=${filter}${value ? `&q=${encodeURIComponent(value)}` : ''}`, { replace: true });
    }, 350);
  });

  const container = main.querySelector('[data-list]');
  let loadSeq = 0;

  const loadList = async ({ silent = false } = {}) => {
    const seq = ++loadSeq;
    if (!silent) container.innerHTML = skeletonList(4);
    try {
      const params = { ...filterParams(filter, shop.id), ...(search ? { search } : {}) };
      // Overview brings today's close_time so the list can auto-complete near closing.
      const [listResult, overviewResult] = await Promise.allSettled([
        api.appointments(params),
        api.overview(shop.id),
      ]);
      if (seq !== loadSeq) return;
      if (listResult.status === 'rejected') throw listResult.reason;

      const overview = overviewResult.status === 'fulfilled' ? overviewResult.value : null;
      const hours = overview?.today_hours;
      const timeZone = shop.timezone || overview?.timezone || 'Europe/Madrid';

      let appointments = applyClosingAutoComplete(listResult.value.appointments || [], {
        closeTime: hours?.close_time,
        isClosed: Boolean(hours?.is_closed),
        timeZone,
      });

      // Force-persist any client-side completions so badges/history stay in sync.
      await persistAutoCompleted(appointments, shop.id);
      if (seq !== loadSeq) return;

      container.innerHTML = appointments.length
        ? `<div class="list" data-booking-list>
             ${appointments.map((item) => appointmentRow(item, { showDay: filter !== 'today' })).join('')}
           </div>`
        : emptyState(
            search ? 'Nada coincide con esa búsqueda' : 'Aún no hay reservas aquí',
            search
              ? 'Prueba un nombre, teléfono o matrícula.'
              : 'Las nuevas reservas de tu web llegan ya confirmadas. Si usas Google Calendar, pulsa «Sincronizar ahora» en Ajustes.',
            'calendar',
          );
    } catch (error) {
      if (seq !== loadSeq) return;
      if (silent) return;
      if (isSessionLinkError(error)) {
        container.innerHTML = reauthPanel();
        bindReauthPanel(container);
        return;
      }
      container.innerHTML = reauthPanel({
        title: 'No se pudieron cargar las reservas',
        body: 'Prueba a iniciar sesión de nuevo.',
      });
      bindReauthPanel(container);
    }
  };

  await loadList();

  // Pick up Google Calendar imports / webhook updates without a full page reload.
  const pollMs = 20_000;
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible') void loadList({ silent: true });
  }, pollMs);

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
  const shop = requireShop({ title: 'Reserva', navKey: 'appointments' });
  if (!shop) return undefined;

  screen({
    title: 'Reserva',
    back: '/appointments',
    nav: 'appointments',
    content: skeletonList(3),
  });

  const render = async () => {
    let appointment;
    let overview = null;
    try {
      const [detailResult, overviewResult] = await Promise.allSettled([
        api.appointment(params.id, shop.id),
        api.overview(shop.id),
      ]);
      if (detailResult.status === 'rejected') throw detailResult.reason;
      appointment = detailResult.value.appointment;
      overview = overviewResult.status === 'fulfilled' ? overviewResult.value : null;
    } catch (error) {
      setContent(emptyState('Reserva no encontrada', error.message, 'x'));
      return;
    }

    const hours = overview?.today_hours;
    const timeZone = shop.timezone || overview?.timezone || appointment.timezone || 'Europe/Madrid';
    [appointment] = applyClosingAutoComplete([appointment], {
      closeTime: hours?.close_time,
      isClosed: Boolean(hours?.is_closed),
      timeZone,
    });
    if (appointment._autoCompleted) {
      await api
        .setAppointmentStatus(appointment.id, { shop_id: shop.id, status: 'completed' })
        .catch(() => null);
      appointment = {
        ...appointment,
        status: 'completed',
        allowed_transitions: [],
        _autoCompleted: false,
      };
    }

    const vehicle = appointment.vehicle;
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
                   <a class="btn btn--block" href="${esc(mailLink)}" data-native="true" data-track="email">
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
          ${appointment.price_estimate ? `<div class="kv"><span class="kv__key">Presupuesto</span><span class="kv__value">${esc(appointment.price_estimate)}</span></div>` : ''}
          <div class="kv"><span class="kv__key">Origen</span><span class="kv__value">${esc(sourceLabel(appointment.source))}</span></div>
        </div>

        ${
          appointment.notes
            ? `<div class="card card--flat">
                 <div class="card__label">${esc(t('appointments.customerNote'))}</div>
                 <p style="margin-top:6px">${esc(appointment.notes)}</p>
               </div>`
            : ''
        }

        ${
          appointment.internal_notes
            ? `<div class="card card--flat">
                 <div class="card__label">${esc(t('appointments.internalNote'))}</div>
                 <p style="margin-top:6px">${esc(appointment.internal_notes)}</p>
               </div>`
            : ''
        }

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
          <button class="btn btn--ghost btn--block" data-comment>
            ${icon('chat', { size: 16 })} ${esc(
              appointment.internal_notes ? t('appointments.editComment') : t('appointments.addComment'),
            )}
          </button>
          <button class="btn btn--soft btn--block" data-edit>Editar detalles</button>
        </div>
      </div>`);

    main.querySelector('[data-edit]')?.addEventListener('click', () => openEditSheet(shop, appointment, render));
    main.querySelector('[data-comment]')?.addEventListener('click', () =>
      openInternalCommentSheet(shop, appointment, render),
    );

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
          await api.setAppointmentStatus(appointment.id, { shop_id: shop.id, status, reason: outcome.reason });
          if (status === 'cancelled') toast(t('appointments.cancelToast'), 'ok');
          await refreshBadges();
          await render();
        } catch (error) {
          if (isSessionLinkError(error)) {
            const host = setContent(reauthPanel());
            bindReauthPanel(host);
            return;
          }
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
          <span class="field__hint">Incluye el prefijo del país para poder llamar con un toque.</span>
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
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="nb-service">Servicio</label>
            <select class="input" id="nb-service">${serviceOptions(shop.services, '')}</select>
          </div>
          <div class="field">
            <label class="field__label" for="nb-duration">Minutos</label>
            <input class="input" id="nb-duration" type="number" min="15" step="15" value="${esc(shop.slot_minutes ?? 60)}">
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="nb-make">Marca</label>
            <input class="input" id="nb-make" placeholder="Seat">
          </div>
          <div class="field">
            <label class="field__label" for="nb-model">Modelo</label>
            <input class="input" id="nb-model" placeholder="Leon">
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="nb-plate">Matrícula</label>
          <input class="input" id="nb-plate" style="text-transform:uppercase" placeholder="1234ABC">
        </div>
        <div class="field">
          <label class="field__label" for="nb-notes">Notas</label>
          <textarea class="input" id="nb-notes" placeholder="Ruido al frenar a baja velocidad"></textarea>
        </div>
        <label class="switch">
          <input type="checkbox" id="nb-enforce">
          <span class="field__hint">Solo permitir horarios dentro del horario de apertura</span>
        </label>
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
            scheduled_at: new Date(`${form.querySelector('#nb-date').value}T${form.querySelector('#nb-time').value}`).toISOString(),
            duration_minutes: Number(form.querySelector('#nb-duration').value) || undefined,
            service_type: value('#nb-service'),
            vehicle_make: value('#nb-make'),
            vehicle_model: value('#nb-model'),
            vehicle_plate: value('#nb-plate'),
            notes: value('#nb-notes'),
            // Always land as confirmed — no Accept / pending step.
            status: 'confirmed',
            enforce_schedule: form.querySelector('#nb-enforce').checked,
          });
          close();
          toast('Reserva confirmada', 'ok');
          await refreshBadges();
          if (onSaved) await onSaved();
          else navigate(`/appointments/${result.appointment.id}`);
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}

function openInternalCommentSheet(shop, appointment, onSaved) {
  sheet({
    title: appointment.internal_notes ? t('appointments.editComment') : t('appointments.addComment'),
    body: `
      <form class="stack" novalidate>
        <div class="field">
          <label class="field__label" for="ic-notes">${esc(t('appointments.internalNote'))}</label>
          <textarea class="input" id="ic-notes" rows="5"
                    placeholder="${esc(t('appointments.commentPlaceholder'))}">${esc(appointment.internal_notes ?? '')}</textarea>
          <span class="field__hint">${esc(t('appointments.commentHint'))}</span>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">${esc(t('appointments.saveComment'))}</button>
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
            internal_notes: form.querySelector('#ic-notes').value.trim() || null,
          });
          close();
          toast(t('appointments.commentSaved'), 'ok');
          if (onSaved) await onSaved();
        } catch (error) {
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
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="ed-service">Servicio</label>
            <select class="input" id="ed-service">${serviceOptions(shop.services, appointment.service_type)}</select>
          </div>
          <div class="field">
            <label class="field__label" for="ed-duration">Minutos</label>
            <input class="input" id="ed-duration" type="number" min="15" step="15" value="${esc(appointment.duration_minutes)}">
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="ed-estimate">Presupuesto</label>
          <input class="input" id="ed-estimate" type="number" min="0" step="5" value="${esc(appointment.price_estimate ?? '')}">
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
            duration_minutes: Number(form.querySelector('#ed-duration').value) || undefined,
            service_type: form.querySelector('#ed-service').value || null,
            price_estimate:
              form.querySelector('#ed-estimate').value === ''
                ? null
                : Number(form.querySelector('#ed-estimate').value),
            notes: form.querySelector('#ed-notes').value.trim() || null,
          });
          close();
          toast('Reserva actualizada', 'ok');
          await onSaved();
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}
