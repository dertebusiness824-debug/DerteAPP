/**
 * Client-side booking lifecycle helpers for Dashboard + Citas.
 * Bookings arrive confirmed; near closing they flip to completed and Cancel hides.
 */

export const CLOSING_AUTOCOMPLETE_LEAD_MINUTES = 30;

const COMPLETABLE = new Set(['confirmed', 'pending', 'accepted', 'in_progress']);
const CANCEL_BLOCKED = new Set(['completed', 'cancelled', 'no_show']);

/** Shop-local calendar day `YYYY-MM-DD`. */
export function localDateString(timeZone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Minutes since midnight in the shop timezone. */
export function localMinutesNow(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

export function parseCloseMinutes(closeTime) {
  if (!closeTime) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(String(closeTime).trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** True when shop-local now is at/after close_time − 30 minutes. */
export function isPastClosingAutoComplete(closeTime, { timeZone, now = new Date(), leadMinutes = CLOSING_AUTOCOMPLETE_LEAD_MINUTES } = {}) {
  const closeMinutes = parseCloseMinutes(closeTime);
  if (closeMinutes === null) return false;
  return localMinutesNow(timeZone, now) >= Math.max(0, closeMinutes - leadMinutes);
}

export function canCancelAppointment(appointment) {
  if (!appointment) return false;
  if (CANCEL_BLOCKED.has(appointment.status)) return false;
  if (Array.isArray(appointment.allowed_transitions)) {
    return appointment.allowed_transitions.includes('cancelled');
  }
  return COMPLETABLE.has(appointment.status);
}

/**
 * Decorates today's open bookings as completed once past close−30m.
 * Sets `_autoCompleted` on rows that still need a server persist.
 */
export function applyClosingAutoComplete(
  appointments,
  { closeTime, isClosed = false, timeZone, now = new Date() } = {},
) {
  const list = Array.isArray(appointments) ? appointments : [];
  if (isClosed || !closeTime || !isPastClosingAutoComplete(closeTime, { timeZone, now })) {
    return list.map((item) => ({ ...item }));
  }

  const today = localDateString(timeZone, now);
  return list.map((item) => {
    const day = localDateString(timeZone, new Date(item.scheduled_at));
    if (day !== today || !COMPLETABLE.has(item.status)) return { ...item };
    return {
      ...item,
      status: 'completed',
      allowed_transitions: [],
      _autoCompleted: item.status !== 'completed',
    };
  });
}
