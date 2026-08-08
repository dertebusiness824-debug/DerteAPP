/**
 * Customer chat (`/c/:token`).
 *
 * Opened from the secure link the shop owner shares once a booking is accepted.
 * Deliberately standalone: no account, no session, no app shell - just the
 * booking, the conversation, and the shop's phone number ready to tap.
 */
import { esc, icon, timeOf, toast } from './ui.js';

const token = decodeURIComponent(location.pathname.replace(/^\/c\//, '').replace(/\/$/, ''));
const root = document.getElementById('root');

const base = `/api/public/chat/${encodeURIComponent(token)}`;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Something went wrong. Please try again.');
  return payload;
}

const messageBubble = (message, timeZone) => {
  if (message.sender_type === 'system') {
    return `<div class="msg msg--system">${esc(message.body)}</div>`;
  }
  // The customer is the "out" side here - the mirror of the owner's view.
  const outgoing = message.sender_type === 'customer';
  return `
    <div class="msg msg--${outgoing ? 'out' : 'in'}">
      ${!outgoing ? `<span class="msg__author">${esc(message.sender_name)}</span>` : ''}
      ${esc(message.body)}
      <span class="msg__meta">${esc(timeOf(message.created_at, timeZone))}</span>
    </div>`;
};

const bookingSummary = (appointment, timeZone) => {
  if (!appointment) return '';
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(appointment.scheduled_at));

  const vehicle = [appointment.vehicle_make, appointment.vehicle_model].filter(Boolean).join(' ');
  const STATUS_TEXT = {
    pending: 'Confirmed',
    accepted: 'Confirmed',
    confirmed: 'Confirmed',
    in_progress: 'Your vehicle is in the workshop',
    completed: 'Work completed',
    cancelled: 'Cancelled',
    no_show: 'Marked as a no-show',
  };

  return `
    <div class="public__booking">
      <div class="row row--between">
        <strong>${esc(when)}</strong>
        <span class="badge">${esc(appointment.reference)}</span>
      </div>
      <div class="list__meta">
        ${esc(STATUS_TEXT[appointment.status] ?? appointment.status)}
        ${appointment.service_type ? ` · ${esc(appointment.service_type)}` : ''}
        ${vehicle ? ` · ${esc(vehicle)}` : ''}
        ${appointment.vehicle_plate ? ` · ${esc(appointment.vehicle_plate)}` : ''}
      </div>
    </div>`;
};

function renderError(message) {
  document.getElementById('boot')?.remove();
  root.innerHTML = `
    <div class="public">
      <div class="empty">
        ${icon('x', { size: 30 })}
        <div class="empty__title">Chat unavailable</div>
        <div>${esc(message)}</div>
      </div>
    </div>`;
}

async function start() {
  if (!token || token.length < 16) {
    renderError('This chat link looks incomplete. Please use the full link the shop sent you.');
    return;
  }

  let payload;
  try {
    payload = await call('GET', '');
  } catch (error) {
    renderError(error.message);
    return;
  }

  const { contact, appointment, thread } = payload;
  const timeZone = contact.timezone;
  document.title = `${contact.shop_name} · Chat`;

  root.innerHTML = `
    <div class="public">
      <header class="public__header">
        <div class="public__identity">
          <img src="/icons/icon-192.png" alt="" width="40" height="40" class="public__logo" />
          <div class="grow">
            <strong class="truncate">${esc(contact.shop_name)}</strong>
            <div class="list__meta">${esc(contact.owner_name ?? 'Your garage')}</div>
          </div>
        </div>
        ${
          contact.tel_link
            ? `<div class="public__contact">
                 <a class="btn btn--block" href="${esc(contact.tel_link)}">
                   ${icon('phone', { size: 17 })}Call ${esc(contact.phone_display)}
                 </a>
                 ${
                   contact.whatsapp_link
                     ? `<a class="btn btn--soft btn--icon" href="${esc(contact.whatsapp_link)}" target="_blank"
                           rel="noopener" aria-label="WhatsApp">${icon('whatsapp', { size: 18 })}</a>`
                     : ''
                 }
               </div>`
            : '<div class="list__meta">The shop has not published a phone number yet.</div>'
        }
        ${bookingSummary(appointment, timeZone)}
      </header>

      <div class="chat__log" data-log></div>

      ${
        thread.status === 'closed'
          ? `<div class="public__closed">This conversation has been closed. Please call the shop if you need anything else.</div>`
          : `<form class="composer">
               <label class="sr-only" for="composer-input">Message</label>
               <textarea id="composer-input" rows="1" maxlength="4000" placeholder="Write a message…"></textarea>
               <button class="btn btn--icon" type="submit" aria-label="Send">${icon('send', { size: 18 })}</button>
             </form>`
      }
    </div>`;

  document.getElementById('boot')?.remove();

  const log = root.querySelector('[data-log]');
  let lastId = null;

  const append = (messages) => {
    const fresh = messages.filter((message) => message.id !== lastId);
    if (!fresh.length) return;
    log.insertAdjacentHTML('beforeend', fresh.map((message) => messageBubble(message, timeZone)).join(''));
    lastId = fresh.at(-1).id;
    log.scrollTop = log.scrollHeight;
  };

  if (payload.messages.length) append(payload.messages);
  else log.innerHTML = '<div class="msg msg--system">Send a message and the shop will reply here.</div>';

  const form = root.querySelector('.composer');
  if (form) {
    const input = form.querySelector('textarea');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const { message } = await call('POST', '/messages', { body });
        append([message]);
        input.value = '';
        input.style.height = 'auto';
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
        input.focus();
      }
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !matchMedia('(pointer: coarse)').matches) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }

  const pull = async () => {
    try {
      const result = await call('GET', `/messages${lastId ? `?after_id=${encodeURIComponent(lastId)}` : ''}`);
      append(result.messages);
    } catch {
      // A dropped poll is harmless; the next tick retries.
    }
  };

  // Live updates, with polling as the backstop.
  try {
    const source = new EventSource(`${base}/stream`);
    source.addEventListener('chat_message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.message) append([data.message]);
      } catch {
        // Ignore malformed frames.
      }
    });
    addEventListener('pagehide', () => source.close());
  } catch {
    // EventSource unavailable: polling below still keeps the chat current.
  }

  setInterval(() => {
    if (document.visibilityState === 'visible') void pull();
  }, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pull();
  });
}

void start();
