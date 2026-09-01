/** Small DOM and formatting helpers shared by every view. */
import { icon } from './icons.js';
import { getLocale, t } from './i18n.js';

/** Escapes text for safe interpolation into a template string. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Builds an element from an HTML string. */
export function html(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

/**
 * Explicit red X close control for sheets, menus and secondary screens.
 * Extra attributes (e.g. data-sheet-close) can be passed as a flat object.
 * Use `className` to append classes onto the base `.btn-close`.
 */
export function closeButtonHtml(attrs = {}) {
  const { className = '', 'aria-label': ariaLabel = t('common.close'), ...rest } = attrs;
  const classes = ['btn-close', className].filter(Boolean).join(' ').trim();
  const extra = Object.entries(rest)
    .filter(([, value]) => value !== false && value !== null && value !== undefined)
    .map(([key, value]) => (value === true ? ` ${key}` : ` ${key}="${esc(value)}"`))
    .join('');
  return (
    `<button type="button" class="${esc(classes)}"${extra} aria-label="${esc(ariaLabel)}">` +
    `${icon('x', { size: 22, className: 'btn-close__icon' })}` +
    `</button>`
  );
}

/** Builds a document fragment from an HTML string. */
export function fragment(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content;
}

export const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
};

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Delegated click handler: `on(root, '[data-action="x"]', handler)`. */
export function on(root, selector, handler, event = 'click') {
  root.addEventListener(event, (e) => {
    const match = e.target.closest?.(selector);
    if (match && root.contains(match)) handler(e, match);
  });
}

// --- formatting -------------------------------------------------------------

const STATUS_TONES = {
  confirmed: 'ok',
  pending: 'ok',
  accepted: 'ok',
  in_progress: 'info',
  completed: 'ok',
  cancelled: 'danger',
  no_show: 'danger',
};

export const APPOINTMENT_STATUS = new Proxy(
  {},
  {
    get(_target, status) {
      if (typeof status !== 'string') return undefined;
      if (!STATUS_TONES[status]) return undefined;
      return { label: t(`status.${status}`), tone: STATUS_TONES[status] };
    },
  },
);

export const statusBadge = (status) => {
  const tone = STATUS_TONES[status] ?? '';
  const label = STATUS_TONES[status] ? t(`status.${status}`) : status;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}">${esc(label)}</span>`;
};

const numberFormatFor = () => new Intl.NumberFormat(getLocale() === 'en' ? 'en-GB' : 'es-ES');
export const num = (value) => numberFormatFor().format(Number(value ?? 0));

/** Local time of day, in the shop's timezone when one is given. */
export function timeOf(iso, timeZone) {
  if (!iso) return '';
  const locale = getLocale() === 'en' ? 'en-GB' : 'es-ES';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(
    new Date(iso),
  );
}

export function dayOf(iso, timeZone) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: '2-digit', month: 'short', timeZone }).format(
    new Date(iso),
  );
}

export function dateTimeOf(iso, timeZone) {
  if (!iso) return '';
  return `${dayOf(iso, timeZone)} · ${timeOf(iso, timeZone)}`;
}

