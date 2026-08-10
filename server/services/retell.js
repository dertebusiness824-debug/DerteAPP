import crypto from 'node:crypto';
import config from '../config.js';
import { queryOne } from '../db/index.js';
import { countryCodeOf, normalizePhone, normalizeProviderPhone } from '../lib/phone.js';
import { minutesToTime, parseDateOnly, utcFromZoned, zonedDateString } from '../lib/time.js';

/**
 * Retell AI voice receptionist integration.
 *
 * Retell posts `{ event, call }` to our webhook when a call starts, ends and is
 * analyzed. What we care about lives in the post-call extraction fields, which
 * agents define themselves - so every lookup here is alias-tolerant and accepts
 * English or Spanish field names.
 */

const FIVE_MINUTES = 5 * 60 * 1000;
const SIGNATURE_PATTERN = /^v=(\d+),d=([0-9a-f]+)$/i;

/**
 * Verifies `X-Retell-Signature`, which Retell formats as
 * `v=<unix_ms>,d=<hex>` where the digest is
 * HMAC-SHA256(rawBody + timestamp) keyed by the API key.
 * The raw body must be the exact bytes received, never re-serialized JSON.
 */
export function verifyWebhook(rawBody, signatureHeader, { secret = config.retell.webhookSecret, now = Date.now(), timeout = FIVE_MINUTES } = {}) {
  if (!config.retell.verifyWebhooks) return { ok: true, skipped: true };
  if (!secret) return { ok: false, reason: 'not_configured' };
  if (typeof signatureHeader !== 'string') return { ok: false, reason: 'missing_signature' };

  const match = SIGNATURE_PATTERN.exec(signatureHeader.trim());
  if (!match) return { ok: false, reason: 'malformed_signature' };

  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp)) return { ok: false, reason: 'malformed_signature' };
  // Replay window: an old signature stays valid forever without this.
  if (Math.abs(now - timestamp) > timeout) return { ok: false, reason: 'stale_signature' };

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${rawBody}${timestamp}`)
    .digest();
  let provided;
  try {
    provided = Buffer.from(match[2], 'hex');
  } catch {
    return { ok: false, reason: 'malformed_signature' };
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

/** Signs a body the way Retell does - used by the tests. */
export function signWebhook(rawBody, secret = config.retell.webhookSecret, timestamp = Date.now()) {
  const digest = crypto.createHmac('sha256', secret).update(`${rawBody}${timestamp}`).digest('hex');
  return `v=${timestamp},d=${digest}`;
}

// --- Field extraction --------------------------------------------------------

// Post-call extraction fields are named by whoever built the agent, so accept
// the common English and Spanish variants rather than demanding one schema.
const ALIASES = {
  name: ['customer_name', 'client_name', 'caller_name', 'contact_name', 'full_name', 'name', 'nombre_cliente', 'nombre_completo', 'nombre', 'cliente'],
  phone: ['customer_phone', 'client_phone', 'contact_phone', 'phone_number', 'phone', 'telephone', 'mobile', 'whatsapp', 'telefono_cliente', 'telefono', 'teléfono', 'numero_telefono', 'número_de_teléfono', 'numero', 'movil', 'móvil'],
  reason: ['appointment_reason', 'urgency_reason', 'motivo_urgencia', 'reason', 'service_type', 'service', 'job', 'issue', 'problem', 'motivo_cita', 'motivo_de_la_cita', 'motivo', 'servicio', 'problema', 'razon', 'razón', 'asunto'],
  datetime: ['appointment_datetime', 'appointment_date_time', 'scheduled_at', 'datetime', 'date_time', 'fecha_hora', 'fecha_y_hora', 'fecha_cita_hora', 'cita'],
  date: ['appointment_date', 'booking_date', 'date', 'fecha_cita', 'fecha_de_la_cita', 'fecha', 'dia', 'día'],
  time: ['appointment_time', 'booking_time', 'time', 'hora_cita', 'hora_de_la_cita', 'hora'],
  vehicle: ['vehicle', 'vehicle_model', 'car', 'car_model', 'vehiculo', 'vehículo', 'coche'],
  vehicle_make: ['vehicle_make', 'make', 'marca', 'marca_vehiculo', 'marca_del_vehiculo'],
  vehicle_model: ['vehicle_model', 'model', 'modelo', 'modelo_vehiculo', 'modelo_del_vehiculo'],
  plate: ['plate', 'license_plate', 'number_plate', 'matricula', 'matrícula'],
  notes: ['notes', 'note', 'comments', 'details', 'description', 'notas', 'comentarios', 'detalles', 'observaciones'],
  email: ['customer_email', 'email', 'correo', 'correo_electronico', 'correo_electrónico'],
  transcript: ['transcript', 'transcripcion', 'transcripción', 'full_transcript', 'recording_transcript'],
  urgency: ['is_urgent', 'urgencia', 'urgent', 'emergency', 'es_urgencia', 'is_emergency', 'llamada_urgente'],
  call_kind: ['tipo_llamada', 'call_type', 'intent', 'tipo', 'category', 'categoria', 'call_category'],
};

const TRUTHY_URGENT = new Set(['1', 'true', 'yes', 'y', 'si', 'sí', 's', 'urgent', 'urgencia', 'emergency', 'urgente']);

/** True when the Retell agent marked the call as an urgency. */
export function detectUrgent(fields, { reason = null } = {}) {
  for (const alias of ALIASES.urgency) {
    const value = fields.get(normalizeKey(alias));
    if (value === undefined || value === null || value === '') continue;
    if (value === true || value === 1) return true;
    const text = String(value).trim().toLowerCase();
    if (TRUTHY_URGENT.has(text)) return true;
  }
  const kind = pick(fields, ALIASES.call_kind);
  if (kind && /urgenc|emergenc|aver[ií]a\s*urgente/i.test(kind)) return true;
  if (reason && /\burgencia\b|\bemergency\b|\burgente\b/i.test(reason)) return true;
  return false;
}

function splitVehicle(vehicleText, make, model) {
  if (make || model) {
    return { make: make || null, model: model || null };
  }
  const parts = String(vehicleText ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { make: null, model: null };
  return { make: parts[0], model: parts.slice(1).join(' ') || null };
}

const normalizeKey = (key) =>
  String(key)
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

/** Flattens the places Retell may carry structured data into one lookup map. */
export function collectFields(call = {}) {
  const sources = [
    call.call_analysis?.custom_analysis_data,
    call.custom_analysis_data,
    call.collected_dynamic_variables,
    call.retell_llm_dynamic_variables,
    call.dynamic_variables,
    call.analysis,
    call.metadata,
    call,
  ];

  const fields = new Map();
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object') continue;
      const normalized = normalizeKey(key);
      // Earlier sources win: post-call analysis beats raw call metadata.
      if (!fields.has(normalized)) fields.set(normalized, value);
    }
  }
  return fields;
}

const pick = (fields, aliases) => {
  for (const alias of aliases) {
    const value = fields.get(normalizeKey(alias));
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return null;
};

// --- Date and time parsing ---------------------------------------------------

const WEEKDAYS = {
  sunday: 0, sun: 0, domingo: 0, dom: 0,
  monday: 1, mon: 1, lunes: 1, lun: 1,
  tuesday: 2, tue: 2, tues: 2, martes: 2, mar: 2,
  wednesday: 3, wed: 3, miercoles: 3, mie: 3,
  thursday: 4, thu: 4, thurs: 4, jueves: 4, jue: 4,
  friday: 5, fri: 5, viernes: 5, vie: 5,
  saturday: 6, sat: 6, sabado: 6, sab: 6,
};

const MONTHS = {
  january: 1, jan: 1, enero: 1, ene: 1,
  february: 2, feb: 2, febrero: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, junio: 6,
  july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sep: 9, sept: 9, septiembre: 9,
  october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12,
};

const cleanText = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

const addCalendarDays = (parts, days) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

/**
 * Resolves a spoken or written date into shop-local calendar parts.
 * Handles ISO dates, D/M/Y, "12 March", "today"/"hoy", "tomorrow"/"mañana"
 * and weekday names (which always mean the *next* such day).
 */
export function parseSpokenDate(value, { timezone = 'UTC', now = new Date() } = {}) {
  const text = cleanText(value);
  if (!text) return null;

  const todayParts = parseDateOnly(zonedDateString(now, timezone));

  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

  if (/\b(today|hoy)\b/.test(text)) return todayParts;
  if (/\b(tomorrow|manana|tmr)\b/.test(text)) return addCalendarDays(todayParts, 1);
  if (/\b(day after tomorrow|pasado manana)\b/.test(text)) return addCalendarDays(todayParts, 2);

  // "12/03" or "12/03/2026" - day first, which is how both Spain and the rest
  // of Europe say it. Values above 12 in the first slot confirm the order.
  const numeric = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : todayParts.year;
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const candidate = { year, month, day };
      // A bare day/month that already passed means next year.
      if (!numeric[3] && compareParts(candidate, todayParts) < 0) candidate.year += 1;
      return candidate;
    }
  }

  // "12 march" / "march 12" / "12 de marzo"
  const monthNames = Object.keys(MONTHS).join('|');
  const dayMonth = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${monthNames})\\b`).exec(text);
  const monthDay = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})\\b`).exec(text);
  const found = dayMonth
    ? { day: Number(dayMonth[1]), month: MONTHS[dayMonth[2]] }
    : monthDay
      ? { day: Number(monthDay[2]), month: MONTHS[monthDay[1]] }
      : null;
  if (found) {
    const candidate = { year: todayParts.year, ...found };
    if (compareParts(candidate, todayParts) < 0) candidate.year += 1;
    return candidate;
  }

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
    const todayWeekday = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day)).getUTCDay();
    // "on friday" means the coming friday, never today.
    const delta = ((weekday - todayWeekday + 7) % 7) || 7;
    return addCalendarDays(todayParts, delta);
  }

  return null;
}

const compareParts = (a, b) =>
  a.year - b.year || a.month - b.month || a.day - b.day;

const PM_SUFFIX = /^\s*(pm|p\.?m\.?|de la tarde|de la noche)/;
const AM_SUFFIX = /^\s*(am|a\.?m\.?|de la manana)/;

const applyMeridiem = (hours, rest) => {
  if (PM_SUFFIX.test(rest) && hours < 12) return hours + 12;
  if (AM_SUFFIX.test(rest) && hours === 12) return 0;
  return hours;
};

/** Resolves "14:30", "9h30", "9 am", "at 4" into minutes since midnight. */
export function parseSpokenTime(value) {
  const text = cleanText(value);
  if (!text) return null;

  // An explicit clock reading wins, and `:`/`h` keep dotted dates (12.03) out.
  const clock = /(?:^|[^\d])(\d{1,2})\s*[:h]\s*(\d{2})(?!\d)/.exec(text);
  if (clock) {
    const minutes = Number(clock[2]);
    const hours = applyMeridiem(Number(clock[1]), text.slice(clock.index + clock[0].length));
    if (hours > 24 || minutes > 59) return null;
    return (hours % 24) * 60 + minutes;
  }

  // Otherwise look for a bare hour, after removing anything date-shaped so
  // "2026-08-10" or "10/08" cannot be read as a time.
  const withoutDates = text
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, ' ')
    .replace(/\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{4}\b/g, ' ');

  const bare = /(?:^|[^\d])(\d{1,2})(?!\d)/.exec(withoutDates);
  if (!bare) return null;

  const rest = withoutDates.slice(bare.index + bare[0].length);
  let hours = Number(bare[1]);
  if (hours > 24) return null;
  const explicit = PM_SUFFIX.test(rest) || AM_SUFFIX.test(rest);
  hours = applyMeridiem(hours, rest);
  // "at 4" at a garage means the afternoon, not four in the morning.
  if (!explicit && hours >= 1 && hours <= 7) hours += 12;

  return (hours % 24) * 60;
}

/**
 * Best-effort appointment instant from whatever the agent captured.
 * `precision` tells the caller how much to trust it:
 *   'datetime' - date and time were both given
 *   'date'     - only a day; the caller should pick a slot on it
 *   null       - nothing usable
 */
export function resolveAppointmentTime(fields, { timezone = 'UTC', now = new Date() } = {}) {
  const rawDateTime = pick(fields, ALIASES.datetime);
  const rawDate = pick(fields, ALIASES.date);
  const rawTime = pick(fields, ALIASES.time);

  // A full ISO instant (with zone) is unambiguous - trust it as-is.
  if (rawDateTime && /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(rawDateTime)) {
    if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(rawDateTime.trim())) {
      const parsed = new Date(rawDateTime);
      if (!Number.isNaN(parsed.getTime())) {
        return { at: parsed, precision: 'datetime', raw: rawDateTime };
      }
    }
  }

  const dateParts = parseSpokenDate(rawDate ?? rawDateTime, { timezone, now });
  const minutes = parseSpokenTime(rawTime ?? rawDateTime);

  if (dateParts && minutes !== null) {
    return {
      at: utcFromZoned({ ...dateParts, hour: Math.floor(minutes / 60), minute: minutes % 60 }, timezone),
      precision: 'datetime',
      raw: [rawDate ?? rawDateTime, rawTime].filter(Boolean).join(' '),
      local_time: minutesToTime(minutes),
    };
  }
  if (dateParts) {
    return { at: null, precision: 'date', date_parts: dateParts, raw: rawDate ?? rawDateTime };
  }
  return { at: null, precision: null, raw: rawDateTime ?? rawDate ?? rawTime ?? null };
}

/** Everything DerteApp needs out of a finished Retell call. */
export function extractBooking(call, { timezone = 'UTC', now = new Date(), defaultCountryCode = null } = {}) {
  const fields = collectFields(call);
  const inbound = call.direction !== 'outbound';
  const callerNumber = normalizeProviderPhone(inbound ? call.from_number : call.to_number);

  // Callers read out local numbers ("655 99 88 77"). The shop's country is the
  // best assumption, and the number they are calling from is the next best.
  const countryCode = defaultCountryCode || countryCodeOf(callerNumber);
  const phone = normalizePhone(pick(fields, ALIASES.phone), { defaultCountryCode: countryCode }) ?? callerNumber;
  const summary = call.call_analysis?.call_summary ?? null;
  const reason = pick(fields, ALIASES.reason);
  const vehicleText = pick(fields, ALIASES.vehicle);
  const { make, model } = splitVehicle(
    vehicleText,
    pick(fields, ALIASES.vehicle_make),
    pick(fields, ALIASES.vehicle_model),
  );
  const transcript =
    pick(fields, ALIASES.transcript) ||
    (typeof call.transcript === 'string' ? call.transcript.trim() : null) ||
    null;

  return {
    call_id: call.call_id ?? null,
    agent_id: call.agent_id ?? null,
    name: pick(fields, ALIASES.name),
    phone,
    caller_number: callerNumber,
    reason,
    vehicle: vehicleText || [make, model].filter(Boolean).join(' ') || null,
    vehicle_make: make,
    vehicle_model: model,
    plate: pick(fields, ALIASES.plate),
    email: pick(fields, ALIASES.email),
    notes: pick(fields, ALIASES.notes),
    summary,
    transcript,
    is_urgent: detectUrgent(fields, { reason }),
    time: resolveAppointmentTime(fields, { timezone, now }),
  };
}

// --- Tenant routing ----------------------------------------------------------

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/**
 * Finds the shop a call belongs to, in order of how explicit the hint is:
 * metadata → Retell agent id → the number that was dialled → a single-shop
 * install (or RETELL_DEFAULT_SHOP_ID).
 */
export async function resolveShopForCall(call = {}) {
  const metadata = call.metadata ?? {};
  const hintedId = metadata.derte_shop_id ?? metadata.shop_id ?? null;
  if (hintedId && /^[0-9a-f-]{36}$/i.test(String(hintedId))) {
    const shop = await queryOne('SELECT * FROM shops WHERE id = $1', [hintedId]);
    if (shop) return { shop, matched_by: 'metadata.shop_id' };
  }

  const publicKey = metadata.derte_public_key ?? metadata.public_key ?? null;
  if (publicKey) {
    const shop = await queryOne('SELECT * FROM shops WHERE public_key = $1', [String(publicKey)]);
    if (shop) return { shop, matched_by: 'metadata.public_key' };
  }

  if (call.agent_id) {
    const shop = await queryOne('SELECT * FROM shops WHERE retell_agent_id = $1', [String(call.agent_id)]);
    if (shop) return { shop, matched_by: 'retell_agent_id' };
  }

  // The number the customer dialled identifies the shop on inbound calls.
  const dialled = digitsOnly(call.direction === 'outbound' ? call.from_number : call.to_number);
  if (dialled) {
    const shop = await queryOne(
      `SELECT * FROM shops
        WHERE regexp_replace(COALESCE(retell_did, ''), '[^0-9]', '', 'g') = $1
           OR regexp_replace(COALESCE(zadarma_did, ''), '[^0-9]', '', 'g') = $1
        LIMIT 1`,
      [dialled],
    );
    if (shop) return { shop, matched_by: 'inbound_number' };
  }

  if (config.retell.defaultShopId) {
    const shop = await queryOne('SELECT * FROM shops WHERE id = $1', [config.retell.defaultShopId]);
    if (shop) return { shop, matched_by: 'default_shop' };
  }

  // Single-tenant installs need no routing configuration at all.
  const only = await queryOne(
    `SELECT * FROM shops WHERE status = 'active'
      AND (SELECT count(*) FROM shops WHERE status = 'active') = 1`,
  );
  if (only) return { shop: only, matched_by: 'only_active_shop' };

  return { shop: null, matched_by: null };
}

export default {
  verifyWebhook,
  signWebhook,
  collectFields,
  extractBooking,
  resolveAppointmentTime,
  parseSpokenDate,
  parseSpokenTime,
  resolveShopForCall,
};
