/**
 * Support chat: Super Admin ↔ shop owner only.
 *
 * The owner's registered phone number stays visible at the top so either side
 * can tap to call. Customers are contacted from the booking card, not here.
 */
import { api, stream } from '../api.js';
import { navigate } from '../router.js';
import { refreshBadges, store } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import { emptyState, esc, icon, skeletonList, timeOf, toast } from '../ui.js';

export async function chatListView() {
  const shop = requireShop({ title: 'Soporte', navKey: 'chat' });
  if (!shop) return undefined;

  // One conversation per shop — open it directly.
  navigate('/chat/support', { replace: true });
  return undefined;
}

const messageBubble = (message, { timeZone } = {}) => {
  if (message.sender_type === 'system') {
    return `<div class="msg msg--system">${esc(message.body)}</div>`;
  }
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
 * shop's support conversation with DerteApp.
 */
export async function chatView({ params }) {
  const shop = requireShop({ title: 'Soporte', navKey: 'chat' });
  if (!shop) return undefined;

  screen({ title: 'Soporte', back: store.isSuperAdmin ? '/admin/inbox' : '/', nav: 'chat', flush: true, content: skeletonList(3) });

  let payload;
  try {
    payload = params.threadId === 'support' ? await api.supportThread(shop.id) : await api.thread(params.threadId);
  } catch (error) {
    setContent(emptyState('Conversación no disponible', error.message, 'x'));
    return undefined;
  }

  const thread = payload.thread;
  if (thread.kind !== 'support') {
    setContent(
      emptyState(
        'Chat con clientes eliminado',
        'Los mensajes son solo entre tú y el soporte de DerteApp. Contacta a los clientes desde la ficha de la reserva.',
        'phone',
      ),
    );
    return undefined;
  }

  // Header: for the owner it's DerteApp; for the Super Admin it's the owner,
  // with their registered phone number ready to tap.
  const contact = store.isSuperAdmin
    ? {
        name: payload.contact.owner_name ?? shop.name,
        phoneDisplay: payload.contact.phone_display,
        telLink: payload.contact.tel_link,
        whatsappLink: payload.contact.whatsapp_link,
        note: 'Propietario · número registrado',
      }
    : {
        name: 'Soporte DerteApp',
        phoneDisplay: null,
        telLink: null,
        whatsappLink: null,
        note: shop.name,
      };

  screen({
    title: contact.name,
    subtitle: store.isSuperAdmin ? shop.name : 'Línea directa con DerteApp',
    back: store.isSuperAdmin ? '/admin/inbox' : '/settings',
    nav: store.isSuperAdmin ? 'inbox' : 'chat',
    flush: true,
    content: `
      <div class="chat">
        <div class="chat__contact">
          <span class="avatar">${icon(store.isSuperAdmin ? 'building' : 'megaphone', { size: 19 })}</span>
          <div class="grow">
            ${
              contact.telLink
                ? `<a class="chat__phone" href="${esc(contact.telLink)}">${icon('phone', { size: 15 })}${esc(contact.phoneDisplay)}</a>`
                : `<span class="list__title">${esc(contact.name)}</span>`
            }
            <div class="list__meta">${esc(contact.note)}</div>
          </div>
          ${
            contact.whatsappLink
              ? `<a class="btn btn--icon" href="${esc(contact.whatsappLink)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp', { size: 18 })}</a>`
              : ''
          }
        </div>
        <div class="chat__log" data-log></div>
        <form class="composer">
          <label class="sr-only" for="composer-input">Mensaje</label>
          <textarea id="composer-input" rows="1" placeholder="Escribe un mensaje…" maxlength="4000"></textarea>
          <button class="btn btn--icon" type="submit" aria-label="Enviar">${icon('send', { size: 18 })}</button>
        </form>
      </div>`,
  });

  const main = document.querySelector('.main');
  const log = main.querySelector('[data-log]');
  const form = main.querySelector('.composer');
  const input = form.querySelector('textarea');

  let lastId = null;
  const timeZone = payload.contact?.timezone;

  const append = (messages, { scroll = true } = {}) => {
    if (!messages.length) return;
    log.insertAdjacentHTML('beforeend', messages.map((message) => messageBubble(message, { timeZone })).join(''));
    lastId = messages.at(-1).id;
    if (scroll) log.scrollTop = log.scrollHeight;
  };

  if (payload.messages.length) append(payload.messages);
  else {
    log.innerHTML = `<div class="msg msg--system">${esc(
      store.isSuperAdmin
        ? `Línea de soporte de ${shop.name}. El número del propietario está arriba.`
        : 'Di hola — el equipo de DerteApp te responderá aquí.',
    )}</div>`;
  }

  await refreshBadges();

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

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') pull();
  }, 15_000);

  return () => {
    stopStream();
    clearInterval(timer);
  };
}
