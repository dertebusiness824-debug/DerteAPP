/**
 * Timezone helpers built on Intl so DerteApp can run one server for shops in
 * different countries without pulling in a date library.
 * Convention: a "zoned datetime" is the wall clock the shop sees; everything
 * persisted in Postgres is an absolute TIMESTAMPTZ (UTC).
 */

const partsFormatterCache = new Map();

export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function partsFormatter(timeZone) {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock components of an instant in a given timezone. */
export function zonedParts(date, timeZone) {
  const parts = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(date)) {
    parts[type] = value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
export function zoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Converts a wall clock in `timeZone` to an absolute Date.
 * The offset is resolved twice so DST transitions land on the correct side.
 */
export function utcFromZoned({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = zoneOffsetMs(new Date(naive), timeZone);
  offset = zoneOffsetMs(new Date(naive - offset), timeZone);
  return new Date(naive - offset);
}

/** `YYYY-MM-DD` for the shop's local calendar day. */
export function zonedDateString(date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `HH:MM` wall clock in the shop's timezone. */
export function zonedTimeString(date, timeZone) {
  const { hour, minute } = zonedParts(date, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export const weekdayInZone = (date, timeZone) => zonedParts(date, timeZone).weekday;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(value) {
  const match = DATE_ONLY.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = { year: Number(year), month: Number(month), day: Number(day) };
  if (parsed.month < 1 || parsed.month > 12 || parsed.day < 1 || parsed.day > 31) return null;
  return parsed;
}

/** `HH:MM` or `HH:MM:SS` -> minutes since midnight, or null. */
export function timeToMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function minutesToTime(minutes) {
  if (minutes === null || minutes === undefined) return null;
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Adds whole days to a `YYYY-MM-DD` string, staying in the calendar domain. */
export function addDays(dateString, days) {
  const parsed = parseDateOnly(dateString);
  if (!parsed) return null;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromDateString, toDateString) {
  const from = parseDateOnly(fromDateString);
  const to = parseDateOnly(toDateString);
  if (!from || !to) return null;
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}

/** Weekday (0-6) of a `YYYY-MM-DD` calendar date. */
export function weekdayOfDate(dateString) {
  const parsed = parseDateOnly(dateString);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

export function formatInZone(date, timeZone, options = {}) {
  return new Intl.DateTimeFormat(options.locale ?? 'en-GB', { timeZone, ...options }).format(date);
}
