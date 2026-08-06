/**
 * Conversations.
 *
 * Two kinds share this screen: customer chats opened when a booking is accepted,
 * and the shop's private line to DerteApp support. Whichever it is, the phone
 * number of the person on the other side sits at the top, ready to tap.
 */
import { api, stream } from '../api.js';
import { navigate } from '../router.js';
import { refreshBadges, store } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import { ago, emptyState, esc, icon, initials, skeletonList, timeOf, toast } from '../ui.js';

export async function chatListView() {
  const shop = requireShop({ title: 'Chats', navKey: 'chat' });
  if (!shop) return undefined;

  screen({
    title: 'Chats',
    subtitle: shop.name,
    nav: 'chat',
    shopSwitcher: true,
    content: skeletonList(4),
  });

  async function load() {
    let payload;
    try {
      payload = await api.threads({ shop_id: shop.id });
    } catch (error) {
      setContent(emptyState('Could not load chats', error.message, 'x'));
      return;
    }

    const support = payload.threads.find((thread) => thread.kind === 'support');
    const customers = payload.threads.filter((thread) => thread.kind === 'customer');

    const main = setContent(`
      <div class="stack">
        <div class="section-title"><span>DerteApp support</span></div>
        <div class="list">
          <button class="list__item" data-support>
            <span class="avatar">${icon('megaphone', { size: 19 })}</span>
            <div class="grow">
              <div class="list__title">Message the DerteApp team</div>
              <div class="list__meta truncate">
                ${support?.last_message_preview ? esc(support.last_message_preview) : 'Ask about telephony, your website or billing'}
              </div>
            </div>
            ${support?.unread_for_shop ? `<span class="badge badge--danger">${support.unread_for_shop}</span>` : icon('chevron', { size: 18, className: 'chev' })}
          </button>
        </div>

        <div class="section-title">
          <span>Customers</span>
          ${customers.length ? `<span>${customers.length}</span>` : ''}
        </div>
        ${
          customers.length
            ? `<div class="list">${customers.map(threadRow).join('')}</div>`
            : emptyState(
                'No customer chats yet',
                'Accept a booking and DerteApp opens a private chat with that customer.',
                'chat',
              )
        }
      </div>`);

    main.querySelector('[data-support]').addEventListener('click', () => navigate('/chat/support'));
    main.addEventListener('click', (event) => {
      const row = event.target.closest('[data-thread]');
      if (row) navigate(`/chat/${row.dataset.thread}`);
    });
  }

  const threadRow = (thread) => `
    <button class="list__item" data-thread="${esc(thread.id)}">
      <span class="avatar">${esc(initials(thread.customer_name))}</span>
      <div class="grow">
        <div class="row row--between" style="gap:8px">
          <span class="list__title truncate">${esc(thread.customer_name ?? 'Customer')}</span>
          <span class="list__meta">${esc(ago(thread.last_message_at ?? thread.created_at))}</span>
        </div>
        <div class="list__meta truncate">${esc(thread.last_message_preview ?? 'No messages yet')}</div>
      </div>
      ${thread.unread_for_shop ? `<span class="badge badge--danger">${thread.unread_for_shop}</span>` : ''}
    </button>`;

  await load();

  const stopStream = stream(`/chat/stream?shop_id=${shop.id}`, {
    chat_message: () => {
      load();
      refreshBadges();
    },
  });
  return stopStream;
}

// --- one conversation -------------------------------------------------------

const messageBubble = (message, { timeZone } = {}) => {
  if (message.sender_type === 'system') {
    return `<div class="msg msg--system">${esc(message.body)}</div>`;
  }
  // "out" is always the signed-in side of the conversation.
  const outgoing = store.isSuperAdmin ? message.sender_type === 'admin' : message.sender_type === 'shop';
  return `
    <div class="msg msg--${outgoing ? 'out' : 'in'}">
      ${!outgoing ? `<span class="msg__author">${esc(message.sender_name)}</span>` : ''}
      ${esc(message.body)}
      <span class="msg__meta">${esc(timeOf(message.created_at, timeZone))}</span>
    </div>`;
};

/**
 * `threadId` may be the literal "support", which resolves to (or creates) this
 * shop's support conversation.
 */
