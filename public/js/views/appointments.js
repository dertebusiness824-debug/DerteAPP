/** Bookings: filtered list, detail screen, status flow and manual entry. */
import { api } from '../api.js';
import { applyTabFilter } from '../booking-filters.js';
import {
  applyClosingAutoComplete,
  canCancelAppointment,
} from '../booking-lifecycle.js';
import {
  ensureAppointments,
  peekAppointments,
  subscribeDataCache,
  cacheKeys,
} from '../data-cache.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { refreshBadges, adoptDefaultShop, store } from '../store.js';
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
  const vehicleLine = [vehicle, plate].filter(Boolean).join(' · ');
  const canCancel = canCancelAppointment(appointment);
  const when = showDay
    ? appointment.scheduled_local
    : timeOf(appointment.scheduled_at, appointment.timezone);

  return `
    <div class="list__item list__item--static reservas-card"
         data-booking-row="${esc(appointment.id)}">
      <button class="grow reservas-card__hit" type="button" data-appointment="${esc(appointment.id)}">
        <div class="row row--between reservas-card__top">
          <span class="list__title truncate">${esc(appointment.customer_name)}</span>
          ${statusBadge(appointment.status)}
        </div>
        <div class="list__meta truncate">
          ${esc(when || '')}
          ${appointment.service_type ? ` · ${esc(appointment.service_type)}` : ''}
        </div>
        ${
          vehicleLine
            ? `<div class="list__meta reservas-card__vehicle truncate">${esc(vehicleLine)}</div>`
            : ''
        }
        ${
          appointment.customer_email
            ? `<div class="list__meta reservas-card__email truncate">${esc(appointment.customer_email)}</div>`
            : ''
        }
      </button>
      <div class="btn-row reservas-card__actions">
        ${
          canCancel
            ? `<button class="btn btn--small btn--danger reservas-card__cancel" type="button" data-cancel="${esc(appointment.id)}">
                 ${esc(t('appointments.cancelBooking'))}
               </button>`
            : ''
        }
        <button class="btn btn--small btn--soft reservas-card__details" type="button" data-appointment="${esc(appointment.id)}">
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
  return adoptDefaultShop();
}

function matchesSearch(item, query) {
  if (!query) return true;
  const haystack = [
    item.customer_name,
    item.customer_phone,
    item.customer_email,
    item.reference,
    item.vehicle?.plate,
    item.vehicle?.label,
    item.service_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/** Sync URL without remounting the view (navigate() would re-fetch / re-auth). */
function syncAppointmentsUrl(filter, search) {
  const params = new URLSearchParams();
  params.set('filter', filter || 'today');
  if (search) params.set('q', search);
  const next = `/appointments?${params.toString()}`;
  if (`${location.pathname}${location.search}` !== next) {
    history.replaceState({}, '', next);
  }
}

export async function appointmentsView({ query }) {
  const shop = resolveShop();
  const timeZone = shop?.timezone || 'Europe/Madrid';

  // Local screen state — tabs never re-hit the API.
  const cachedRows = shop?.id ? peekAppointments(shop.id) : null;
  let allBookings = Array.isArray(cachedRows) ? cachedRows : [];
  let activeFilter = query.get('filter') ?? 'today';
  let searchQuery = query.get('q') ?? '';
  let loadSeq = 0;
  const hasWarmCache = Array.isArray(cachedRows);

  // ALWAYS paint chips + search + list shell — never an auth/error wall.
  // Prefer cached rows immediately (no skeleton / no false empty while refreshing).
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
        <div class="chips" role="tablist" data-tablist>
          ${FILTERS()
            .map(
              (item) =>
                `<button class="chip" role="tab" data-filter="${item.key}" aria-pressed="${item.key === activeFilter}">${esc(item.label)}</button>`,
            )
            .join('')}
        </div>
        <label class="reservas-search">
          <span class="reservas-search__icon" aria-hidden="true">${icon('search', { size: 18 })}</span>
          <input class="input reservas-search__input" type="search" placeholder="${esc(t('appointments.search'))}"
                 value="${esc(searchQuery)}" data-search>
        </label>
        <div data-list>${hasWarmCache ? '' : skeletonList(4)}</div>
      </div>`,
  });

  const main = document.querySelector('.main');
  const container = main.querySelector('[data-list]');

  const paintChips = () => {
    for (const chip of main.querySelectorAll('[data-filter]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.filter === activeFilter));
    }
  };

  /** Pure client filter over allBookings — no network. */
  const visibleBookings = () => {
    const searched = allBookings.filter((item) => matchesSearch(item, searchQuery));
    return applyTabFilter(searched, activeFilter, { timeZone, now: new Date() });
  };

  const paintList = ({ allowEmpty = true } = {}) => {
    const rows = visibleBookings();
    if (!container) return;
    if (rows.length) {
      container.innerHTML = `<div class="list" data-booking-list>
           ${rows.map((item) => appointmentRow(item, { showDay: activeFilter !== 'today' })).join('')}
         </div>`;
      return;
    }
    // Avoid flashing "No hay reservas" while the first warm/revalidate is in flight
    // when we have never populated cache for this shop yet.
    if (!allowEmpty && !hasWarmCache && allBookings.length === 0) {
      container.innerHTML = skeletonList(4);
      return;
    }
    container.innerHTML = emptyState(
      searchQuery ? 'Nada coincide con esa búsqueda' : t('appointments.emptyCategory'),
      searchQuery ? 'Prueba un nombre, teléfono o matrícula.' : t('appointments.emptyCategoryHint'),
      'calendar',
    );
  };

  const applyLocalView = (opts) => {
    paintChips();
    paintList(opts);
    syncAppointmentsUrl(activeFilter, searchQuery);
  };

  /** Sync from global cache and optionally soft-revalidate in background. */
  const syncFromCache = ({ revalidate = true } = {}) => {
    if (!shop?.id) {
      allBookings = [];
      applyLocalView({ allowEmpty: true });
      return null;
    }
    const cached = peekAppointments(shop.id);
    if (Array.isArray(cached)) {
      allBookings = cached;
      applyLocalView({ allowEmpty: true });
    }
    if (!revalidate) return null;
    // SWR: reuse fresh cache; if stale/missing, join/start background fetch.
    const result = ensureAppointments(shop, { force: false });
    return result.promise;
  };

  /** One network load into allBookings via cache. Failures stay silent. */
  const loadAllBookings = async ({ force = true } = {}) => {
    const seq = ++loadSeq;
    try {
      const result = ensureAppointments(shop, { force });
      if (Array.isArray(result.data)) {
        allBookings = result.data;
        applyLocalView({ allowEmpty: true });
      }
      if (result.promise) {
        const rows = await result.promise;
        if (seq !== loadSeq) return;
        allBookings = Array.isArray(rows) ? rows : [];
        applyLocalView({ allowEmpty: true });
      }
    } catch (error) {
      console.error('[appointments] loadAllBookings crashed', error);
      if (seq === loadSeq && !allBookings.length) {
        allBookings = [];
        applyLocalView({ allowEmpty: true });
      }
    }
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
      await loadAllBookings({ force: true });
    } catch (error) {
      console.error('[appointments] cancel failed', error);
      toast('No se pudo cancelar ahora', 'danger');
      if (button) button.disabled = false;
    }
  };

  document.querySelector('.header [data-new]')?.addEventListener('click', () => {
    if (shop) openNewBookingSheet(shop, () => void loadAllBookings({ force: true }));
  });

  main.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (chip) {
      const next = chip.dataset.filter || 'today';
      if (next === activeFilter) return;
      activeFilter = next;
      // Tab switch = local filter only. Never navigate() / fetch / auth UI.
      applyLocalView({ allowEmpty: true });
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
      searchQuery = searchInput.value.trim();
      applyLocalView({ allowEmpty: true });
    }, 200);
  });

  // Instant paint from warm cache, then silent background revalidate.
  applyLocalView({ allowEmpty: hasWarmCache });
  const pending = syncFromCache({ revalidate: true });
  if (pending) void pending.catch(() => {});

  const unsubCache = subscribeDataCache(({ key }) => {
    if (!shop?.id) return;
    if (key !== cacheKeys.appointments(shop.id)) return;
    const cached = peekAppointments(shop.id);
    if (!Array.isArray(cached)) return;
    allBookings = cached;
    applyLocalView({ allowEmpty: true });
  });

  // Quiet background refresh of the local cache (never shows auth/error walls).
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible') void loadAllBookings({ force: true });
  }, 60_000);

  return () => {
    unsubCache();
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

const CUSTOM_SERVICE_VALUE = '__custom__';

const serviceOptions = (services, selected) => {
  const list = services ?? [];
  const known = !selected || list.includes(selected);
  const options = [
    `<option value="" ${!selected ? 'selected' : ''}>${esc(t('appointments.serviceNone'))}</option>`,
    ...list.map(
      (service) =>
        `<option value="${esc(service)}" ${known && service === selected ? 'selected' : ''}>${esc(service)}</option>`,
    ),
    `<option value="${CUSTOM_SERVICE_VALUE}" ${!known && selected ? 'selected' : ''}>${esc(t('appointments.serviceAddText'))}</option>`,
  ];
  return options.join('');
};

function serviceCustomFieldHtml({ id, selected = '', services = [] } = {}) {
  const list = services ?? [];
  const isCustom = Boolean(selected) && !list.includes(selected);
  return `
    <div class="field" data-service-custom ${isCustom ? '' : 'hidden'}>
      <label class="field__label" for="${esc(id)}">${esc(t('appointments.serviceSpecify'))}</label>
      <input class="input" id="${esc(id)}" type="text" maxlength="120" autocomplete="off"
             placeholder="${esc(t('appointments.serviceSpecifyPlaceholder'))}"
             value="${esc(isCustom ? selected : '')}">
    </div>`;
}

function bindServiceCustomToggle(form, { selectId, customId }) {
  const select = form.querySelector(selectId);
  const customWrap = form.querySelector('[data-service-custom]');
  const customInput = form.querySelector(customId);
  if (!select || !customWrap || !customInput) return;

  const sync = ({ focus = false } = {}) => {
    const custom = select.value === CUSTOM_SERVICE_VALUE;
    customWrap.hidden = !custom;
    customInput.required = custom;
    if (!custom) {
      customInput.value = '';
    } else if (focus) {
      customInput.focus();
    }
  };

  select.addEventListener('change', () => sync({ focus: true }));
  sync();
}

function resolveServiceType(form, { selectId, customId }) {
  const select = form.querySelector(selectId);
  const customInput = form.querySelector(customId);
  if (!select) return null;
  if (select.value === CUSTOM_SERVICE_VALUE) {
    const custom = customInput?.value?.trim() || '';
    return custom || null;
  }
  return select.value.trim() || null;
}

export function openNewBookingSheet(shop, onSaved) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  sheet({
    title: t('appointments.newTitle') || 'Nueva reserva',
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
          <label class="field__label" for="nb-service">${esc(t('appointments.serviceLabel'))}</label>
          <select class="input" id="nb-service">${serviceOptions(shop.services, '')}</select>
        </div>
        ${serviceCustomFieldHtml({ id: 'nb-service-custom', services: shop.services })}
        <div class="field">
          <label class="field__label" for="nb-notes">Notas</label>
          <textarea class="input" id="nb-notes"></textarea>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Guardar reserva confirmada</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('form');
      bindServiceCustomToggle(form, { selectId: '#nb-service', customId: '#nb-service-custom' });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const errorBox = form.querySelector('[data-error]');
        errorBox.textContent = '';

        const serviceType = resolveServiceType(form, {
          selectId: '#nb-service',
          customId: '#nb-service-custom',
        });
        if (form.querySelector('#nb-service').value === CUSTOM_SERVICE_VALUE && !serviceType) {
          errorBox.textContent = t('appointments.serviceCustomRequired');
          form.querySelector('#nb-service-custom')?.focus();
          return;
        }

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
            service_type: serviceType,
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
          <label class="field__label" for="ed-service">${esc(t('appointments.serviceLabel'))}</label>
          <select class="input" id="ed-service">${serviceOptions(shop.services, appointment.service_type)}</select>
        </div>
        ${serviceCustomFieldHtml({
          id: 'ed-service-custom',
          selected: appointment.service_type || '',
          services: shop.services,
        })}
        <div class="field">
          <label class="field__label" for="ed-notes">Notas</label>
          <textarea class="input" id="ed-notes">${esc(appointment.notes ?? '')}</textarea>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Guardar cambios</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('form');
      bindServiceCustomToggle(form, { selectId: '#ed-service', customId: '#ed-service-custom' });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const errorBox = form.querySelector('[data-error]');
        errorBox.textContent = '';

        const serviceType = resolveServiceType(form, {
          selectId: '#ed-service',
          customId: '#ed-service-custom',
        });
        if (form.querySelector('#ed-service').value === CUSTOM_SERVICE_VALUE && !serviceType) {
          errorBox.textContent = t('appointments.serviceCustomRequired');
          form.querySelector('#ed-service-custom')?.focus();
          return;
        }

        button.disabled = true;
        try {
          await api.updateAppointment(appointment.id, {
            shop_id: shop.id,
            scheduled_at: new Date(
              `${form.querySelector('#ed-date').value}T${form.querySelector('#ed-time').value}`,
            ).toISOString(),
            service_type: serviceType,
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