/** "ahora mismo", "12 min", "3 h", "5 d" - compact enough for list rows. */
export function ago(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'ahora mismo';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)} d`;
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(new Date(iso));
}

export function duration(seconds) {
  const total = Number(seconds ?? 0);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const initials = (name) =>
  String(name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

// --- feedback ---------------------------------------------------------------

let toastHost;

let lastToastKey = '';
let lastToastAt = 0;

export function toast(message, kind = '') {
  const text = String(message ?? '').trim();
  if (!text) return;

  // Collapse identical toasts fired in a short window (e.g. form errorBox + toast).
  const key = `${kind}:${text}`;
  const now = Date.now();
  if (key === lastToastKey && now - lastToastAt < 1800) return;
  lastToastKey = key;
  lastToastAt = now;

  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el('div', { class: `toast${kind ? ` toast--${kind}` : ''}`, text });
  toastHost.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s ease';
    setTimeout(() => node.remove(), 220);
  }, kind === 'error' ? 4200 : 2600);
}

export const emptyState = (title, body = '', iconName = 'inbox') => `
  <div class="empty">
    ${icon(iconName, { size: 30 })}
    <div class="empty__title">${esc(title)}</div>
    ${body ? `<div>${esc(body)}</div>` : ''}
  </div>`;

export const skeletonList = (rows = 4) =>
  `<div class="stack stack--tight">${Array.from(
    { length: rows },
    () => '<div class="skeleton" style="height:62px"></div>',
  ).join('')}</div>`;

const openSheetClosers = new Set();

/**
 * Drops every bottom sheet and unlocks body scroll.
 * Call this before a route remount: an orphan backdrop freezes native
 * <select> / <details> on iOS (overflow:hidden + a full-screen overlay).
 */
export function closeAllSheets() {
  for (const close of [...openSheetClosers]) {
    try {
      close();
    } catch {
      // A closer that already ran is fine.
    }
  }
  openSheetClosers.clear();
  document.querySelectorAll('.sheet-backdrop').forEach((node) => node.remove());
  document.body.style.overflow = '';
}

/**
 * Opens a bottom sheet and resolves when it closes.
 * `render(close)` returns the sheet body markup or a node.
 */
export function sheet({ title, body, onMount, onClose }) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  panel.innerHTML = `
    <div class="sheet__grab"></div>
    <div class="sheet__head">
      ${title ? `<div class="sheet__title">${esc(title)}</div>` : '<div class="sheet__title sheet__title--empty" aria-hidden="true"></div>'}
      ${closeButtonHtml({ 'data-sheet-close': true })}
    </div>`;

  const content = el('div', { class: 'sheet__body' });
  if (typeof body === 'string') content.innerHTML = body;
  else if (body) content.append(body);
  panel.append(content);
  backdrop.append(panel);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openSheetClosers.delete(close);
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  openSheetClosers.add(close);
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  const onCloseClick = (event) => {
    event.preventDefault();
    close();
  };

  panel.querySelector('[data-sheet-close]')?.addEventListener('click', onCloseClick);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  // Never lock document.body overflow: iOS Safari refuses to open native
  // <select> pickers while html/body overflow is hidden. The fixed backdrop
  // already covers the page.
  document.body.append(backdrop);

  onMount?.(content, close);
  return { close, content };
}

/** Confirmation sheet. Dismissing it by backdrop or Escape counts as "no". */
export function confirmSheet({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    sheet({
      title,
      body: `
        <div class="stack">
          <p style="color:var(--muted)">${esc(message)}</p>
          <button class="btn ${danger ? 'btn--danger' : ''} btn--block" data-confirm>${esc(confirmLabel)}</button>
          <button class="btn btn--soft btn--block" data-cancel>Cancelar</button>
        </div>`,
      onMount(content, close) {
        content.querySelector('[data-confirm]').addEventListener('click', () => {
          answer = true;
          close();
        });
        content.querySelector('[data-cancel]').addEventListener('click', close);
      },
      onClose: () => resolve(answer),
    });
  });
}

/**
 * Confirmation sheet with an optional short note, used when a status change is
 * something the customer will read (a cancellation, for example).
 * Resolves `{ confirmed, reason }`; `reason` is null when left blank.
 */
export function reasonSheet({ title, message, confirmLabel = 'Confirmar', danger = false, placeholder = 'Nota opcional para el cliente' }) {
  return new Promise((resolve) => {
    const outcome = { confirmed: false, reason: null };
    sheet({
      title,
      body: `
        <div class="stack">
          <p style="color:var(--muted)">${esc(message)}</p>
          <div class="field">
            <label class="sr-only" for="reason-note">${esc(placeholder)}</label>
            <input id="reason-note" class="input" maxlength="300" placeholder="${esc(placeholder)}">
          </div>
          <button class="btn ${danger ? 'btn--danger' : ''} btn--block" data-confirm>${esc(confirmLabel)}</button>
          <button class="btn btn--soft btn--block" data-cancel>Dejar como está</button>
        </div>`,
      onMount(content, close) {
        const input = content.querySelector('#reason-note');
        input.focus();
        content.querySelector('[data-confirm]').addEventListener('click', () => {
          outcome.confirmed = true;
          outcome.reason = input.value.trim() || null;
          close();
        });
        content.querySelector('[data-cancel]').addEventListener('click', close);
      },
      onClose: () => resolve(outcome),
    });
  });
}

/** Copies text and reports the outcome, with a fallback for insecure origins. */
export async function copy(text, label = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'ok');
    return true;
  } catch {
    const field = el('textarea', { style: 'position:fixed;opacity:0', text });
    document.body.append(field);
    field.select();
    const ok = document.execCommand?.('copy');
    field.remove();
    toast(ok ? label : 'No se pudo copiar: mantén pulsado para copiar a mano', ok ? 'ok' : 'error');
    return Boolean(ok);
  }
}

/** Native share sheet where available, clipboard otherwise. */
export async function share({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch {
      return false;
    }
  }
  return copy(url ?? text, 'Enlace copiado');
}

/** Contact buttons used on appointments, chats and admin rows. */
export const contactButtons = ({
  telLink,
  whatsappLink,
  phoneDisplay,
  compact = false,
  callPrimary = false,
} = {}) => {
  if (!telLink && !whatsappLink) return '';
  const size = compact ? ' btn--small' : '';
  const callTone = callPrimary ? '' : ' btn--soft';
  return `
    <div class="contact-actions">
      ${telLink ? `<a class="btn${callTone}${size}" href="${esc(telLink)}" data-native="true" data-track="call">${icon('phone', { size: 17 })}${compact ? 'Llamar' : esc(phoneDisplay ?? 'Llamar')}</a>` : ''}
      ${whatsappLink ? `<a class="btn btn--soft${size}" href="${esc(whatsappLink)}" target="_blank" rel="noopener" data-track="whatsapp">${icon('whatsapp', { size: 17 })}WhatsApp</a>` : ''}
    </div>`;
};

/** Bar chart from `[{ label, value }]`, drawn with plain elements. */
export function barChart(points, { muted = false } = {}) {
  if (!points.length) return '';
  const max = Math.max(...points.map((point) => point.value), 1);
  const bars = points
    .map(
      (point) =>
        `<div class="chart__bar${muted ? ' chart__bar--muted' : ''}" style="height:${Math.max(
          (point.value / max) * 100,
          2,
        )}%" title="${esc(point.label)}: ${num(point.value)}"></div>`,
    )
    .join('');
  return `
    <div class="chart">${bars}</div>
    <div class="chart__axis"><span>${esc(points[0].label)}</span><span>${esc(points.at(-1).label)}</span></div>`;
}

export { icon };
