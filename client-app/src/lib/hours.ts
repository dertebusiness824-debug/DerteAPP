/** Estado de apertura del taller a partir de su horario semanal publicado. */
import type { WeeklyHour } from '@/data/types';
import { minutesFromTime, timeFromMinutes, zonedParts } from './time';

export const WEEKDAY_LABELS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;

export const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

export interface OpenState {
  openNow: boolean;
  /** Texto corto para las tarjetas: «Abierto · cierra 19:00», «Cierra a las 09:00»… */
  label: string;
  /** Motivo legible del estado actual. */
  reason: 'open' | 'closed_today' | 'before_open' | 'after_close' | 'on_break' | 'unknown';
  /** Rango de hoy ya formateado, o `null` si el taller cierra. */
  todayRange: string | null;
}

export function hoursByWeekday(hours: WeeklyHour[]): Map<number, WeeklyHour> {
  return new Map(hours.map((entry) => [entry.weekday, entry]));
}

export function formatRange(hour: WeeklyHour | undefined): string | null {
  if (!hour || hour.isClosed || !hour.openTime || !hour.closeTime) return null;
  const open = hour.openTime.slice(0, 5);
  const close = hour.closeTime.slice(0, 5);
  if (hour.breakStart && hour.breakEnd) {
    return `${open}–${hour.breakStart.slice(0, 5)} · ${hour.breakEnd.slice(0, 5)}–${close}`;
  }
  return `${open}–${close}`;
}

/** Intervalos abiertos (en minutos desde medianoche) de un día concreto. */
export function openIntervals(hour: WeeklyHour | undefined): Array<[number, number]> {
  if (!hour || hour.isClosed) return [];
  const open = minutesFromTime(hour.openTime);
  const close = minutesFromTime(hour.closeTime);
  if (open === null || close === null || close <= open) return [];

  const breakStart = minutesFromTime(hour.breakStart);
  const breakEnd = minutesFromTime(hour.breakEnd);
  if (
    breakStart !== null &&
    breakEnd !== null &&
    breakEnd > breakStart &&
    breakStart > open &&
    breakEnd < close
  ) {
    return [
      [open, breakStart],
      [breakEnd, close],
    ];
  }
  return [[open, close]];
}

export function getOpenState(
  hours: WeeklyHour[],
  timeZone: string,
  now: Date = new Date(),
): OpenState {
  if (hours.length === 0) {
    return { openNow: false, label: 'Horario no publicado', reason: 'unknown', todayRange: null };
  }

  const parts = zonedParts(now, timeZone);
  const byWeekday = hoursByWeekday(hours);
  const today = byWeekday.get(parts.weekday);
  const todayRange = formatRange(today);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const intervals = openIntervals(today);

  if (intervals.length === 0) {
    const nextOpen = findNextOpenDay(byWeekday, parts.weekday);
    return {
      openNow: false,
      label: nextOpen ? `Cerrado · abre ${nextOpen}` : 'Cerrado hoy',
      reason: 'closed_today',
      todayRange,
    };
  }

  for (const [start, end] of intervals) {
    if (nowMinutes >= start && nowMinutes < end) {
      return {
        openNow: true,
        label: `Abierto · cierra ${timeFromMinutes(end)}`,
        reason: 'open',
        todayRange,
      };
    }
  }

  const firstStart = intervals[0][0];
  if (nowMinutes < firstStart) {
    return {
      openNow: false,
      label: `Cerrado · abre ${timeFromMinutes(firstStart)}`,
      reason: 'before_open',
      todayRange,
    };
  }

  const upcoming = intervals.find(([start]) => start > nowMinutes);
  if (upcoming) {
    return {
      openNow: false,
      label: `En pausa · vuelve ${timeFromMinutes(upcoming[0])}`,
      reason: 'on_break',
      todayRange,
    };
  }

  const nextOpen = findNextOpenDay(byWeekday, parts.weekday);
  return {
    openNow: false,
    label: nextOpen ? `Cerrado · abre ${nextOpen}` : 'Cerrado',
    reason: 'after_close',
    todayRange,
  };
}

function findNextOpenDay(byWeekday: Map<number, WeeklyHour>, fromWeekday: number): string | null {
  for (let offset = 1; offset <= 7; offset += 1) {
    const weekday = (fromWeekday + offset) % 7;
    const intervals = openIntervals(byWeekday.get(weekday));
    if (intervals.length > 0) {
      const label = offset === 1 ? 'mañana' : WEEKDAY_SHORT[weekday].toLowerCase();
      return `${label} ${timeFromMinutes(intervals[0][0])}`;
    }
  }
  return null;
}

/** Horario ordenado de lunes a domingo, como se lee en España. */
export function weekOrder(hours: WeeklyHour[]): WeeklyHour[] {
  const byWeekday = hoursByWeekday(hours);
  return [1, 2, 3, 4, 5, 6, 0].map(
    (weekday) =>
      byWeekday.get(weekday) ?? {
        weekday,
        isClosed: true,
        openTime: null,
        closeTime: null,
        breakStart: null,
        breakEnd: null,
      },
  );
}
