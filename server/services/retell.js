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
  name: [
    'customer_name',
    'client_name',
    'caller_name',
    'contact_name',
    'full_name',
    'name',
    'nombre_cliente',
    'nombre_completo',
    'nombre',
    'cliente',
  ],
  phone: [
    'customer_phone',
    'client_phone',
    'contact_phone',
    'phone_number',
    'phone',
    'telephone',
    'mobile',
    'whatsapp',
    'telefono_cliente',
    'telefono',
    'teléfono',
    'numero_telefono',
    'número_de_teléfono',
    'numero',
    'movil',
    'móvil',
  ],
  reason: [
    'appointment_reason',
    'urgency_reason',
    'motivo_urgencia',
    'motivo_de_urgencia',
    'reason',
    'service_type',
    'service',
    'job',
    'issue',
    'problem',
    'motivo_cita',
    'motivo_de_la_cita',
    'motivo',
    'servicio',
    'problema',
    'razon',
    'razón',
    'asunto',
  ],
  datetime: [
    'appointment_datetime',
    'appointment_date_time',
    'scheduled_at',
    'datetime',
    'date_time',
    'fecha_hora',
    'fecha_y_hora',
    'fecha_cita_hora',
    'cita',
  ],
  date: ['appointment_date', 'booking_date', 'date', 'fecha_cita', 'fecha_de_la_cita', 'fecha', 'dia', 'día'],
  time: ['appointment_time', 'booking_time', 'time', 'hora_cita', 'hora_de_la_cita', 'hora'],
  vehicle: [
    'vehicle',
    'vehicle_model',
    'car',
    'car_model',
    'vehiculo',
    'vehículo',
    'coche',
    'auto',
    'vehiculo_completo',
  ],
  vehicle_make: ['vehicle_make', 'make', 'marca', 'marca_vehiculo', 'marca_del_vehiculo'],
  vehicle_model: ['vehicle_model', 'model', 'modelo', 'modelo_vehiculo', 'modelo_del_vehiculo'],
  plate: [
    'plate',
    'license_plate',
    'number_plate',
    'car_plate',
    'matricula',
    'matrícula',
    'placa',
    'registration',
    'reg',
    'numero_matricula',
    'número_matrícula',
  ],
  notes: ['notes', 'note', 'comments', 'details', 'description', 'notas', 'comentarios', 'detalles', 'observaciones'],
  email: ['customer_email', 'email', 'correo', 'correo_electronico', 'correo_electrónico'],
  transcript: ['transcript', 'transcripcion', 'transcripción', 'full_transcript', 'recording_transcript'],
  urgency: ['is_urgent', 'urgencia', 'urgent', 'emergency', 'es_urgencia', 'is_emergency', 'llamada_urgente'],
  call_kind: ['tipo_llamada', 'call_type', 'intent', 'tipo', 'category', 'categoria', 'call_category'],
};

const TRUTHY_URGENT = new Set(['1', 'true', 'yes', 'y', 'si', 'sí', 's', 'urgent', 'urgencia', 'emergency', 'urgente']);

/** True when the Retell agent marked the call as an urgency. */
export function detectUrgent(fields, { reason = null } = {}) {
  const flagged = fields.get('urgency');
  const candidates = [flagged, ...ALIASES.urgency.map((alias) => fields.get(normalizeKey(alias)))];
  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue;
    if (value === true || value === 1) return true;
    const text = String(value).trim().toLowerCase();
    if (TRUTHY_URGENT.has(text)) return true;
  }
  // Conversation Flow often fills motivo_urgencia without a separate is_urgent flag.
  for (const key of ['motivo_urgencia', 'urgency_reason', 'motivo_de_urgencia']) {
    const value = fields.get(normalizeKey(key));
    if (value === undefined || value === null || value === '') continue;
    if (value === false) continue;
    const text = String(value).trim().toLowerCase();
    if (text === 'false' || text === '0' || text === 'no') continue;
    return true;
  }
  const kind = fields.get('call_kind') ?? pick(fields, ALIASES.call_kind);
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

/**
 * Flattens the places Retell may carry structured data into one lookup map.
 * Real `call_analyzed` payloads put extraction in
 * `call.call_analysis.custom_analysis_data` and/or
 * `call.retell_llm_dynamic_variables` / `collected_dynamic_variables`.
 * Conversation Flow / custom functions often put the same fields in `args`.
 */
