/**
 * Flexible tab filters for Citas (Hoy / Próximas / Completadas / Todas).
 * Always returns a usable list — Hoy falls back to recent confirmed when empty.
 */

const ACTIVE = new Set(['confirmed', 'in_progress', 'pending', 'accepted']);

/** Parse API/DB timestamps into a valid Date, or null. */
export function parseAppointmentDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds vs milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Plain calendar day → noon local parse (avoids UTC midnight shift surprises).
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Normalize "YYYY-MM-DD HH:mm:ss" → ISO-ish.
  const spaced = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
  const date = new Date(spaced);
  if (!Number.isNaN(date.getTime())) return date;

  // Last resort: Date.parse
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

/** Best-effort scheduled instant from a booking row. */
export function bookingScheduledAt(item) {
  if (!item || typeof item !== 'object') return null;
  return (
    parseAppointmentDate(item.scheduled_at) ||
    parseAppointmentDate(item.date) ||
    parseAppointmentDate(item.scheduled_local) ||
    parseAppointmentDate(item.created_at)
  );
}

/** Calendar day `YYYY-MM-DD` in the given IANA timezone. */
export function localDateKey(value, timeZone = 'Europe/Madrid') {
  const date = value instanceof Date ? value : parseAppointmentDate(value);
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Shop-local "today" as YYYY-MM-DD. */
export function shopTodayKey(timeZone = 'Europe/Madrid', now = new Date()) {
  return localDateKey(now, timeZone);
}

function sortByScheduledAsc(rows) {
  return [...rows].sort((a, b) => {
    const ta = a._scheduled?.getTime() ?? Number.POSITIVE_INFINITY;
    const tb = b._scheduled?.getTime() ?? Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}

function sortByScheduledDesc(rows) {
  return [...rows].sort((a, b) => {
    const ta = a._scheduled?.getTime() ?? 0;
    const tb = b._scheduled?.getTime() ?? 0;
    return tb - ta;
  });
}

function stripInternal(rows) {
  return rows.map(({ _scheduled, ...rest }) => rest);
}

/**
 * Apply the Citas tab filter.
 * - today: today's bookings, OR fallback to most recent confirmed/active
 * - upcoming: all confirmed, ascending by date
 * - completed: status === completed
 * - all: full list, ascending
 */
export function applyTabFilter(appointments, filter, { timeZone = 'Europe/Madrid', now = new Date() } = {}) {
  const list = Array.isArray(appointments) ? appointments : [];
  const todayKey = shopTodayKey(timeZone, now);

  const decorated = list.map((item) => ({
    ...item,
    _scheduled: bookingScheduledAt(item),
  }));

  switch (filter) {
    case 'today': {
      const todayRows = decorated.filter(
        (item) => item._scheduled && localDateKey(item._scheduled, timeZone) === todayKey,
      );
      if (todayRows.length) return stripInternal(sortByScheduledAsc(todayRows));

      // Fallback so the tab is never blank: most recent confirmed/active bookings.
      const active = decorated.filter((item) => ACTIVE.has(item.status));
      return stripInternal(sortByScheduledDesc(active));
    }
    case 'upcoming': {
      const confirmed = decorated.filter((item) => item.status === 'confirmed');
      return stripInternal(sortByScheduledAsc(confirmed));
    }
    case 'completed': {
      const completed = decorated.filter((item) => item.status === 'completed');
      return stripInternal(sortByScheduledDesc(completed));
    }
    case 'all':
    default:
      return stripInternal(sortByScheduledAsc(decorated));
  }
}