export async function chatView({ params }) {
  const shop = requireShop({ title: 'Chat', navKey: 'chat' });
  if (!shop) return undefined;

  screen({ title: 'Chat', back: '/chat', nav: 'chat', flush: true, content: skeletonList(3) });

  let payload;
  try {
    payload = params.threadId === 'support' ? await api.supportThread(shop.id) : await api.thread(params.threadId);
  } catch (error) {
    setContent(emptyState('Conversation not available', error.message, 'x'));
    return undefined;
  }

  const thread = payload.thread;
  const isSupport = thread.kind === 'support';

  // Header contact: for a customer chat it is the customer; on the support line
  // it is the DerteApp team, with the owner's own number shown for reference.
  const contact = isSupport
    ? {
        name: 'DerteApp support',
        phoneDisplay: payload.contact.phone_display,
        telLink: payload.contact.tel_link,
        whatsappLink: null,
        note: 'Your registered number',
      }
    : {
        name: thread.customer_name ?? 'Customer',
        phoneDisplay: thread.customer_phone_display,
        telLink: thread.customer_tel_link,
        whatsappLink: thread.customer_whatsapp_link,
        note: payload.appointment ? `${payload.appointment.reference}` : 'Customer',
      };

  screen({
    title: contact.name,
    subtitle: isSupport ? shop.name : (payload.appointment?.service_type ?? 'Customer chat'),
    back: '/chat',
    nav: 'chat',
    flush: true,
    content: `
      <div class="chat">
        <div class="chat__contact">
          <span class="avatar">${isSupport ? icon('megaphone', { size: 19 }) : esc(initials(contact.name))}</span>
          <div class="grow">
            ${
              contact.telLink
                ? `<a class="chat__phone" href="${esc(contact.telLink)}">${icon('phone', { size: 15 })}${esc(contact.phoneDisplay)}</a>`
                : '<span class="list__meta">No phone number on file</span>'
            }
            <div class="list__meta">${esc(contact.note)}</div>
          </div>
          ${
            contact.whatsappLink
              ? `<a class="btn btn--icon" href="${esc(contact.whatsappLink)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp', { size: 18 })}</a>`
              : ''
          }
          ${
            payload.appointment && !isSupport
              ? `<button class="btn btn--icon" data-booking aria-label="Open booking">${icon('calendar', { size: 18 })}</button>`
              : ''
          }
        </div>
        <div class="chat__log" data-log></div>
        <form class="composer">
          <label class="sr-only" for="composer-input">Message</label>
          <textarea id="composer-input" rows="1" placeholder="Write a message…" maxlength="4000"></textarea>
          <button class="btn btn--icon" type="submit" aria-label="Send">${icon('send', { size: 18 })}</button>
        </form>
      </div>`,
  });

  const main = document.querySelector('.main');
  const log = main.querySelector('[data-log]');
  const form = main.querySelector('.composer');
  const input = form.querySelector('textarea');

  main.querySelector('[data-booking]')?.addEventListener('click', () =>
    navigate(`/appointments/${thread.appointment_id}`),
  );

  let lastId = null;
  const timeZone = payload.contact?.timezone;

  const append = (messages, { scroll = true } = {}) => {
    if (!messages.length) return;
    log.insertAdjacentHTML('beforeend', messages.map((message) => messageBubble(message, { timeZone })).join(''));
    lastId = messages.at(-1).id;
    if (scroll) log.scrollTop = log.scrollHeight;
  };

  if (payload.messages.length) append(payload.messages);
  else log.innerHTML = `<div class="msg msg--system">${esc(isSupport ? 'Say hello — the DerteApp team will reply here.' : 'No messages yet.')}</div>`;

  await refreshBadges();

  // Textarea grows with the message, up to the CSS max-height.
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
      const { message } = await api.sendMessage(thread.id, body);
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
    // Enter sends on a desktop keyboard; Shift+Enter makes a new line.
    if (event.key === 'Enter' && !event.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  const pull = async () => {
    try {
      const { messages } = await api.threadMessages(thread.id, lastId ? { after_id: lastId } : {});
      append(messages.filter((message) => message.id !== lastId));
    } catch {
      // Transient failures are fine; the next tick tries again.
    }
  };

  const stopStream = stream(`/chat/threads/${thread.id}/stream`, {
    chat_message: (event) => {
      if (event?.message && event.message.id !== lastId) append([event.message]);
    },
  });

  // Polling backstop for browsers or proxies that drop the SSE connection.
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') pull();
  }, 15_000);

  return () => {
    stopStream();
    clearInterval(timer);
  };
}