export function collectFields(call = {}) {
  const bags = [];

  const pushBag = (source) => {
    const bag = coerceAnalysisObject(source) || (source && typeof source === 'object' && !Array.isArray(source) ? source : null);
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return;
    bags.push(bag);
    // One-level flatten: { vehicle: { marca, modelo } } or nested analysis groups.
    for (const value of Object.values(bag)) {
      const nested = coerceAnalysisObject(value);
      if (nested) {
        bags.push(nested);
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) bags.push(value);
    }
  };

  pushBag(call.call_analysis?.custom_analysis_data);
  pushBag(call.custom_analysis_data);
  pushBag(call.args);
  pushBag(call.tool_args);
  pushBag(call.function_args);
  pushBag(call.collected_dynamic_variables);
  // Input seeds only fill gaps after real analysis bags.
  pushBag(call.retell_llm_dynamic_variables);
  pushBag(call.dynamic_variables);
  pushBag(call.analysis);
  pushBag(call.metadata);
  // Some agents nest extraction under call_analysis without the custom_analysis_data key.
  pushBag(call.call_analysis);

  // Tool-call utterances from Retell transcripts may carry the same fields.
  const utterances = call.transcript_with_tool_calls || call.transcript_object;
  if (Array.isArray(utterances)) {
    for (const turn of utterances) {
      if (!turn || typeof turn !== 'object') continue;
      pushBag(turn.args);
      pushBag(turn.arguments);
      pushBag(turn.tool_call_arguments);
      if (typeof turn.arguments === 'string') {
        try {
          pushBag(JSON.parse(turn.arguments));
        } catch {
          // ignore non-JSON
        }
      }
    }
  }

  // Last: raw call scalars (from_number etc. are handled separately).
  pushBag(call);

  const fields = new Map();
  for (const source of bags) {
    for (const [key, value] of Object.entries(source)) {
      const scalar = unwrapAnalysisScalar(value);
      if (scalar === null || scalar === undefined || scalar === '') {
        if (value === null || value === undefined || value === '') continue;
        if (typeof value === 'object') continue;
      }
      const stored = scalar ?? value;
      if (stored === null || stored === undefined || stored === '') continue;
      if (typeof stored === 'object') continue;
      const normalized = normalizeKey(key);
      if (!fields.has(normalized)) fields.set(normalized, stored);
      for (const [group, aliases] of Object.entries(ALIASES)) {
        if (!aliases.some((alias) => normalizeKey(alias) === normalized)) continue;
        if (!fields.has(group)) fields.set(group, stored);
        break;
      }
    }
  }
  return fields;
}

/** Plain-text transcript from string or Retell utterance arrays. */
export function extractTranscript(call = {}) {
  if (typeof call.transcript === 'string' && call.transcript.trim()) {
    return call.transcript.trim().slice(0, 8000);
  }
  const fromFields = pick(collectFields(call), ALIASES.transcript);
  if (fromFields) return fromFields.slice(0, 8000);

  const utterances = call.transcript_object || call.transcript_with_tool_calls;
  if (!Array.isArray(utterances) || !utterances.length) return null;

  const lines = [];
  for (const turn of utterances) {
    if (!turn || typeof turn !== 'object') continue;
    // Skip tool-call rows that have no spoken content.
    if (turn.role === 'tool_call_invocation' || turn.role === 'tool_call_result') continue;
    const content = String(turn.content ?? turn.text ?? '').trim();
    if (!content) continue;
    const role = String(turn.role ?? turn.speaker ?? '').trim();
    lines.push(role ? `${role}: ${content}` : content);
  }
  const text = lines.join('\n').trim();
  return text ? text.slice(0, 8000) : null;
}

const pick = (fields, aliases) => {
  // Canonical group key first (set by the highest-priority Retell bag).
  for (const [group, groupAliases] of Object.entries(ALIASES)) {
    if (groupAliases !== aliases) continue;
    const canonical = fields.get(group);
    if (canonical !== undefined && String(canonical).trim() !== '') {
      return String(canonical).trim();
    }
  }
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

/**
 * Coerce Retell analysis bags that sometimes arrive as JSON strings.
 * Empty objects/arrays become null so callers can keep searching.
 */
export function coerceAnalysisObject(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return coerceAnalysisObject(parsed);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).length ? value : null;
}

/**
 * Retell sometimes wraps extracted scalars as `{ value }`, `{ answer }`, etc.
 * Also accepts plain strings/numbers/booleans.
 */
export function unwrapAnalysisScalar(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text === '' ? null : text;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const unwrapped = unwrapAnalysisScalar(item);
      if (unwrapped) return unwrapped;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  for (const key of ['value', 'answer', 'text', 'result', 'content', 'data', 'output']) {
    if (key in value) {
      const unwrapped = unwrapAnalysisScalar(value[key]);
      if (unwrapped) return unwrapped;
    }
  }
  return null;
}

/**
 * Flatten a bag into key → scalar, including one-level nested objects and
 * array-of-{name,value} shapes Retell occasionally emits.
 */
function flattenAnalysisBag(bag, into = {}) {
  const object = coerceAnalysisObject(bag);
  if (!object) return into;

  for (const [key, value] of Object.entries(object)) {
    const scalar = unwrapAnalysisScalar(value);
    if (scalar != null) {
      if (!(key in into) || into[key] == null || into[key] === '') into[key] = scalar;
      continue;
    }
    const nested = coerceAnalysisObject(value);
    if (nested) flattenAnalysisBag(nested, into);
  }

  // Array forms: [{ name: 'nombre', value: 'Ana' }, ...]
  if (Array.isArray(bag)) {
    for (const item of bag) {
      if (!item || typeof item !== 'object') continue;
      const key = item.name ?? item.key ?? item.field ?? item.id;
      const scalar = unwrapAnalysisScalar(item.value ?? item.answer ?? item.text ?? item);
      if (key && scalar != null && (!(key in into) || !into[key])) into[key] = scalar;
    }
  }
  return into;
}

/**
 * Merge custom_analysis_data from every nesting Retell / webhook wrappers use.
 *
 *   const callData = req.body?.call || req.body;
 *   analysis ← callData.custom_analysis_data
 *            ← callData.call_analysis.custom_analysis_data
 *            ← req.body.custom_analysis_data
 *            ← collected vars / args …
 *
 * Later non-empty sources fill missing keys (never blocked by `{}`).
 * Note: retell_llm_dynamic_variables are INPUT hints — merged last so they
 * never override post-call custom_analysis_data.
 */
