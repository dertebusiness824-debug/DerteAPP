import { queryAll, queryOne, transaction } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import {
  addDays,
  daysBetween,
  minutesToTime,
  parseDateOnly,
  timeToMinutes,
  utcFromZoned,
  weekdayOfDate,
  zonedDateString,
  zonedParts,
} from '../lib/time.js';

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Sensible starting week for a newly created shop. */
export function defaultWeeklyHours() {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    if (weekday === 0) {
      return { weekday, is_closed: true, open_time: null, close_time: null, break_start: null, break_end: null };
    }
    if (weekday === 6) {
      return { weekday, is_closed: false, open_time: '09:00', close_time: '13:00', break_start: null, break_end: null };
    }
    return {
      weekday,
      is_closed: false,
      open_time: '09:00',
      close_time: '18:00',
      break_start: '13:00',
      break_end: '14:00',
    };
  });
}

const normalizeTime = (value) => {
  const minutes = timeToMinutes(value);
  return minutes === null ? null : minutesToTime(minutes);
};

/** Validates and normalises one weekday rule coming from the API. */
export function normalizeDayRule(input) {
  const weekday = Number(input?.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw badRequest('weekday must be an integer between 0 (Sunday) and 6 (Saturday)');
  }
  const isClosed = Boolean(input.is_closed);
  if (isClosed) {
    return { weekday, is_closed: true, open_time: null, close_time: null, break_start: null, break_end: null };
  }

  const open = normalizeTime(input.open_time);
  const close = normalizeTime(input.close_time);
  if (open === null || close === null) {
    throw badRequest(`${WEEKDAY_NAMES[weekday]}: open_time and close_time are required when the shop is open`);
  }
  if (timeToMinutes(close) <= timeToMinutes(open)) {
    throw badRequest(`${WEEKDAY_NAMES[weekday]}: close_time must be after open_time`);
  }

  const breakStart = normalizeTime(input.break_start);
  const breakEnd = normalizeTime(input.break_end);
  if ((breakStart === null) !== (breakEnd === null)) {
    throw badRequest(`${WEEKDAY_NAMES[weekday]}: a break needs both a start and an end time`);
  }
  if (breakStart !== null) {
    const [start, end] = [timeToMinutes(breakStart), timeToMinutes(breakEnd)];
    if (end <= start) throw badRequest(`${WEEKDAY_NAMES[weekday]}: break_end must be after break_start`);
    if (start < timeToMinutes(open) || end > timeToMinutes(close)) {
      throw badRequest(`${WEEKDAY_NAMES[weekday]}: the break must fall inside the opening hours`);
    }
  }

  return { weekday, is_closed: false, open_time: open, close_time: close, break_start: breakStart, break_end: breakEnd };
}

export async function getWeeklyHours(shopId) {
  const rows = await queryAll(
    `SELECT weekday, is_closed,
            to_char(open_time, 'HH24:MI')   AS open_time,
            to_char(close_time, 'HH24:MI')  AS close_time,
            to_char(break_start, 'HH24:MI') AS break_start,
            to_char(break_end, 'HH24:MI')   AS break_end
       FROM business_hours WHERE shop_id = $1 ORDER BY weekday`,
    [shopId],
  );
  const byWeekday = new Map(rows.map((row) => [row.weekday, row]));
  // Missing rows mean "not configured yet" - treat as closed rather than 24/7.
  return [0, 1, 2, 3, 4, 5, 6].map(
    (weekday) =>
      byWeekday.get(weekday) ?? {
        weekday,
        is_closed: true,
        open_time: null,
        close_time: null,
        break_start: null,
        break_end: null,
      },
  );
}

export async function replaceWeeklyHours(shopId, days) {
  const normalized = days.map(normalizeDayRule);
  const seen = new Set();
  for (const day of normalized) {
    if (seen.has(day.weekday)) throw badRequest(`Duplicate entry for ${WEEKDAY_NAMES[day.weekday]}`);
    seen.add(day.weekday);
  }

  await transaction(async (client) => {
    for (const day of normalized) {
      await client.query(
        `INSERT INTO business_hours (shop_id, weekday, is_closed, open_time, close_time, break_start, break_end)
         VALUES ($1, $2, $3, $4::time, $5::time, $6::time, $7::time)
         ON CONFLICT (shop_id, weekday) DO UPDATE
            SET is_closed = EXCLUDED.is_closed,
                open_time = EXCLUDED.open_time,
                close_time = EXCLUDED.close_time,
                break_start = EXCLUDED.break_start,
                break_end = EXCLUDED.break_end,
                updated_at = now()`,
        [shopId, day.weekday, day.is_closed, day.open_time, day.close_time, day.break_start, day.break_end],
      );
    }
  });

  return getWeeklyHours(shopId);
}

