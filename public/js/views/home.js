/** Shop owner home screen: today at a glance, plus what needs an answer now. */
import { api, stream } from '../api.js';
import { navigate } from '../router.js';
import { refreshBadges, store } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import { emptyState, esc, icon, num, skeletonList, toast } from '../ui.js';
import { appointmentRow, openNewBookingSheet } from './appointments.js';

const OPEN_STATE_TEXT = {
  closed_today: 'Closed today',
  before_opening: 'Opens later today',
  after_closing: 'Closed for the day',
  on_break: 'On break',
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export async function homeView() {
  const shop = requireShop({ title: 'DerteApp', navKey: 'home' });
  if (!shop) return undefined;

  screen({
    title: `${greeting()}, ${store.user.full_name.split(' ')[0]}`,
    subtitle: shop.name,
    nav: 'home',
    shopSwitcher: true,
    actions: `<button class="btn btn--icon" data-new aria-label="New booking">${icon('plus', { size: 20 })}</button>`,
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
      setContent(emptyState('Could not load your dashboard', error.message, 'x'));
      return;
    }

    const stats = overview.stats;
    const hours = overview.today_hours;
    const openLabel = overview.open_now
      ? 'Open now'
      : (OPEN_STATE_TEXT[overview.open_state_reason] ?? 'Closed');
    const hoursLabel = hours?.is_closed
      ? (hours.note ?? 'Day off')
      : `${hours?.open_time ?? '—'}–${hours?.close_time ?? '—'}${hours?.break_start ? ` · break ${hours.break_start}–${hours.break_end}` : ''}`;

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
            <a class="btn btn--small btn--ghost" href="/schedule">${icon('clock', { size: 16 })} Hours</a>
          </div>
        </div>

        <div class="stats">
          <div class="stat">
            <div class="stat__value">${num(stats.today_total)}</div>
            <div class="stat__label">Jobs today</div>
          </div>
          <div class="stat${stats.pending ? ' stat--alert' : ''}">
            <div class="stat__value">${num(stats.pending)}</div>
            <div class="stat__label">Need a reply</div>
          </div>
          <div class="stat">
            <div class="stat__value">${num(stats.in_progress)}</div>
            <div class="stat__label">In the workshop</div>
          </div>
          <div class="stat${stats.missed_calls_today ? ' stat--alert' : ''}">
            <div class="stat__value">${num(stats.missed_calls_today)}</div>
            <div class="stat__label">Missed calls today</div>
          </div>
        </div>

        ${
          pending.count
            ? `<div class="section-title"><span>Needs your reply</span><span>${num(pending.count)}</span></div>
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
                           <a class="btn btn--icon" href="${esc(appointment.customer_tel_link ?? '#')}" aria-label="Call customer">
                             ${icon('phone', { size: 17 })}
                           </a>
                         </div>
                         <div class="btn-row">
                           <button class="btn btn--small" data-accept="${esc(appointment.id)}">Accept</button>
                           <button class="btn btn--small btn--soft" data-open="${esc(appointment.id)}">Details</button>
                         </div>
                       </div>`,
                   )
                   .join('')}
               </div>
               ${pending.count > 4 ? '<a class="btn btn--soft btn--block btn--small" href="/appointments?filter=pending">See all requests</a>' : ''}`
            : ''
        }

        <div class="section-title">
          <span>Today${today.appointments.length ? '' : ' · nothing booked'}</span>
          <a href="/appointments?filter=today" style="font-size:12px">Open</a>
        </div>
        ${
          today.appointments.length
            ? `<div class="list">${today.appointments.map((item) => appointmentRow(item)).join('')}</div>`
            : emptyState('No jobs booked for today', 'Bookings from your website appear here automatically.', 'car')
        }

        <div class="section-title"><span>Shortcuts</span></div>
        <div class="list">
          <a class="list__item" href="/chat/support">
            ${icon('chat')}
            <div class="grow"><div class="list__title">DerteApp support</div>
              <div class="list__meta">${store.unread.support ? `${num(store.unread.support)} unread` : 'Message the DerteApp team'}</div>
            </div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
          <a class="list__item" href="/insights">
            ${icon('chart')}
            <div class="grow"><div class="list__title">Website &amp; call insights</div>
              <div class="list__meta">${num(stats.site_views_today)} site views today</div>
            </div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
          <a class="list__item" href="/settings/website">
            ${icon('code')}
            <div class="grow"><div class="list__title">Website booking form</div>
              <div class="list__meta">Connect your Hostinger site</div>
            </div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
        </div>
      </div>`);

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
          toast('Confirmed — call the customer from the booking', 'ok');
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
    appointment_created: () => {
      toast('New booking request');
      load();
      refreshBadges();
    },
    appointment_updated: () => load(),
    chat_message: () => refreshBadges(),
    call_event: (payload) => {
      if (payload?.event === 'NOTIFY_START') toast(`Incoming call ${payload.call?.caller_phone_display ?? ''}`.trim());
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