export function mergeCustomAnalysisData(call = {}, body = null) {
  const callData = call && typeof call === 'object' ? call : {};
  const root = body && typeof body === 'object' ? body : null;
  const envelope =
    root?.data && typeof root.data === 'object' ? { ...root, ...root.data } : root;

  // Highest priority first: real post-call analysis, then collected/args.
  // Do NOT merge retell_llm_dynamic_variables here — those are INPUT seeds and
  // would make call_ended look "analyzed" before custom_analysis_data arrives.
  const candidates = [
    callData.call_analysis?.custom_analysis_data,
    callData.custom_analysis_data,
    callData.analysis?.custom_analysis_data,
    envelope?.call?.call_analysis?.custom_analysis_data,
    envelope?.call?.custom_analysis_data,
    envelope?.call_analysis?.custom_analysis_data,
    envelope?.custom_analysis_data,
    root?.call_analysis?.custom_analysis_data,
    root?.custom_analysis_data,
    callData.args,
    callData.tool_args,
    callData.function_args,
    callData.collected_dynamic_variables,
    envelope?.args,
  ];

  const merged = {};
  for (const candidate of candidates) {
    flattenAnalysisBag(candidate, merged);
  }
  return merged;
}

/** @deprecated use mergeCustomAnalysisData — kept for existing imports/tests */
export function extractCustomAnalysisData(call = {}) {
  return mergeCustomAnalysisData(call);
}

/**
 * Case/accent-insensitive lookup across analysis keys (ES/EN aliases).
 * Returns trimmed string or null.
 */
