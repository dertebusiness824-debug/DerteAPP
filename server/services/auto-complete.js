/**
 * Auto-completes today's confirmed bookings once the shop is within 30 minutes
 * of closing (e.g. close 19:00 → from 18:30 onward).
 */
import { query, queryAll, queryOne } from '../db/index.js';
import { channels, hub } from '../lib/events.js';
import { addDays, parseDateOnly, timeToMinutes, utcFromZoned, zonedDateString, zonedParts } from '../lib/time.js';
import { serializeAppointment } from './appointments.js';
import { getWeeklyHours, listExceptions, resolveDayRule } from './schedule.js';

const AUTO_COMPLETE_LEAD_MINUTES = 30;
const COMPLETABLE = ['confirmed', 'accepted', 'pending', 'in_progress'];

/**
 * Returns the shop-local threshold instant (close_time − 30 minutes) for today,
 * or null when the shop is closed / has no close time.
 */
export function closingAutoCompleteThreshold(rule, today, timezone) {
  if (!rule || rule.is_closed || !rule.close_time) return null;
  const closeMinutes = timeToMinutes(rule.close_time);
  if (closeMinutes === null) return null;
  const thresholdMinutes = Math.max(0, closeMinutes - AUTO_COMPLETE_LEAD_MINUTES);
  const hour = Math.floor(thresholdMinutes / 60);
  const minute = thresholdMinutes % 60;
  const parts = parseDateOnly(today);
  if (!parts) return null;
  return {
    thresholdMinutes,
    closeMinutes,
    thresholdAt: utcFromZoned({ ...parts, hour, minute }, timezone),
  };
}

/** Loads today's effective hours for a shop. */
async function todayRule(shop, now) {
  const timezone = shop.timezone || 'Europe/Madrid';
  const today = zonedDateString(now, timezone);
  const [weeklyHours, exceptions] = await Promise.all([
    getWeeklyHours(shop.id),
    listExceptions(shop.id, { from: today, to: today }),
  ]);
  const rule = resolveDayRule(
    today,
    weeklyHours,
    new Map(exceptions.map((row) => [row.exception_date, row])),
  );
  return { timezone, today, rule };
}

/**
 * Marks today's completable appointments as completed when `now` is past
 * (closing time − 30 minutes) for the shop.
 */
export async function autoCompleteShopAppointments(shop, now = new Date()) {
  if (!shop?.id) return { completed: 0, skipped: true, reason: 'no_shop' };

  const { timezone, today, rule } = await todayRule(shop, now);
  const threshold = closingAutoCompleteThreshold(rule, today, timezone);
  if (!threshold) {
    return { completed: 0, skipped: true, reason: 'closed_or_no_hours', date: today };
  }

  const { hour, minute } = zonedParts(now, timezone);
  const nowMinutes = hour * 60 + minute;
  if (nowMinutes < threshold.thresholdMinutes) {
    return {
      completed: 0,
      skipped: true,
      reason: 'before_threshold',
      date: today,
      close_time: rule.close_time,
      threshold_time: `${String(Math.floor(threshold.thresholdMinutes / 60)).padStart(2, '0')}:${String(threshold.thresholdMinutes % 60).padStart(2, '0')}`,
    };
  }

  const dayStart = utcFromZoned({ ...parseDateOnly(today), hour: 0, minute: 0 }, timezone);
  const dayEnd = utcFromZoned({ ...parseDateOnly(addDays(today, 1)), hour: 0, minute: 0 }, timezone);

  const { rows } = await query(
    `UPDATE appointments
        SET status = 'completed',
            completed_at = COALESCE(completed_at, now())
      WHERE shop_id = $1
        AND status = ANY($2::text[])
        AND scheduled_at >= $3
        AND scheduled_at < $4
      RETURNING id`,
    [shop.id, COMPLETABLE, dayStart.toISOString(), dayEnd.toISOString()],
  );

  if (rows.length) {
    for (const row of rows) {
      const full = await queryOne(
        `SELECT a.*, s.timezone, s.name AS shop_name
           FROM appointments a
           JOIN shops s ON s.id = a.shop_id
          WHERE a.id = $1`,
        [row.id],
      );
      if (!full) continue;
      hub.publish(channels.shop(shop.id), {
        type: 'appointment_updated',
        shop_id: shop.id,
        appointment: serializeAppointment(full, { timezone }),
        auto_completed: true,
      });
    }
    console.log('[auto-complete] completed bookings near closing', {
      shopId: shop.id,
      date: today,
      close: rule.close_time,
      count: rows.length,
    });
  }

  return {
    completed: rows.length,
    ids: rows.map((row) => row.id),
    date: today,
    close_time: rule.close_time,
  };
}

/** Background sweep across every active shop. */
export async function autoCompleteAllShops(now = new Date()) {
  const shops = await queryAll(
    `SELECT id, name, timezone, status FROM shops WHERE status = 'active'`,
  );
  let total = 0;
  for (const shop of shops) {
    try {
      const result = await autoCompleteShopAppointments(shop, now);
      total += result.completed || 0;
    } catch (error) {
      console.error('[auto-complete] shop failed', shop.id, error.message);
    }
  }
  return { shops: shops.length, completed: total };
}
