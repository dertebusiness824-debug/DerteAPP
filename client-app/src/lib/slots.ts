/**
 * Generación de huecos reservables a partir del horario publicado por el taller
 * y de la ocupación real de su agenda (`marketplace_slot_load`).
 */
import type { SlotLoadEntry, WeeklyHour } from '@/data/types';
import { hoursByWeekday, openIntervals } from './hours';
import { addDaysToKey, timeFromMinutes, todayKey, weekdayOfKey, zonedTimeToUtc } from './time';

export type SlotBlockedReason = 'notice' | 'full';

export interface SlotCandidate {
  /** Instante UTC del hueco en ISO 8601 (lo que se envía a Supabase). */
  iso: string;
  /** Hora local del taller, `HH:MM`. */
  time: string;
  available: boolean;
  remaining: number;
  blockedReason: SlotBlockedReason | null;
}

export interface DayAvailability {
  dateKey: string;
  weekday: number;
  isClosed: boolean;
  slots: SlotCandidate[];
  availableCount: number;
}

export interface AvailabilityShop {
  timezone: string;
  slotMinutes: number;
  capacity: number;
  minNoticeMinutes: number;
  bookingHorizonDays: number;
  hours: WeeklyHour[];
}

export function slotLoadMap(entries: SlotLoadEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const key = new Date(entry.slotStart).toISOString();
    map.set(key, (map.get(key) ?? 0) + Number(entry.booked ?? 0));
  }
  return map;
}

export function buildDayAvailability(
  shop: AvailabilityShop,
  dateKey: string,
  load: Map<string, number>,
  now: Date = new Date(),
  durationMinutes?: number,
): DayAvailability {
  const weekday = weekdayOfKey(dateKey);
  const hour = hoursByWeekday(shop.hours).get(weekday);
  const intervals = openIntervals(hour);
  const step = Math.max(5, shop.slotMinutes || 60);
  const needed = Math.max(step, durationMinutes ?? step);
  const noticeCutoff = now.getTime() + shop.minNoticeMinutes * 60_000;
  const slots: SlotCandidate[] = [];

  for (const [start, end] of intervals) {
    for (let minute = start; minute + needed <= end; minute += step) {
      const time = timeFromMinutes(minute);
      const iso = zonedTimeToUtc(dateKey, time, shop.timezone).toISOString();
      const booked = load.get(iso) ?? 0;
      const remaining = Math.max(0, shop.capacity - booked);

      let blockedReason: SlotBlockedReason | null = null;
      if (new Date(iso).getTime() < noticeCutoff) blockedReason = 'notice';
      else if (remaining <= 0) blockedReason = 'full';

      slots.push({ iso, time, available: blockedReason === null, remaining, blockedReason });
    }
  }

  return {
    dateKey,
    weekday,
    isClosed: intervals.length === 0,
    slots,
    availableCount: slots.filter((slot) => slot.available).length,
  };
}

/** Calendario de los próximos `days` días, recortado al horizonte del taller. */
export function buildAvailabilityCalendar(
  shop: AvailabilityShop,
  load: Map<string, number>,
  options: { days?: number; now?: Date; durationMinutes?: number } = {},
): DayAvailability[] {
  const now = options.now ?? new Date();
  const days = Math.max(1, Math.min(options.days ?? 14, shop.bookingHorizonDays || 60));
  const first = todayKey(shop.timezone, now);

  return Array.from({ length: days }, (_, index) =>
    buildDayAvailability(
      shop,
      addDaysToKey(first, index),
      load,
      now,
      options.durationMinutes,
    ),
  );
}

/** Primer día con hueco libre; útil para preseleccionar el calendario. */
export function firstDayWithAvailability(calendar: DayAvailability[]): DayAvailability | null {
  return calendar.find((day) => day.availableCount > 0) ?? null;
}
