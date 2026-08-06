/**
 * DerteApp embed script for Hostinger Website Builder sites.
 *
 * Paste into Website settings -> Integrations -> Custom code (head):
 *
 *   <script src="https://your-derteapp-host/embed/derteapp.js"
 *           data-derte-key="dk_your_public_key"
 *           data-derte-api="https://your-derteapp-host"
 *           defer></script>
 *
 * What it does, without disturbing the rest of the page:
 *   - records page views and tap-to-call / WhatsApp clicks for the dashboard
 *   - keeps the booking form inside the shop's real opening hours
 *   - fills a time selector with slots that are genuinely free
 *   - posts confirmed bookings straight into DerteApp
 *
 * Markup hooks (all optional):
 *   <form data-derte="booking-form">          the booking form to enhance
 *   <input name="date"> <select name="time">  filled and validated automatically
 *   <input name="derte_trap" hidden>          honeypot; bots fill it in, people do not
 *   <element data-derte="hours">              rendered with the weekly hours
 *   <element data-derte="status">             rendered with "Open now" / "Closed"
 *   <element data-derte="phone">              rendered with the shop phone number
 *
 * Script tag attributes:
 *   data-derte-key    (required) the shop's public key
 *   data-derte-api    (required) the DerteApp origin
 *   data-derte-form   CSS selector for the form (default [data-derte='booking-form'])
 *   data-derte-mode   "takeover" (default) posts only to DerteApp and shows its own
 *                     confirmation; "observe" also lets the site's own submission run
 *   data-derte-track  "false" disables analytics collection
 */
