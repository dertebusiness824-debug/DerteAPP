/** Bookings: filtered list, detail screen, status flow and manual entry. */
import { api } from '../api.js';
import { navigate } from '../router.js';
import { refreshBadges, store } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import {
  contactButtons,
  copy,
  emptyState,
  esc,
  icon,
  reasonSheet,
  sheet,
  share,
  skeletonList,
  statusBadge,
  timeOf,
  toast,
} from '../ui.js';

/** One booking as a tappable row. Shared with the home screen. */
export function appointmentRow(appointment, { showDay = false } = {}) {
  const vehicle = appointment.vehicle?.label;
  return `
    <button class="list__item" data-appointment="${esc(appointment.id)}">
      <div class="grow">
        <div class="row row--between" style="gap:8px">
          <span class="list__title truncate">${esc(appointment.customer_name)}</span>
          ${statusBadge(appointment.status)}
        </div>
        <div class="list__meta truncate">
          ${showDay ? esc(appointment.scheduled_local) : esc(timeOf(appointment.scheduled_at, appointment.timezone))}
          ${appointment.service_type ? ` · ${esc(appointment.service_type)}` : ''}
          ${vehicle ? ` · ${esc(vehicle)}` : ''}
        </div>
      </div>
      ${icon('chevron', { size: 18, className: 'chev' })}
    </button>`;
}

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'pending', label: 'Needs reply' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Done' },
  { key: 'all', label: 'All' },
];

function filterParams(filter, shopId) {
  const today = new Date().toISOString().slice(0, 10);
  switch (filter) {
    case 'today':
      return { shop_id: shopId, date: today };
    case 'pending':
      return { shop_id: shopId, status: 'pending' };
    case 'upcoming':
      return { shop_id: shopId, from: today, status: ['accepted', 'in_progress'] };
    case 'completed':
      return { shop_id: shopId, status: 'completed', limit: 100 };
    default:
      return { shop_id: shopId, limit: 100 };
  }
}

export async function appointmentsView({ query }) {
  const shop = requireShop({ title: 'Bookings', navKey: 'appointments' });
  if (!shop) return undefined;

  const filter = query.get('filter') ?? 'today';
  const search = query.get('q') ?? '';

  screen({
    title: 'Bookings',
    subtitle: shop.name,
    nav: 'appointments',
    shopSwitcher: true,
    actions: `<button class="btn btn--icon" data-new aria-label="New booking">${icon('plus', { size: 20 })}</button>`,
    content: `
      <div class="stack">
        <div class="chips" role="tablist">
          ${FILTERS.map(
            (item) =>
              `<button class="chip" role="tab" data-filter="${item.key}" aria-pressed="${item.key === filter}">${esc(item.label)}</button>`,
          ).join('')}
        </div>
        <input class="input" type="search" placeholder="Search name, phone, plate or reference"
               value="${esc(search)}" data-search>
        <div data-list>${skeletonList(4)}</div>
      </div>`,
  });

  const main = document.querySelector('.main');
  document.querySelector('.header [data-new]')?.addEventListener('click', () => openNewBookingSheet(shop));

  main.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (chip) navigate(`/appointments?filter=${chip.dataset.filter}${search ? `&q=${encodeURIComponent(search)}` : ''}`);
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
  try {
    const params = { ...filterParams(filter, shop.id), ...(search ? { search } : {}) };
    const { appointments } = await api.appointments(params);
    container.innerHTML = appointments.length
      ? `<div class="list">${appointments.map((item) => appointmentRow(item, { showDay: filter !== 'today' })).join('')}</div>`
      : emptyState(
          search ? 'Nothing matches that search' : 'No bookings here yet',
          search ? 'Try a name, phone number or plate.' : 'New requests from your website land here.',
          'calendar',
        );
  } catch (error) {
    container.innerHTML = emptyState('Could not load bookings', error.message, 'x');
  }
  return undefined;
}

