/**
 * Flexible tab filters for Citas (Hoy / Próximas / Completadas / Todas).
 *
 * Rules (no strict “future-only” / past-date exclusion):
 * - Hoy: same calendar day, OR fallback to recent confirmed/active so the tab is never blank
 * - Próximas: every status === 'confirmed', ascending by date (past test bookings included)
 * - Completadas: status === 'completed' only (incl. auto-complete near closing)
 * - Todas: full list, no date/status filter
 */

const ACTIVE = new Set(['confirmed', 'in_progress', 'pending', 'accepted']);
const NON_CANCELLED = new Set(['confirmed', 'in_progress', 'pending', 'accepted', 'completed']);

/**
 * Convert API/DB date values into a standard Date before any comparison.
 * Accepts Date, epoch (s/ms), ISO, date-only (`YYYY-MM-DD`), and spaced timestamps.
 * @returns {Date|null}
 */
export function parseAppointmentDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Plain calendar day → noon local (avoids UTC-midnight day shifts).
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // "YYYY-MM-DD HH:mm:ss" → ISO-ish so `new Date(...)` parses reliably.
  const spaced = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
  const date = new Date(spaced);
  if (!Number.isNaN(date.getTime())) return date;

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

/** Best-effort scheduled instant — prefers scheduled_at, then date / local / created. */
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
 * Apply the Citas tab filter with flexible rules (see file header).
 */
export function applyTabFilter(appointments, filter, { timeZone = 'Europe/Madrid', now = new Date() } = {}) {
  const list = Array.isArray(appointments) ? appointments : [];
  const todayKey = shopTodayKey(timeZone, now);

  const decorated = list.map((item) => ({
    ...item,
    // Always normalize through Date before day / sort comparisons.
    _scheduled: bookingScheduledAt(item),
  }));

  switch (filter) {
    case 'today': {
      const todayRows = decorated.filter((item) => {
        if (!item._scheduled) return false;
        return localDateKey(item._scheduled, timeZone) === todayKey;
      });
      if (todayRows.length) return stripInternal(sortByScheduledAsc(todayRows));

      // Fallback 1: most recent confirmed (covers past test bookings).
      const confirmed = decorated.filter((item) => item.status === 'confirmed');
      if (confirmed.length) return stripInternal(sortByScheduledDesc(confirmed));

      // Fallback 2: any other active status.
      const active = decorated.filter((item) => ACTIVE.has(item.status));
      if (active.length) return stripInternal(sortByScheduledDesc(active));

      // Last resort: keep the tab populated if the shop has any open/completed rows.
      const usable = decorated.filter((item) => NON_CANCELLED.has(item.status));
      return stripInternal(sortByScheduledDesc(usable));
    }
    case 'upcoming': {
      // All confirmed — no "scheduled_at > now" gate (past tests must appear).
      const confirmed = decorated.filter((item) => item.status === 'confirmed');
      return stripInternal(sortByScheduledAsc(confirmed));
    }
    case 'completed': {
      const completed = decorated.filter((item) => item.status === 'completed');
      return stripInternal(sortByScheduledDesc(completed));
    }
    case 'all':
    default:
      // Full list — no date or status filter.
      return stripInternal(sortByScheduledAsc(decorated));
  }
}