(() => {
  'use strict';

  const script =
    document.currentScript ??
    [...document.getElementsByTagName('script')].reverse().find((tag) => tag.src?.includes('derteapp.js'));

  if (!script) return;

  const KEY = script.getAttribute('data-derte-key');
  const API = (script.getAttribute('data-derte-api') ?? '').replace(/\/$/, '');
  const FORM_SELECTOR = script.getAttribute('data-derte-form') ?? "[data-derte='booking-form']";
  const MODE = script.getAttribute('data-derte-mode') ?? 'takeover';
  const TRACK = script.getAttribute('data-derte-track') !== 'false';

  if (!KEY || !API) {
    console.warn('[DerteApp] data-derte-key and data-derte-api are required on the embed script tag.');
    return;
  }

  const BASE = `${API}/api/public/shops/${encodeURIComponent(KEY)}`;
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let config = null;

  // --- helpers ---------------------------------------------------------------

  function sessionId() {
    try {
      const existing = sessionStorage.getItem('derte_sid');
      if (existing) return existing;
      const fresh = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('derte_sid', fresh);
      return fresh;
    } catch {
      // Private browsing can block storage; analytics simply degrades.
      return null;
    }
  }

  async function request(path, { method = 'GET', body, keepalive = false } = {}) {
    const response = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      keepalive,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message ?? 'Request failed');
      error.code = payload.error?.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /** Analytics must never break the host page, so failures are swallowed. */
  function track(eventType, metadata = {}) {
    if (!TRACK) return Promise.resolve();
    return request('/events', {
      method: 'POST',
      keepalive: true,
      body: {
        event_type: eventType,
        path: location.pathname + location.search,
        referrer: document.referrer || null,
        session_id: sessionId(),
        metadata,
      },
    }).catch(() => {});
  }

  /**
   * Finds a field by any of several likely names. Hostinger forms are built by
   * hand, so we accept an explicit data attribute, an exact name, a partial
   * name and an id, in that order.
   */
  function field(form, names) {
    for (const name of names) {
      const found =
        form.querySelector(`[data-derte-field="${name}"]`) ??
        form.querySelector(`[name="${name}"]`) ??
        form.querySelector(`[name*="${name}" i]`) ??
        form.querySelector(`#${name}`);
      if (found) return found;
    }
    return null;
  }

  const valueOf = (form, names) => field(form, names)?.value?.trim() ?? '';

  const STYLE_ID = 'derte-embed-style';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.derte-note{margin:12px 0;padding:12px 14px;border-radius:10px;border:1px solid transparent;',
      'font:500 14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.derte-note--info{background:#eef2ff;border-color:#c7d2fe;color:#1e3a8a}',
      '.derte-note--ok{background:#ecfdf5;border-color:#a7f3d0;color:#065f46}',
      '.derte-note--error{background:#fef2f2;border-color:#fecaca;color:#991b1b}',
      '.derte-note[hidden]{display:none}',
      '.derte-hours{display:grid;grid-template-columns:auto 1fr;gap:2px 16px;margin:0}',
      '.derte-hours dt{font-weight:600}.derte-hours dd{margin:0}',
    ].join('');
    document.head.appendChild(style);
  }

  function say(form, message, kind = 'info') {
    let note = form.querySelector('.derte-note');
    if (!note) {
      injectStyles();
      note = document.createElement('div');
      note.className = 'derte-note';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      form.append(note);
    }
    note.className = `derte-note derte-note--${kind}`;
    note.textContent = message;
    note.hidden = !message;
  }

  // --- shop details on the page ---------------------------------------------

  function renderShopDetails() {
    for (const node of document.querySelectorAll("[data-derte='status']")) {
      node.textContent = config.open_now ? 'Open now' : 'Closed';
      node.dataset.derteOpen = String(config.open_now);
    }

    for (const node of document.querySelectorAll("[data-derte='phone']")) {
      if (!config.shop.phone) continue;
      node.textContent = config.shop.phone_display ?? config.shop.phone;
      if (node.tagName === 'A') node.href = config.shop.tel_link;
    }

    for (const node of document.querySelectorAll("[data-derte='hours']")) {
      injectStyles();
      const list = document.createElement('dl');
      list.className = 'derte-hours';
      // Monday first: how opening hours are read everywhere.
      for (const weekday of [1, 2, 3, 4, 5, 6, 0]) {
        const day = config.weekly_hours[weekday];
        const term = document.createElement('dt');
        term.textContent = DAY_NAMES[weekday];
        const value = document.createElement('dd');
        if (!day || day.is_closed) value.textContent = 'Closed';
        else if (day.break_start) {
          value.textContent = `${day.open_time}-${day.break_start}, ${day.break_end}-${day.close_time}`;
        } else value.textContent = `${day.open_time}-${day.close_time}`;
        list.append(term, value);
      }
      node.replaceChildren(list);
    }
  }

  // --- calendar helpers ------------------------------------------------------

  function todayInShopTimezone() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: config.shop.timezone }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function addDays(dateString, days) {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function weekdayOf(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }

  const isClosedOn = (dateString) =>
    config.closed_dates.includes(dateString) || (config.weekly_hours[weekdayOf(dateString)]?.is_closed ?? true);

  // --- booking form ----------------------------------------------------------

  function enhance(form) {
    const dateInput = field(form, ['date', 'day', 'appointment_date', 'fecha']);
    const timeInput = field(form, ['time', 'hour', 'appointment_time', 'hora']);
    const serviceInput = field(form, ['service', 'service_type', 'servicio']);

    if (dateInput?.type === 'date') {
      const today = todayInShopTimezone();
      dateInput.min = today;
      dateInput.max = addDays(today, config.shop.booking_horizon_days);
    }

    // Offer the shop's service list when the dropdown was left empty.
    if (serviceInput?.tagName === 'SELECT' && serviceInput.options.length <= 1) {
      for (const service of config.shop.services ?? []) {
        serviceInput.append(new Option(service, service));
      }
    }

    async function loadSlots() {
      if (!dateInput?.value) return;
      const date = dateInput.value;

      if (isClosedOn(date)) {
        say(form, `The shop is closed on ${date}. Please choose another day.`, 'error');
        if (timeInput?.tagName === 'SELECT') timeInput.replaceChildren(new Option('Closed that day', ''));
        return;
      }

      say(form, 'Checking available times…');
      try {
        const payload = await request(
          `/availability?date=${encodeURIComponent(date)}&session_id=${encodeURIComponent(sessionId() ?? '')}`,
        );
        const [day] = payload.days ?? [];
        const free = day?.slots.filter((slot) => slot.available) ?? [];

        if (timeInput?.tagName === 'SELECT') {
          timeInput.replaceChildren(new Option(free.length ? 'Choose a time' : 'No times left on this day', ''));
          for (const slot of free) timeInput.append(new Option(slot.time, slot.time));
        }

        if (!free.length) {
          say(form, 'That day is fully booked. Please pick another date.', 'error');
        } else if (day.break_start) {
          say(form, `Open ${day.open_time}-${day.close_time} (closed ${day.break_start}-${day.break_end}).`);
        } else {
          say(form, `Open ${day.open_time}-${day.close_time}.`);
        }
      } catch {
        say(form, '');
      }
    }

    dateInput?.addEventListener('change', loadSlots);
    if (dateInput?.value) loadSlots();

    form.addEventListener('focusin', () => track('form_view', { form: form.name || form.id || null }), { once: true });

    form.addEventListener('submit', async (event) => {
      // In observe mode we re-submit the form ourselves; let that one through.
      if (form.dataset.derteSubmitted === 'true') return;
      event.preventDefault();

      const payload = {
        customer_name: valueOf(form, ['name', 'full_name', 'customer_name', 'nombre']),
        customer_phone: valueOf(form, ['phone', 'tel', 'telephone', 'mobile', 'telefono']),
        customer_email: valueOf(form, ['email', 'e-mail', 'correo']) || null,
        service_type: serviceInput?.value || null,
        vehicle_make: valueOf(form, ['make', 'vehicle_make', 'marca']) || null,
        vehicle_model: valueOf(form, ['model', 'vehicle_model', 'modelo']) || null,
        vehicle_plate: valueOf(form, ['plate', 'registration', 'matricula']) || null,
        notes: valueOf(form, ['notes', 'message', 'comments', 'mensaje']) || null,
        date: dateInput?.value ?? null,
        time: timeInput?.value ?? null,
        source_url: location.href,
        session_id: sessionId(),
        trap: valueOf(form, ['derte_trap']) || null,
      };

      if (!payload.customer_name || !payload.customer_phone) {
        say(form, 'Please add your name and phone number so the shop can reach you.', 'error');
        return;
      }
      if (!payload.date || !payload.time) {
        say(form, 'Please choose a date and a time.', 'error');
        return;
      }

      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      say(form, 'Sending your request…');

      try {
        const response = await request('/appointments', { method: 'POST', body: payload });
        say(form, response.message ?? 'Your request has been sent.', 'ok');
        form.dispatchEvent(new CustomEvent('derte:booked', { detail: response, bubbles: true }));

        if (MODE === 'observe') {
          // Let the site's own handler run too, so existing email notifications
          // and thank-you pages keep working.
          form.dataset.derteSubmitted = 'true';
          if (submit) submit.disabled = false;
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
          return;
        }

        form.reset();
        if (submit) submit.disabled = false;
        loadSlots();
      } catch (error) {
        say(form, error.message ?? 'We could not send your request. Please call the shop.', 'error');
        if (submit) submit.disabled = false;
        if (['full', 'outside_hours', 'break_time', 'closed_day'].includes(error.code)) loadSlots();
      }
    });
  }

  // --- boot ------------------------------------------------------------------

  function trackContactClicks() {
    document.addEventListener(
      'click',
      (event) => {
        const link = event.target?.closest?.('a[href]');
        const href = link?.getAttribute('href') ?? '';
        if (href.startsWith('tel:')) track('call_click', { href });
        else if (href.includes('wa.me') || href.includes('whatsapp.com')) track('whatsapp_click', { href });
      },
      true,
    );
  }

  async function start() {
    track('pageview');
    trackContactClicks();

    try {
      config = await request('/config');
      config.closed_dates ??= [];
      renderShopDetails();

      const forms = [...document.querySelectorAll(FORM_SELECTOR)];
      if (forms.length === 0) {
        // Fall back to the first form on the page that asks for a phone number.
        const candidate = [...document.querySelectorAll('form')].find((form) =>
          field(form, ['phone', 'tel', 'telefono']),
        );
        if (candidate) forms.push(candidate);
      }
      forms.forEach(enhance);

      window.DerteApp.config = config;
      document.dispatchEvent(new CustomEvent('derte:ready', { detail: config }));
    } catch (error) {
      console.warn('[DerteApp] could not load the shop configuration:', error.message);
    }
  }

  // Small public API for shops that want to build their own booking flow.
  window.DerteApp = {
    key: KEY,
    api: API,
    config: null,
    track,
    availability: (date) => request(`/availability?date=${encodeURIComponent(date)}`),
    checkSlot: (date, time) => request('/check-slot', { method: 'POST', body: { date, time } }),
    book: (payload) => request('/appointments', { method: 'POST', body: payload }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