// --- detail -----------------------------------------------------------------

const STATUS_ACTIONS = {
  accepted: { label: 'Accept booking', tone: '' },
  in_progress: { label: 'Start work', tone: 'btn--ghost' },
  completed: { label: 'Mark completed', tone: 'btn--ghost' },
  cancelled: { label: 'Cancel booking', tone: 'btn--danger' },
  no_show: { label: 'Mark no-show', tone: 'btn--soft' },
};

export async function appointmentView({ params }) {
  const shop = requireShop({ title: 'Booking', navKey: 'appointments' });
  if (!shop) return undefined;

  screen({
    title: 'Booking',
    back: '/appointments',
    nav: 'appointments',
    content: skeletonList(3),
  });

  const render = async () => {
    let appointment;
    try {
      ({ appointment } = await api.appointment(params.id, shop.id));
    } catch (error) {
      setContent(emptyState('Booking not found', error.message, 'x'));
      return;
    }

    const vehicle = appointment.vehicle;
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
          ${contactButtons({
            telLink: appointment.customer_tel_link,
            whatsappLink: appointment.customer_whatsapp_link,
            phoneDisplay: appointment.customer_phone_display,
          })}
          ${
            store.telephony.configured
              ? `<div style="height:8px"></div>
                 <button class="btn btn--soft btn--block btn--small" data-pbx>
                   ${icon('phone', { size: 16 })} Call through the shop PBX
                 </button>`
              : ''
          }
        </div>

        <div class="card">
          <div class="kv"><span class="kv__key">When</span><span class="kv__value">${esc(appointment.scheduled_local)}</span></div>
          <div class="kv"><span class="kv__key">Duration</span><span class="kv__value">${esc(appointment.duration_minutes)} min</span></div>
          <div class="kv"><span class="kv__key">Service</span><span class="kv__value">${esc(appointment.service_type ?? '—')}</span></div>
          ${vehicle.label ? `<div class="kv"><span class="kv__key">Vehicle</span><span class="kv__value">${esc(vehicle.label)}</span></div>` : ''}
          ${vehicle.plate ? `<div class="kv"><span class="kv__key">Plate</span><span class="kv__value" style="font-family:var(--mono)">${esc(vehicle.plate)}</span></div>` : ''}
          ${appointment.price_estimate ? `<div class="kv"><span class="kv__key">Estimate</span><span class="kv__value">${esc(appointment.price_estimate)}</span></div>` : ''}
          <div class="kv"><span class="kv__key">Came from</span><span class="kv__value">${esc(appointment.source)}</span></div>
          ${appointment.customer_email ? `<div class="kv"><span class="kv__key">Email</span><span class="kv__value truncate">${esc(appointment.customer_email)}</span></div>` : ''}
        </div>

        ${
          appointment.notes
            ? `<div class="card card--flat">
                 <div class="card__label">Customer note</div>
                 <p style="margin-top:6px">${esc(appointment.notes)}</p>
               </div>`
            : ''
        }

        ${
          appointment.chat_link
            ? `<div class="card">
                 <div class="card__label">Customer chat</div>
                 <p style="margin:6px 0 12px;font-size:13px;color:var(--muted)">
                   Share this private link so ${esc(appointment.customer_name.split(' ')[0])} can message you and see your number.
                 </p>
                 <div class="btn-row">
                   <button class="btn btn--small" data-open-chat>${icon('chat', { size: 16 })} Open chat</button>
                   <button class="btn btn--small btn--ghost" data-share>${icon('link', { size: 16 })} Share link</button>
                 </div>
               </div>`
            : ''
        }

        <div class="stack stack--tight" data-actions>
          ${appointment.allowed_transitions
            .map((status) => {
              const action = STATUS_ACTIONS[status];
              if (!action) return '';
              return `<button class="btn ${action.tone} btn--block" data-status="${status}">${esc(action.label)}</button>`;
            })
            .join('')}
          <button class="btn btn--soft btn--block" data-edit>Edit details</button>
        </div>
      </div>`);

    main.querySelector('[data-open-chat]')?.addEventListener('click', () =>
      navigate(`/chat/${appointment.chat_thread_id}`),
    );

    main.querySelector('[data-share]')?.addEventListener('click', async () => {
      await share({
        title: `${shop.name} booking ${appointment.reference}`,
        text: `Chat with ${shop.name} about booking ${appointment.reference}`,
        url: appointment.chat_link,
      });
    });

    main.querySelector('[data-pbx]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        await api.placeCall({ shop_id: shop.id, to: appointment.customer_phone, appointment_id: appointment.id });
        toast('Your phone will ring, then we connect the customer', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        event.currentTarget.disabled = false;
      }
    });

    main.querySelector('[data-edit]')?.addEventListener('click', () => openEditSheet(shop, appointment, render));

    for (const button of main.querySelectorAll('[data-status]')) {
      button.addEventListener('click', async () => {
        const status = button.dataset.status;

        if (status === 'accepted') {
          button.disabled = true;
          try {
            const result = await api.acceptAppointment(appointment.id, shop.id);
            await refreshBadges();
            openChatLinkSheet(result, shop);
            await render();
          } catch (error) {
            toast(error.message, 'error');
            button.disabled = false;
          }
          return;
        }

        const needsReason = status === 'cancelled' || status === 'no_show';
        const outcome = needsReason
          ? await reasonSheet({
              title: STATUS_ACTIONS[status].label,
              message:
                status === 'cancelled'
                  ? 'The customer sees this in their chat, so a short reason helps.'
                  : 'This marks the customer as not turning up.',
              confirmLabel: STATUS_ACTIONS[status].label,
              danger: true,
              placeholder: status === 'cancelled' ? 'Reason (optional)' : 'Note (optional)',
            })
          : { confirmed: true, reason: null };
        if (!outcome.confirmed) return;

        button.disabled = true;
        try {
          await api.setAppointmentStatus(appointment.id, { shop_id: shop.id, status, reason: outcome.reason });
          await refreshBadges();
          await render();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    }
  };

  await render();
  return undefined;
}

/** Shown right after accepting: the link to hand to the customer. */
function openChatLinkSheet(result, shop) {
  sheet({
    title: 'Booking confirmed',
    body: `
      <div class="stack">
        <p style="color:var(--muted);font-size:14px">
          A private chat is open for ${esc(result.appointment.customer_name)}. Send them the link -
          your phone number is shown at the top so they can call you in one tap.
        </p>
        <div class="card card--flat" style="word-break:break-all;font-family:var(--mono);font-size:12.5px">
          ${esc(result.chat_link)}
        </div>
        <button class="btn btn--block" data-wa>${icon('whatsapp', { size: 17 })} Send on WhatsApp</button>
        <div class="btn-row">
          <button class="btn btn--ghost" data-copy>${icon('copy', { size: 16 })} Copy link</button>
          <button class="btn btn--ghost" data-share>${icon('link', { size: 16 })} Share</button>
        </div>
      </div>`,
    onMount(content, close) {
      content.querySelector('[data-copy]').addEventListener('click', () => copy(result.chat_link, 'Chat link copied'));
      content.querySelector('[data-share]').addEventListener('click', () =>
        share({ title: shop.name, text: result.share_message, url: result.chat_link }),
      );
      content.querySelector('[data-wa]').addEventListener('click', () => {
        const phone = result.appointment.customer_phone.replace('+', '');
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(result.share_message)}`, '_blank', 'noopener');
        close();
      });
    },
  });
}

