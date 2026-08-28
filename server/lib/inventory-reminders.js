/**
 * When an inventory reminder is due.
 *
 * Two independent nudges, both decided in the shop's own timezone:
 *
 *   - fortnightly: every other Friday. The cadence is anchored on a fixed
 *     Friday (ANCHOR_FRIDAY) so every shop lands on the same alternating weeks
 *     and a shop created mid-cycle does not start its own private rhythm.
 *   - monthly: "this month you have not updated your inventory", sent once per
 *     calendar month and only when the movement log really is empty for it.
 *
 * Pure functions on purpose: the service layer supplies dates and state, so the
 * calendar rules can be tested without a database or a clock.
 */
import { weekdayOfDate, daysBetween, zonedDateString, zonedParts } from './time.js';

export const FRIDAY = 5;
export const REMINDER_INTERVAL_DAYS = 14;

/**
 * Day of the month from which the monthly nudge makes sense. On the 1st every
 * shop trivially has "no changes this month", so waiting until mid-month means
 * the message only fires when the silence is actually meaningful.
 */
export const MONTHLY_REMINDER_DAY = 15;

/**
 * Sending window in the shop's local time. The sweep runs hourly, so without
 * this a Friday reminder could arrive at 03:00.
 */
export const REMINDER_HOUR_FROM = 9;
export const REMINDER_HOUR_UNTIL = 21;

/**
 * Anchor for the fortnightly cadence: Friday 2 January 2026.
 * Any Friday an even number of weeks away from this date is a reminder Friday.
 */
export const ANCHOR_FRIDAY = '2026-01-02';

/** `YYYY-MM` of a calendar date, the key used to send the monthly nudge once. */
export const monthKeyOf = (dateString) => String(dateString ?? '').slice(0, 7);

/**
 * `YYYY-MM-DD` of a DATE column, which pg hands back either as a string or as a
 * Date at local midnight. Read as a calendar day, never reinterpreted in another
 * zone, or a server running east of the shop would report yesterday.
 */
export function calendarDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
      value.getDate(),
    ).padStart(2, '0')}`;
  }
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/** True when `dateString` is one of the alternating reminder Fridays. */
export function isReminderFriday(dateString) {
  if (weekdayOfDate(dateString) !== FRIDAY) return false;
  const days = daysBetween(ANCHOR_FRIDAY, dateString);
  if (days === null) return false;
  return Math.abs(days) % REMINDER_INTERVAL_DAYS === 0;
}

/** Today, the day of month, the hour and the month key, in the shop's calendar. */
export function shopCalendar(now, timeZone) {
  const today = zonedDateString(now, timeZone);
  const { year, month, day, hour } = zonedParts(now, timeZone);
  return {
    today,
    day_of_month: day,
    hour,
    month_key: `${year}-${String(month).padStart(2, '0')}`,
  };
}

/**
 * Decides which reminders a shop is owed right now.
 *
 * `state` is the `shop_inventory_state` row (or null before one exists) and
 * `changesThisMonth` is how many movements the shop logged this calendar month.
 * Returns `{ fortnightly, monthly, today, month_key, reason }`; `reason`
 * explains a fully suppressed result so the caller can log something useful.
 */
export function dueReminders({
  now = new Date(),
  timeZone = 'Europe/Madrid',
  state = null,
  changesThisMonth = 0,
} = {}) {
  const { today, day_of_month: dayOfMonth, hour, month_key: monthKey } = shopCalendar(now, timeZone);
  const base = { fortnightly: false, monthly: false, today, month_key: monthKey };

  // The owner's kill switch turns off the whole system, both nudges included.
  if (state && state.reminders_enabled === false) {
    return { ...base, reason: 'reminders_disabled' };
  }

  if (hour < REMINDER_HOUR_FROM || hour >= REMINDER_HOUR_UNTIL) {
    return { ...base, reason: 'outside_sending_hours' };
  }

  const lastFortnightly = calendarDate(state?.last_biweekly_notified_on);
  const fortnightly = isReminderFriday(today) && lastFortnightly !== today;

  // Only nag about an untouched month, from mid-month, and only once per month.
  const monthly =
    changesThisMonth === 0 &&
    dayOfMonth >= MONTHLY_REMINDER_DAY &&
    state?.last_monthly_notified_month !== monthKey;

  return {
    ...base,
    fortnightly,
    monthly,
    reason: fortnightly || monthly ? null : 'nothing_due',
  };
}