export async function seedDefaultHours(client, shopId) {
  for (const day of defaultWeeklyHours()) {
    await client.query(
      `INSERT INTO business_hours (shop_id, weekday, is_closed, open_time, close_time, break_start, break_end)
       VALUES ($1, $2, $3, $4::time, $5::time, $6::time, $7::time)
       ON CONFLICT (shop_id, weekday) DO NOTHING`,
      [shopId, day.weekday, day.is_closed, day.open_time, day.close_time, day.break_start, day.break_end],
    );
  }
}

export function listExceptions(shopId, { from, to } = {}) {
  return queryAll(
    `SELECT id, exception_date, is_closed, note,
            to_char(open_time, 'HH24:MI')   AS open_time,
            to_char(close_time, 'HH24:MI')  AS close_time,
            to_char(break_start, 'HH24:MI') AS break_start,
            to_char(break_end, 'HH24:MI')   AS break_end
       FROM schedule_exceptions
      WHERE shop_id = $1
        AND ($2::date IS NULL OR exception_date >= $2::date)
        AND ($3::date IS NULL OR exception_date <= $3::date)
      ORDER BY exception_date`,
    [shopId, from ?? null, to ?? null],
  );
}

export async function upsertException(shopId, input) {
  if (!parseDateOnly(input?.date)) throw badRequest('date must be formatted as YYYY-MM-DD');
  const isClosed = input.is_closed === undefined ? true : Boolean(input.is_closed);
  const rule = isClosed
    ? { open_time: null, close_time: null, break_start: null, break_end: null }
    : normalizeDayRule({ ...input, weekday: weekdayOfDate(input.date), is_closed: false });

  return queryOne(
    `INSERT INTO schedule_exceptions (shop_id, exception_date, is_closed, open_time, close_time, break_start, break_end, note)
     VALUES ($1, $2::date, $3, $4::time, $5::time, $6::time, $7::time, $8)
     ON CONFLICT (shop_id, exception_date) DO UPDATE
        SET is_closed = EXCLUDED.is_closed,
            open_time = EXCLUDED.open_time,
            close_time = EXCLUDED.close_time,
            break_start = EXCLUDED.break_start,
            break_end = EXCLUDED.break_end,
            note = EXCLUDED.note
     RETURNING id, exception_date, is_closed, note,
               to_char(open_time, 'HH24:MI')   AS open_time,
               to_char(close_time, 'HH24:MI')  AS close_time,
               to_char(break_start, 'HH24:MI') AS break_start,
               to_char(break_end, 'HH24:MI')   AS break_end`,
    [
      shopId,
      input.date,
      isClosed,
      rule.open_time,
      rule.close_time,
      rule.break_start,
      rule.break_end,
      input.note ?? null,
    ],
  );
}

export function deleteException(shopId, id) {
  return queryOne('DELETE FROM schedule_exceptions WHERE shop_id = $1 AND id = $2 RETURNING id', [shopId, id]);
}

/**
 * Effective opening rule for one calendar date: the weekly rule, overridden by
 * a schedule exception when one exists.
 */