export function pickAnalysisValue(analysisData, aliases) {
  if (!analysisData || typeof analysisData !== 'object') return null;
  const entries = Object.entries(analysisData).map(([key, value]) => [
    normalizeKey(key),
    unwrapAnalysisScalar(value) ?? value,
  ]);
  for (const alias of aliases) {
    const want = normalizeKey(alias);
    for (const [key, value] of entries) {
      if (key !== want) continue;
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object') continue;
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return null;
}

/**
 * Literal ES/EN mapping requested for Urgencias columns.
 * Defaults match the product copy when Retell omitted the field.
 */
export function mapUrgenciaFieldsFromAnalysis(analysisData = {}) {
  const customerName =
    pickAnalysisValue(analysisData, [
      'nombre',
      'nombre_cliente',
      'nombre_completo',
      'name',
      'customer_name',
    ]) || 'Sin nombre';
  const vehicleModel =
    pickAnalysisValue(analysisData, ['vehiculo', 'vehículo', 'vehicle', 'car', 'coche', 'modelo', 'model']) ||
    null;
  const licensePlate =
    pickAnalysisValue(analysisData, [
      'matricula',
      'matrícula',
      'plate',
      'license_plate',
      'car_plate',
      'placa',
      'registration',
    ]) || 'Sin matrícula';
  const reasonUrgency =
    pickAnalysisValue(analysisData, [
      'motivo',
      'motivo_urgencia',
      'motivo_de_urgencia',
      'motivo_cita',
      'reason',
      'urgency_reason',
    ]) || 'Consulta urgente';

  return { customerName, vehicleModel, licensePlate, reasonUrgency };
}

/** True when a bag contains at least one known extraction alias (not just system vars). */
export function bagHasExtractionFields(bag) {
  const flat = flattenAnalysisBag(bag, {});
  if (!Object.keys(flat).length) return false;
  const extractionAliases = [
    ...ALIASES.name,
    ...ALIASES.reason,
    ...ALIASES.vehicle,
    ...ALIASES.vehicle_make,
    ...ALIASES.vehicle_model,
    ...ALIASES.plate,
    'urgency_reason',
  ];
  const wanted = new Set(extractionAliases.map((alias) => normalizeKey(alias)));
  return Object.keys(flat).some((key) => wanted.has(normalizeKey(key)));
}

/** Everything DerteApp needs out of a finished Retell call. */
export function extractBooking(call, { timezone = 'UTC', now = new Date(), defaultCountryCode = null, body = null } = {}) {
  const analysis = mergeCustomAnalysisData(call, body);
  // Ensure collectFields also sees the merged bag (highest priority).
  const callWithAnalysis = {
    ...call,
    custom_analysis_data: {
      ...analysis,
      ...(coerceAnalysisObject(call.custom_analysis_data) || {}),
    },
    call_analysis: {
      ...(typeof call.call_analysis === 'object' && call.call_analysis ? call.call_analysis : {}),
      custom_analysis_data: {
        ...analysis,
        ...(coerceAnalysisObject(call.call_analysis?.custom_analysis_data) || {}),
      },
    },
  };
  const fields = collectFields(callWithAnalysis);
  const inbound = call.direction !== 'outbound';
  const rawCli = inbound
    ? call.from_number || call.user_number || call.caller_number || call.customer_number
    : call.to_number || call.user_number;
  const callerNumber = normalizeProviderPhone(rawCli) ?? (rawCli ? String(rawCli).trim() : null);

  // Callers read out local numbers ("655 99 88 77"). The shop's country is the
  // best assumption, and the number they are calling from is the next best.
  const countryCode = defaultCountryCode || countryCodeOf(callerNumber);
  const extractedPhone = normalizePhone(pick(fields, ALIASES.phone), { defaultCountryCode: countryCode });
  // Prefer extracted contact phone; fall back to the calling CLI (from_number).
  const phone = extractedPhone || callerNumber;
  const summaryRaw =
    call.call_analysis?.call_summary ??
    pick(fields, ['call_summary', 'summary', 'resumen', 'resumen_llamada']) ??
    null;

  // Prefer collectFields (custom_analysis bags first) so LLM dynamic vars
  // like customer_name cannot override nombre_cliente from post-call analysis.
  const transcript = extractTranscript(callWithAnalysis);
  let name =
    pick(fields, ALIASES.name) ||
    pickAnalysisValue(analysis, ['nombre', 'nombre_cliente', 'nombre_completo', 'name', 'customer_name']) ||
    extractNameFromSummary(summaryRaw) ||
    extractNameFromTranscript(transcript) ||
    null;
  if (isBlankOrPlaceholderCustomerName(name)) {
    name = extractNameFromTranscript(transcript) || null;
  }
  let reason =
    pick(fields, ALIASES.reason) ||
    pickAnalysisValue(analysis, [
      'motivo',
      'motivo_urgencia',
      'motivo_de_urgencia',
      'motivo_cita',
      'reason',
      'urgency_reason',
    ]) ||
    null;
  if (isGenericUrgenciaReason(reason)) {
    reason = extractReasonFromTranscript(transcript) || reason;
  }
  const vehicleText =
    pick(fields, ALIASES.vehicle) ||
    pickAnalysisValue(analysis, ['vehiculo', 'vehículo', 'vehicle', 'car', 'coche']) ||
    null;
  let plate =
    pick(fields, ALIASES.plate) ||
    pickAnalysisValue(analysis, [
      'matricula',
      'matrícula',
      'plate',
      'license_plate',
      'car_plate',
      'placa',
      'registration',
    ]) ||
    null;
  if (!plate) {
    plate = extractSpanishPlateFromText(transcript);
  }
  const makeFromAnalysis =
    pick(fields, ALIASES.vehicle_make) ||
    pickAnalysisValue(analysis, ['marca', 'make', 'vehicle_make', 'marca_vehiculo']) ||
    null;
  const modelFromAnalysis =
    pick(fields, ALIASES.vehicle_model) ||
    pickAnalysisValue(analysis, ['modelo', 'model', 'modelo_vehiculo']) ||
    null;
  const { make, model } = splitVehicle(vehicleText, makeFromAnalysis, modelFromAnalysis);
  // Prefer the full vehicle string Retell sends (vehiculo/vehicle/car) for display/storage.
  let vehicleLabel = vehicleText || [makeFromAnalysis || make, modelFromAnalysis || model].filter(Boolean).join(' ') || null;
  // Brand-only enrichment from transcript (Toyota → Toyota Yaris) happens in
  // extractCallAnalyzedFields / intake; here keep analysis label as-is.
  const vehicleMake = makeFromAnalysis || (vehicleText ? null : make);
  const vehicleModel =
    vehicleText || modelFromAnalysis || model || null;
  const summary = buildSpanishUrgenciaSummary({
    name,
    vehicle: vehicleLabel,
    reason,
    summary: summaryRaw,
  });

  const booking = {
    call_id: call.call_id ?? null,
    agent_id: call.agent_id ?? null,
    name,
    phone,
    caller_number: callerNumber,
    reason,
    vehicle: vehicleLabel,
    vehicle_make: vehicleMake,
    vehicle_model: vehicleModel,
    plate,
    email: pick(fields, ALIASES.email),
    notes: pick(fields, ALIASES.notes),
    summary,
    transcript,
    is_urgent: detectUrgent(fields, { reason }),
    // Merged bag for debugging / Urgencias.raw persistence (never truncated keys).
    custom_analysis_data: Object.keys(analysis).length ? analysis : null,
    args: call.args ?? null,
    retell_llm_dynamic_variables: call.retell_llm_dynamic_variables ?? null,
    collected_dynamic_variables: call.collected_dynamic_variables ?? null,
    time: resolveAppointmentTime(fields, { timezone, now }),
  };

  console.log('[retell] extractBooking fields', {
    call_id: booking.call_id,
    name: booking.name,
    phone: booking.phone,
    vehicle: booking.vehicle,
    vehicle_make: booking.vehicle_make,
    vehicle_model: booking.vehicle_model,
    plate: booking.plate,
    reason: booking.reason,
    is_urgent: booking.is_urgent,
    analysis_keys: Object.keys(analysis || {}),
  });

  return booking;
}

const LEAD_SHOP_ALIASES = [
  'nombre_taller',
  'taller',
  'nombre_del_taller',
  'shop_name',
  'workshop_name',
  'garage_name',
  'nombre_negocio',
];

const LEAD_ISLAND_ALIASES = [
  'isla',
  'island',
  'islas',
  'isla_canaria',
  'canary_island',
  'provincia',
  'island_name',
];

const CANARY_ISLANDS = [
  ['gran canaria', 'Gran Canaria'],
  ['las palmas', 'Gran Canaria'],
  ['tenerife', 'Tenerife'],
  ['santa cruz', 'Tenerife'],
  ['lanzarote', 'Lanzarote'],
  ['fuerteventura', 'Fuerteventura'],
  ['la palma', 'La Palma'],
  ['la gomera', 'La Gomera'],
  ['el hierro', 'El Hierro'],
  ['la graciosa', 'La Graciosa'],
];

/** Canonical Canary island name, or the trimmed original. */
export function normalizeIsland(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const folded = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  for (const [needle, label] of CANARY_ISLANDS) {
    if (folded.includes(needle)) return label;
  }
  return text;
}

const PLATFORM_LEAD_KINDS = new Set([
  'lead',
  'leads',
  'cliente',
  'clientes',
  'platform',
  'sales',
  'captacion',
  'captación',
  'derteapp',
]);

/**
 * Structured fields the platform receptionist collects for Super Admin CLIENTES.
 */
export function extractPlatformLead(call, { body = null } = {}) {
  const booking = extractBooking(call, { timezone: 'Atlantic/Canary', now: new Date(), body });
  const analysis = mergeCustomAnalysisData(call, body);
  const shopName =
    pickAnalysisValue(analysis, LEAD_SHOP_ALIASES) ||
    pick(collectFields({ ...call, custom_analysis_data: analysis }), LEAD_SHOP_ALIASES) ||
    null;
  let island =
    normalizeIsland(pickAnalysisValue(analysis, LEAD_ISLAND_ALIASES)) ||
    normalizeIsland(pick(collectFields({ ...call, custom_analysis_data: analysis }), LEAD_ISLAND_ALIASES));
  if (!island && booking.transcript) island = normalizeIsland(booking.transcript);
  if (!island && call.call_analysis?.call_summary) island = normalizeIsland(call.call_analysis.call_summary);
  if (!island && booking.summary) island = normalizeIsland(booking.summary);

  return {
    call_id: booking.call_id,
    agent_id: booking.agent_id,
    customer_name: isBlankOrPlaceholderCustomerName(booking.name) ? null : booking.name,
    customer_phone: booking.phone ?? booking.caller_number ?? null,
    customer_email: booking.email ?? null,
    shop_name: shopName ? String(shopName).trim() : null,
    island,
    summary: booking.summary ?? null,
    notes: booking.notes ?? null,
    vehicle: booking.vehicle ?? null,
    plate: booking.plate ?? null,
  };
}

/**
 * True when this Retell call is a DerteApp sales lead, not a shop Urgencia.
 * Explicit agent / DID / metadata win; otherwise isla + nombre_taller (and no
 * vehicle) is enough even if a shop DID was also matched.
 */
export function isPlatformLeadCall(call = {}, lead = {}, { shopMatched = false } = {}) {
  const agent = String(call.agent_id ?? '').trim();
  if (config.retell.platformAgentId && agent && agent === config.retell.platformAgentId) {
    return true;
  }
  const dialled = digitsOnly(call.to_number || call.telephony_identifier || '');
  if (config.retell.platformDid && dialled && dialled === digitsOnly(config.retell.platformDid)) {
    return true;
  }
  const metadata = call.metadata && typeof call.metadata === 'object' ? call.metadata : {};
  const kind = String(metadata.purpose ?? metadata.kind ?? metadata.intent ?? metadata.destination ?? '')
    .trim()
    .toLowerCase();
  if (PLATFORM_LEAD_KINDS.has(kind)) return true;

  const hasLeadShape = Boolean(lead.shop_name && lead.island);
  const hasWorkshopShape = Boolean(lead.vehicle || lead.plate);
  if (hasLeadShape && !hasWorkshopShape) return true;
  if (!shopMatched && (lead.shop_name || lead.island)) return true;
  return false;
}

// --- Tenant routing ----------------------------------------------------------

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/** Production Melian inbound DID used by the Retell agent. */
export const RETELL_MELIAN_DID = '+34828643107';

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

  // Inbound number the customer dialled → shops.retell_did (alias: retell_inbound_number)
  // or shops.zadarma_did. Includes Melian production DID +34828643107.
  const dialledCandidates = [
    call.direction === 'outbound' ? call.from_number : call.to_number,
    call.to_number,
    metadata.retell_did,
    metadata.retell_inbound_number,
    metadata.to_number,
    RETELL_MELIAN_DID,
  ];
  const seen = new Set();
  for (const candidate of dialledCandidates) {
    const dialled = digitsOnly(candidate);
    if (!dialled || seen.has(dialled)) continue;
    seen.add(dialled);
    const shop = await queryOne(
      `SELECT * FROM shops
        WHERE regexp_replace(COALESCE(retell_did, ''), '[^0-9]', '', 'g') = $1
           OR regexp_replace(COALESCE(zadarma_did, ''), '[^0-9]', '', 'g') = $1
        LIMIT 1`,
      [dialled],
    );
    if (shop) {
      return {
        shop,
        matched_by: dialled === digitsOnly(RETELL_MELIAN_DID) ? 'melian_did' : 'inbound_number',
      };
    }
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

const NAME_TOKEN = `[A-ZÁÉÍÓÚÜÑ][\\p{L}.'-]*(?:\\s+[A-ZÁÉÍÓÚÜÑ][\\p{L}.'-]*){0,3}`;

/**
 * Pull a person name from Retell call_summary when analysis.nombre/name is empty.
 * Examples:
 * - "Juan Diego called Talleres…"
 * - "Juan Diego llamó a Talleres…"
 * - "The user, José Manuel, llamó…"
 */
export function extractNameFromSummary(summary) {
  if (!summary || typeof summary !== 'string') return null;
  const text = summary.trim();
  if (!text) return null;

  const patterns = [
    new RegExp(
      `(?:the\\s+)?(?:user|caller|customer|cliente|usuario)\\s*,\\s*(${NAME_TOKEN})\\s*,`,
      'iu',
    ),
    new RegExp(
      `(?:the\\s+)?(?:user|caller|customer|cliente|usuario)\\s+(${NAME_TOKEN})\\s+(?:called|llam[oó])`,
      'iu',
    ),
    new RegExp(`^(${NAME_TOKEN})\\s+called(?:\\s|$|[.,;:!??])`, 'iu'),
    new RegExp(`^(${NAME_TOKEN})\\s+llam[oó](?:\\s|$|[.,;:!??])`, 'iu'),
    new RegExp(
      `(?:caller|cliente|customer|usuario)\\s+(?:is|was|es|:)\\s*(${NAME_TOKEN})(?:\\s|$|[.,;:!??])`,
      'iu',
    ),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = String(match[1]).replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (/^(caller|cliente|customer|user|usuario)$/i.test(name)) continue;
    if (name.length < 2 || name.length > 80) continue;
    return name;
  }
  return null;
}

/**
 * Name from spoken transcript: "me llamo…", "soy…", "mi nombre es…".
 * Note: name tokens stay case-sensitive so lowercase "y/and" do not join the name.
 */
export function extractNameFromTranscript(text) {
  if (!text || typeof text !== 'string') return null;
  // No '.' in the token class — periods end the name ("Carmen López. Tengo…").
  // Only horizontal space between name parts so "Ana Pérez\nAgent" does not join.
  const nameToken = `[A-ZÁÉÍÓÚÜÑ][\\p{L}'-]*(?:[ \\t]+[A-ZÁÉÍÓÚÜÑ][\\p{L}'-]*){0,3}`;
  const stop = new Set([
    'de',
    'del',
    'la',
    'el',
    'un',
    'una',
    'the',
    'el cliente',
    'cliente',
    'usuario',
    'caller',
    'user',
    'agent',
  ]);
  const patterns = [
    new RegExp(`(?:[Mm]e\\s+llamo|[Mm]i\\s+nombre\\s+es|[Mm]e\\s+llaman)[ \\t]+(${nameToken})`, 'u'),
    new RegExp(`(?:^|[\\n:.!?]|User\\s*:)\\s*[Ss]oy[ \\t]+(${nameToken})(?:\\s|$|[.,;:!??])`, 'mu'),
    new RegExp(`(?:[Mm]y\\s+name\\s+is|[Ii](?:'m|\\s+am))[ \\t]+(${nameToken})`, 'u'),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    let name = String(match[1]).replace(/[ \t]+/g, ' ').trim();
    // Cut trailing conjunction leftovers if any slipped through.
    name = name.replace(/\s+\b(y|e|and|or|o|de|del|con|para|por|tengo|tiene|agent|user)\b.*$/i, '').trim();
    name = name.replace(/[.,;:!?]+$/g, '').trim();
    if (!name || name.length < 2 || name.length > 80) continue;
    const lower = name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    if (stop.has(lower)) continue;
    if (/^(de|del|el|la|un|una|the|agent|user)\b/i.test(name)) continue;
    return name;
  }
  return null;
}

/** Modern Spanish plate: 4 digits + 3 consonants (no AEIOU/Q). */
export function extractSpanishPlateFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/\b(\d{4})\s*([B-DF-HJ-NP-TV-Z]{3})\b/i);
  if (!match) return null;
  return `${match[1]}${match[2].toUpperCase()}`;
}

/** True for empty / default Motivo placeholders from analysis. */
export function isGenericUrgenciaReason(reason) {
  const text = String(reason ?? '').trim();
  if (!text) return true;
  return /^(consulta urgente|consulta sobre aver[ií]a|no especificado|urgency|urgent consultation|breakdown|aver[ií]a)$/i.test(
    text,
  );
}

function cleanReasonPhrase(raw) {
  let text = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^(que|es que|pues|bueno|eh|este)\s+/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
  if (!text) return null;
  // Drop agent/role leftovers.
  text = text.replace(/\b(agent|user|assistant)\b.*$/i, '').trim();
  if (text.length < 4 || text.length > 120) return null;
  // Capitalize first letter for display.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Extract a real breakdown / urgency reason from transcript text when analysis.motivo is generic.
 * 1) Prefer the user turn right after the agent asks about motivo / avería.
 * 2) Fall back to known Spanish breakdown phrases.
 */