// --- create / edit ----------------------------------------------------------

const serviceOptions = (services, selected) =>
  ['', ...(services ?? [])]
    .map(
      (service) =>
        `<option value="${esc(service)}" ${service === selected ? 'selected' : ''}>${esc(service || 'Not specified')}</option>`,
    )
    .join('');

export function openNewBookingSheet(shop, onSaved) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  sheet({
    title: 'New booking',
    body: `
      <form class="stack" novalidate>
        <div class="field">
          <label class="field__label" for="nb-name">Customer name</label>
          <input class="input" id="nb-name" required autocomplete="name">
        </div>
        <div class="field">
          <label class="field__label" for="nb-phone">Phone number</label>
          <input class="input" id="nb-phone" type="tel" inputmode="tel" placeholder="+34600123456" required>
          <span class="field__hint">Include the country code so you can tap to call later.</span>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="nb-date">Date</label>
            <input class="input" id="nb-date" type="date" value="${date}" required>
          </div>
          <div class="field">
            <label class="field__label" for="nb-time">Time</label>
            <input class="input" id="nb-time" type="time" value="10:00" required>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="nb-service">Service</label>
            <select class="input" id="nb-service">${serviceOptions(shop.services, '')}</select>
          </div>
          <div class="field">
            <label class="field__label" for="nb-duration">Minutes</label>
            <input class="input" id="nb-duration" type="number" min="15" step="15" value="${esc(shop.slot_minutes ?? 60)}">
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="nb-make">Make</label>
            <input class="input" id="nb-make" placeholder="Seat">
          </div>
          <div class="field">
            <label class="field__label" for="nb-model">Model</label>
            <input class="input" id="nb-model" placeholder="Leon">
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="nb-plate">Plate</label>
          <input class="input" id="nb-plate" style="text-transform:uppercase" placeholder="1234ABC">
        </div>
        <div class="field">
          <label class="field__label" for="nb-notes">Notes</label>
          <textarea class="input" id="nb-notes" placeholder="Noise when braking at low speed"></textarea>
        </div>
        <label class="switch">
          <input type="checkbox" id="nb-enforce">
          <span class="field__hint">Only allow times inside opening hours</span>
        </label>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Save booking</button>
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
            scheduled_at: new Date(`${form.querySelector('#nb-date').value}T${form.querySelector('#nb-time').value}`).toISOString(),
            duration_minutes: Number(form.querySelector('#nb-duration').value) || undefined,
            service_type: value('#nb-service'),
            vehicle_make: value('#nb-make'),
            vehicle_model: value('#nb-model'),
            vehicle_plate: value('#nb-plate'),
            notes: value('#nb-notes'),
            enforce_schedule: form.querySelector('#nb-enforce').checked,
          });
          close();
          toast('Booking saved', 'ok');
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
    title: 'Edit booking',
    body: `
      <form class="stack" novalidate>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="ed-date">Date</label>
            <input class="input" id="ed-date" type="date" value="${esc(when.date)}">
          </div>
          <div class="field">
            <label class="field__label" for="ed-time">Time</label>
            <input class="input" id="ed-time" type="time" value="${esc(when.time)}">
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="ed-service">Service</label>
            <select class="input" id="ed-service">${serviceOptions(shop.services, appointment.service_type)}</select>
          </div>
          <div class="field">
            <label class="field__label" for="ed-duration">Minutes</label>
            <input class="input" id="ed-duration" type="number" min="15" step="15" value="${esc(appointment.duration_minutes)}">
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="ed-estimate">Price estimate</label>
          <input class="input" id="ed-estimate" type="number" min="0" step="5" value="${esc(appointment.price_estimate ?? '')}">
        </div>
        <div class="field">
          <label class="field__label" for="ed-notes">Notes</label>
          <textarea class="input" id="ed-notes">${esc(appointment.notes ?? '')}</textarea>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Save changes</button>
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
            price_estimate: form.querySelector('#ed-estimate').value === '' ? null : Number(form.querySelector('#ed-estimate').value),
            notes: form.querySelector('#ed-notes').value.trim() || null,
          });
          close();
          toast('Booking updated', 'ok');
          await onSaved();
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}