export function resolveDayRule(dateString, weeklyHours, exceptionsByDate = new Map()) {
  const weekday = weekdayOfDate(dateString);
  const weekly = weeklyHours.find((day) => day.weekday === weekday) ?? { is_closed: true };
  const exception = exceptionsByDate.get(dateString);

  if (exception) {
    if (exception.is_closed) {
      return { date: dateString, weekday, is_closed: true, source: 'exception', note: exception.note ?? null };
    }
    return {
      date: dateString,
      weekday,
      is_closed: false,
      open_time: exception.open_time,
      close_time: exception.close_time,
      break_start: exception.break_start,
      break_end: exception.break_end,
      source: 'exception',
      note: exception.note ?? null,
    };
  }

  if (weekly.is_closed) {
    return { date: dateString, weekday, is_closed: true, source: 'weekly', note: null };
  }
  return {
    date: dateString,
    weekday,
    is_closed: false,
    open_time: weekly.open_time,
    close_time: weekly.close_time,
    break_start: weekly.break_start,
    break_end: weekly.break_end,
    source: 'weekly',
    note: null,
  };
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/** Candidate slot start times (minutes from midnight) for one open day. */
export function slotStartsForDay(rule, { slotMinutes, durationMinutes }) {
  if (rule.is_closed) return [];
  const open = timeToMinutes(rule.open_time);
  const close = timeToMinutes(rule.close_time);
  if (open === null || close === null) return [];

  const breakStart = timeToMinutes(rule.break_start);
  const breakEnd = timeToMinutes(rule.break_end);

  const starts = [];
  for (let start = open; start + durationMinutes <= close; start += slotMinutes) {
    if (breakStart !== null && overlaps(start, start + durationMinutes, breakStart, breakEnd)) continue;
    starts.push(start);
  }
  return starts;
}

async function loadShop(shopId) {
  const shop = await queryOne(
    `SELECT id, name, timezone, slot_minutes, capacity, min_notice_minutes, booking_horizon_days, status
       FROM shops WHERE id = $1`,
    [shopId],
  );
  if (!shop) throw badRequest('Unknown shop');
  return shop;
}

/**
 * Availability for a date range, taking opening hours, breaks, day-off
 * exceptions, minimum notice, booking horizon and slot capacity into account.
 */
export async function getAvailability({ shopId, shop: shopInput, from, days = 14, durationMinutes, now = new Date() }) {
  const shop = shopInput ?? (await loadShop(shopId));
  const timezone = shop.timezone;
  const startDate = from && parseDateOnly(from) ? from : zonedDateString(now, timezone);
  const span = Math.min(Math.max(Number(days) || 1, 1), 62);
  const endDate = addDays(startDate, span - 1);
  const duration = Math.min(Math.max(Number(durationMinutes) || shop.slot_minutes, 5), 1440);

  const [weeklyHours, exceptions] = await Promise.all([
    getWeeklyHours(shop.id),
    listExceptions(shop.id, { from: startDate, to: endDate }),
  ]);
  const exceptionsByDate = new Map(exceptions.map((row) => [row.exception_date, row]));

  const rangeStart = utcFromZoned({ ...parseDateOnly(startDate), hour: 0, minute: 0 }, timezone);
  const rangeEnd = utcFromZoned({ ...parseDateOnly(addDays(endDate, 1)), hour: 0, minute: 0 }, timezone);
  const booked = await queryAll(
    `SELECT scheduled_at, duration_minutes
       FROM appointments
      WHERE shop_id = $1
        AND status NOT IN ('cancelled', 'no_show')
        AND scheduled_at >= $2 AND scheduled_at < $3`,
    [shop.id, rangeStart.toISOString(), rangeEnd.toISOString()],
  );
  const bookedIntervals = booked.map((row) => {
    const start = new Date(row.scheduled_at).getTime();
    return [start, start + row.duration_minutes * 60_000];
  });

  const earliest = now.getTime() + shop.min_notice_minutes * 60_000;
  const horizonLastDate = addDays(zonedDateString(now, timezone), shop.booking_horizon_days);

  const result = [];
  for (let index = 0; index < span; index += 1) {
    const date = addDays(startDate, index);
    const rule = resolveDayRule(date, weeklyHours, exceptionsByDate);
    const beyondHorizon = daysBetween(date, horizonLastDate) < 0;

    const slots = slotStartsForDay(rule, { slotMinutes: shop.slot_minutes, durationMinutes: duration }).map(
      (startMinutes) => {
        const startAt = utcFromZoned(
          { ...parseDateOnly(date), hour: Math.floor(startMinutes / 60), minute: startMinutes % 60 },
          timezone,
        );
        const endAt = new Date(startAt.getTime() + duration * 60_000);
        const taken = bookedIntervals.filter(([bStart, bEnd]) =>
          overlaps(startAt.getTime(), endAt.getTime(), bStart, bEnd),
        ).length;
        const remaining = Math.max(shop.capacity - taken, 0);

        let reason = null;
        if (startAt.getTime() < earliest) reason = 'too_soon';
        else if (beyondHorizon) reason = 'beyond_horizon';
        else if (remaining === 0) reason = 'full';

        return {
          time: minutesToTime(startMinutes),
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          available: reason === null,
          remaining,
          reason,
        };
      },
    );

    result.push({
      date,
      weekday: rule.weekday,
      weekday_name: WEEKDAY_NAMES[rule.weekday],
      is_closed: rule.is_closed,
      open_time: rule.open_time ?? null,
      close_time: rule.close_time ?? null,
      break_start: rule.break_start ?? null,
      break_end: rule.break_end ?? null,
      note: rule.note ?? null,
      source: rule.source,
      beyond_horizon: beyondHorizon,
      slots,
      available_count: slots.filter((slot) => slot.available).length,
    });
  }

  return {
    shop: { id: shop.id, name: shop.name, timezone, slot_minutes: shop.slot_minutes, capacity: shop.capacity },
    from: startDate,
    to: endDate,
    duration_minutes: duration,
    days: result,
  };
}

/**
 * Checks whether a requested datetime can be booked.
 * Returns `{ ok: true }` or `{ ok: false, reason, message }` - the public
 * booking endpoint turns a rejection into a 409 with a readable message.
 */
export async function checkBookable({ shopId, shop: shopInput, scheduledAt, durationMinutes, now = new Date(), excludeAppointmentId = null }) {
  const shop = shopInput ?? (await loadShop(shopId));
  const timezone = shop.timezone;
  const startAt = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(startAt.getTime())) {
    return { ok: false, reason: 'invalid_datetime', message: 'The requested date and time could not be parsed.' };
  }

  const duration = Math.min(Math.max(Number(durationMinutes) || shop.slot_minutes, 5), 1440);
  const endAt = new Date(startAt.getTime() + duration * 60_000);
  const date = zonedDateString(startAt, timezone);

  if (startAt.getTime() < now.getTime()) {
    return { ok: false, reason: 'in_past', message: 'That time is already in the past.' };
  }
  if (startAt.getTime() < now.getTime() + shop.min_notice_minutes * 60_000) {
    return {
      ok: false,
      reason: 'too_soon',
      message: `Bookings need at least ${shop.min_notice_minutes} minutes of notice. Please call the shop for urgent work.`,
    };
  }
  if (daysBetween(date, addDays(zonedDateString(now, timezone), shop.booking_horizon_days)) < 0) {
    return {
      ok: false,
      reason: 'beyond_horizon',
      message: `Online bookings are open up to ${shop.booking_horizon_days} days ahead.`,
    };
  }

  const [weeklyHours, exceptions] = await Promise.all([
    getWeeklyHours(shop.id),
    listExceptions(shop.id, { from: date, to: date }),
  ]);
  const rule = resolveDayRule(date, weeklyHours, new Map(exceptions.map((row) => [row.exception_date, row])));

  if (rule.is_closed) {
    return {
      ok: false,
      reason: 'closed_day',
      message: rule.note ? `The shop is closed that day (${rule.note}).` : 'The shop is closed that day.',
      rule,
    };
  }

  const { hour, minute } = zonedParts(startAt, timezone);
  const startMinutes = hour * 60 + minute;
  const endMinutes = startMinutes + duration;
  const open = timeToMinutes(rule.open_time);
  const close = timeToMinutes(rule.close_time);

  if (startMinutes < open || endMinutes > close) {
    return {
      ok: false,
      reason: 'outside_hours',
      message: `That time is outside opening hours (${rule.open_time}-${rule.close_time}).`,
      rule,
    };
  }

  const breakStart = timeToMinutes(rule.break_start);
  if (breakStart !== null && overlaps(startMinutes, endMinutes, breakStart, timeToMinutes(rule.break_end))) {
    return {
      ok: false,
      reason: 'break_time',
      message: `The shop is on break between ${rule.break_start} and ${rule.break_end}.`,
      rule,
    };
  }

  const occupancy = await queryOne(
    `SELECT count(*)::int AS taken
       FROM appointments
      WHERE shop_id = $1
        AND status NOT IN ('cancelled', 'no_show')
        AND ($4::uuid IS NULL OR id <> $4::uuid)
        AND scheduled_at < $3
        AND scheduled_at + (duration_minutes * interval '1 minute') > $2`,
    [shop.id, startAt.toISOString(), endAt.toISOString(), excludeAppointmentId],
  );

  if (occupancy.taken >= shop.capacity) {
    return { ok: false, reason: 'full', message: 'That slot is fully booked. Please pick another time.', rule };
  }

  return { ok: true, rule, duration_minutes: duration, start_at: startAt.toISOString(), end_at: endAt.toISOString() };
}

/** Open/closed right now plus today's hours - used by the dashboard header. */
export async function getOpenState(shop, now = new Date()) {
  const timezone = shop.timezone;
  const date = zonedDateString(now, timezone);
  const [weeklyHours, exceptions] = await Promise.all([
    getWeeklyHours(shop.id),
    listExceptions(shop.id, { from: date, to: date }),
  ]);
  const rule = resolveDayRule(date, weeklyHours, new Map(exceptions.map((row) => [row.exception_date, row])));
  if (rule.is_closed) return { open_now: false, reason: 'closed_today', today: rule };

  const { hour, minute } = zonedParts(now, timezone);
  const minutes = hour * 60 + minute;
  const open = timeToMinutes(rule.open_time);
  const close = timeToMinutes(rule.close_time);
  const breakStart = timeToMinutes(rule.break_start);

  if (minutes < open) return { open_now: false, reason: 'before_opening', today: rule };
  if (minutes >= close) return { open_now: false, reason: 'after_closing', today: rule };
  if (breakStart !== null && minutes >= breakStart && minutes < timeToMinutes(rule.break_end)) {
    return { open_now: false, reason: 'on_break', today: rule };
  }
  return { open_now: true, reason: null, today: rule };
}