export function extractReasonFromTranscript(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const agentAskRe =
    /(?:motivo|aver[ií]a|qu[eé]\s+(?:es\s+)?(?:el\s+)?problema|qu[eé]\s+(?:le\s+)?pasa|what(?:'s|\s+is)\s+(?:the\s+)?(?:problem|issue|reason)|what\s+happened)/i;

  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    const isAgent = /^(agent|assistant)\s*:/i.test(line);
    if (!isAgent) continue;
    const agentText = line.replace(/^(agent|assistant)\s*:\s*/i, '');
    if (!agentAskRe.test(agentText)) continue;

    // Next non-empty user turn is the motivo answer.
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (/^(agent|assistant)\s*:/i.test(next)) continue;
      const userText = next.replace(/^(user|caller|cliente)\s*:\s*/i, '').trim();
      if (!userText) continue;
      // Prefer a known phrase inside the answer; else clean the whole reply.
      const fromKnown = matchKnownReasonPhrase(userText);
      if (fromKnown) return fromKnown;
      const cleaned = cleanReasonPhrase(userText);
      if (cleaned && !isGenericUrgenciaReason(cleaned)) return cleaned;
      break;
    }
  }

  const userOnly = lines
    .filter((line) => !/^(agent|assistant)\s*:/i.test(line))
    .map((line) => line.replace(/^(user|caller|cliente)\s*:\s*/i, ''))
    .join(' ');
  const haystack = (userOnly || text).replace(/\s+/g, ' ').trim();
  if (!haystack) return null;

  const fromKnown = matchKnownReasonPhrase(haystack);
  if (fromKnown) return fromKnown;

  const capture = haystack.match(
    /(?:porque|debido a que|debido a|el problema es(?: que)?|lo que pasa es que|pasa que)\s+([^.!?\n]{6,90})/i,
  );
  if (capture?.[1]) {
    const cleaned = cleanReasonPhrase(capture[1]);
    if (cleaned && !isGenericUrgenciaReason(cleaned)) return cleaned;
  }

  return null;
}

