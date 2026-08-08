/**
 * Tab filters for the appointments screen (Hoy / Próximas / Completadas / Todas).
 * Dates are compared in the shop timezone so UTC midnight shifts do not drop "today".
 */

/** Parse API/DB timestamps into a valid Date, or null. */
export function parseAppointmentDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar day `YYYY-MM-DD` in the given IANA timezone. */
export function localDateKey(value, timeZone = 'Europe/Madrid') {
  const date = parseAppointmentDate(value);
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

/**
 * Apply the Citas tab filter to a list of appointments.
 * - today: same calendar day as now (shop TZ), any time / open statuses
 * - upcoming: scheduled_at > now AND status === confirmed
 * - completed: status === completed
 * - all: everything
 */
export function applyTabFilter(appointments, filter, { timeZone = 'Europe/Madrid', now = new Date() } = {}) {
  const list = Array.isArray(appointments) ? appointments : [];
  const todayKey = shopTodayKey(timeZone, now);
  const nowMs = now.getTime();

  return list.filter((item) => {
    const scheduled = parseAppointmentDate(item?.scheduled_at);
    if (!scheduled) return filter === 'all';
    const status = item.status;

    switch (filter) {
      case 'today':
        return localDateKey(scheduled, timeZone) === todayKey;
      case 'upcoming':
        return status === 'confirmed' && scheduled.getTime() > nowMs;
      case 'completed':
        return status === 'completed';
      case 'all':
      default:
        return true;
    }
  });
}