function matchKnownReasonPhrase(haystack) {
  const known = [
    { re: /no\s+me\s+arranca(?:\s+el\s+coche)?/i, label: 'No me arranca el coche' },
    { re: /(?:el\s+coche\s+)?no\s+arranca/i, label: 'No arranca' },
    { re: /tengo\s+los\s+frenos\s+rotos/i, label: 'Tengo los frenos rotos' },
    { re: /frenos?\s+rotos?/i, label: 'Frenos rotos' },
    { re: /problema\s+con\s+(?:los\s+)?frenos/i, label: 'Problema con los frenos' },
    { re: /no\s+frena/i, label: 'No frena' },
    { re: /pierde\s+aceite/i, label: 'Pierde aceite' },
    { re: /fuga\s+de\s+aceite/i, label: 'Fuga de aceite' },
    { re: /se\s+encendi[oó]\s+el\s+testigo(?:\s+de\s+(?:el\s+)?motor)?/i, label: 'Se encendió el testigo de motor' },
    { re: /testigo\s+(?:del?\s+)?motor/i, label: 'Testigo de motor' },
    { re: /necesito\s+(?:un\s+)?cambio\s+de\s+ruedas/i, label: 'Necesito un cambio de ruedas' },
    { re: /cambio\s+de\s+(?:ruedas|neum[aá]ticos)/i, label: 'Cambio de ruedas' },
    { re: /pinchazo/i, label: 'Pinchazo' },
    { re: /bater[ií]a\s+(?:descargada|muerta|agotada)/i, label: 'Batería descargada' },
    { re: /ruido\s+(?:en\s+)?(?:el\s+)?motor/i, label: 'Ruido en el motor' },
    { re: /humos?\s+(?:en\s+|del?\s+)?(?:el\s+)?motor/i, label: 'Humos en el motor' },
    { re: /sobrecalentamiento/i, label: 'Sobrecalentamiento' },
    { re: /aire\s+acondicionado/i, label: 'Problema de aire acondicionado' },
    { re: /no\s+enciende/i, label: 'No enciende' },
    { re: /se\s+(?:me\s+)?ha\s+parado(?:\s+el\s+coche)?/i, label: 'Se ha parado el coche' },
    { re: /won'?t\s+start/i, label: 'No arranca' },
    { re: /flat\s+tire/i, label: 'Pinchazo' },
    { re: /engine\s+noise/i, label: 'Ruido en el motor' },
    { re: /brake(?:s)?\s+(?:problem|issue|broken|failing)?/i, label: 'Problema con los frenos' },
  ];

  for (const { re, label } of known) {
    if (re.test(haystack)) return label;
  }
  return null;
}

const ENGLISH_SUMMARY_MARKERS =
  /\b(called|the user|caller|customer|request(?:ed|s)?|appointment|booking|due to|because|vehicle|engine|flat tire|breakdown|workshop|garage|would like|wants to|brakes|coche make|make)\b/i;

const SPANISH_SUMMARY_MARKERS =
  /\b(llamó|solicit[óo]|debido|urgencia|taller|vehículo|matrícula|asistencia|cliente|atención|avería)\b/i;

export function looksEnglishSummary(summary) {
  if (!summary || typeof summary !== 'string') return false;
  const text = summary.trim();
  if (!text) return false;
  if (ENGLISH_SUMMARY_MARKERS.test(text)) return true;
  // Latin letters with no Spanish markers → treat as English to force rewrite.
  return /[A-Za-z]/.test(text) && !SPANISH_SUMMARY_MARKERS.test(text);
}

/** True when name is empty / Retell placeholder ("The user", "Sin nombre", …). */
export function isBlankOrPlaceholderCustomerName(name) {
  const text = String(name ?? '').trim();
  if (!text) return true;
  if (/^sin nombre$/i.test(text)) return true;
  if (/^cliente por confirmar$/i.test(text)) return true;
  if (/^llamada telef[oó]nica$/i.test(text)) return true;
  if (/^(the\s+)?user$/i.test(text)) return true;
  if (/^the$/i.test(text)) return true;
  if (/^the user\b/i.test(text) && !/,/.test(text)) return true;
  if (/^caller(\s*\+?\d.*)?$/i.test(text)) return true;
  if (/^unknown(\s+caller)?$/i.test(text)) return true;
  if (/^cliente$/i.test(text)) return true;
  return false;
}

export function formatUrgenciaCustomerDisplayName(name, { fallback = 'Cliente por confirmar' } = {}) {
  if (isBlankOrPlaceholderCustomerName(name)) return fallback;
  return String(name).replace(/\s+/g, ' ').trim();
}

/**
 * Build a Spanish motivo/summary from extracted fields, or translate the Retell text.
 * Preferred shape (no embedded name — avoids "El cliente El cliente…"):
 * "El cliente solicitó atención urgente para su vehículo (X). Motivo: Y."
 */
export function buildSpanishUrgenciaSummary({ name = null, vehicle = null, reason = null, summary = null } = {}) {
  const cleanVehicle =
    vehicle && typeof vehicle === 'string' && vehicle.trim() && vehicle.trim() !== 'Sin vehículo'
      ? vehicle.trim()
      : null;
  const cleanReason =
    reason && typeof reason === 'string' && !isGenericUrgenciaReason(reason)
      ? reason.trim()
      : null;

  // Prefer structured Spanish when we have vehicle/reason, or when Retell text is English/Spanglish.
  if (cleanVehicle || cleanReason || looksEnglishSummary(summary) || !summary || /El cliente\s+El cliente/i.test(String(summary || ''))) {
    const veh = cleanVehicle || 'No especificado';
    const motivo = cleanReason || 'No especificado';
    return `El cliente solicitó atención urgente para su vehículo (${veh}). Motivo: ${motivo}.`;
  }

  // Strip accidental duplicated "El cliente" prefixes from stored text.
  let cleaned = translateRetellSummaryToSpanish(String(summary)) || String(summary).trim() || null;
  if (cleaned) {
    cleaned = cleaned.replace(/^(El cliente\s+)+/i, 'El cliente ').trim();
  }
  return cleaned;
}

/**
 * Display-safe Spanish summary for Urgencias cards (rewrites English/Spanglish).
 */
export function formatUrgenciaDisplaySummary({ vehicle = null, reason = null, summary = null } = {}) {
  if (
    !summary ||
    looksEnglishSummary(summary) ||
    /\b(the user|brakes|coche make)\b/i.test(String(summary)) ||
    /El cliente\s+El cliente/i.test(String(summary)) ||
    /El cliente .+ llamó solicitando/i.test(String(summary)) ||
    /El cliente llamó solicitando/i.test(String(summary))
  ) {
    return buildSpanishUrgenciaSummary({ vehicle, reason, summary, name: null });
  }
  return String(summary).trim().replace(/^(El cliente\s+)+/i, 'El cliente ');
}

/**
 * Lightweight EN→ES phrasing for Retell call summaries before storage/display.
 */
export function translateRetellSummaryToSpanish(summary) {
  if (!summary || typeof summary !== 'string') return summary ?? null;
  let text = summary.trim();
  if (!text) return text;

  // Already Spanish-dominant and no English markers — keep as-is.
  if (SPANISH_SUMMARY_MARKERS.test(text) && !looksEnglishSummary(text)) {
    return text;
  }

  const replacements = [
    [/\bThe user,\s*/gi, 'El cliente '],
    [/\bthe user,\s*/gi, 'el cliente '],
    [/\bThe caller,\s*/gi, 'El cliente '],
    [/\bthe caller,\s*/gi, 'el cliente '],
    [/\bThe customer,\s*/gi, 'El cliente '],
    [/\bthe customer,\s*/gi, 'el cliente '],
    [/\bThe user\b/gi, 'El cliente'],
    [/\bthe user\b/gi, 'el cliente'],
    [/\bcalled\b/gi, 'llamó'],
    [/\bto request an urgent appointment\b/gi, 'para solicitar una cita urgente'],
    [/\bto request a booking\b/gi, 'para solicitar una reserva'],
    [/\bto request an appointment\b/gi, 'para solicitar una cita'],
    [/\brequested an urgent appointment\b/gi, 'solicitó una cita urgente'],
    [/\brequested an appointment\b/gi, 'solicitó una cita'],
    [/\ban urgent appointment\b/gi, 'una cita urgente'],
    [/\ban appointment\b/gi, 'una cita'],
    [/\ba booking\b/gi, 'una reserva'],
    [/\bdue to\b/gi, 'debido a'],
    [/\bbecause of\b/gi, 'debido a'],
    [/\bbecause\b/gi, 'porque'],
    [/\bwants to book\b/gi, 'quiere reservar'],
    [/\bwould like to\b/gi, 'quisiera'],
    [/\bscheduled\b/gi, 'programó'],
    [/\bthe vehicle\b/gi, 'el vehículo'],
    [/\bvehicle\b/gi, 'vehículo'],
    [/\bcar\b/gi, 'coche'],
    [/\bbreakdown\b/gi, 'avería'],
    [/\bflat tire\b/gi, 'pinchazo'],
    [/\bwon'?t start\b/gi, 'no arranca'],
    [/\bdoes not start\b/gi, 'no arranca'],
    [/\bengine noise\b/gi, 'ruido en el motor'],
    [/\bengine\b/gi, 'motor'],
    [/\bbattery\b/gi, 'batería'],
    [/\bworkshop\b/gi, 'taller'],
    [/\bgarage\b/gi, 'taller'],
    [/\bfor help\b/gi, 'para pedir ayuda'],
    [/\bwith\b/gi, 'con'],
    [/\band\b/gi, 'y'],
    [/\babout\b/gi, 'sobre'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
}

export default {
  verifyWebhook,
  signWebhook,
  collectFields,
  coerceAnalysisObject,
  unwrapAnalysisScalar,
  mergeCustomAnalysisData,
  extractCustomAnalysisData,
  pickAnalysisValue,
  mapUrgenciaFieldsFromAnalysis,
  bagHasExtractionFields,
  extractBooking,
  extractPlatformLead,
  isPlatformLeadCall,
  normalizeIsland,
  extractNameFromSummary,
  extractNameFromTranscript,
  extractReasonFromTranscript,
  extractSpanishPlateFromText,
  isBlankOrPlaceholderCustomerName,
  isGenericUrgenciaReason,
  formatUrgenciaCustomerDisplayName,
  formatUrgenciaDisplaySummary,
  looksEnglishSummary,
  buildSpanishUrgenciaSummary,
  translateRetellSummaryToSpanish,
  resolveAppointmentTime,
  parseSpokenDate,
  parseSpokenTime,
  resolveShopForCall,
};
