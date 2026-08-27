/**
 * Utilidades de fecha/hora con zona horaria del taller.
 *
 * Los talleres publican su horario en hora local (`Europe/Madrid`,
 * `Atlantic/Canary`…) mientras que Supabase guarda instantes UTC, así que todas
 * las conversiones pasan por aquí en lugar de usar la zona del dispositivo.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo … 6 = sábado, igual que `business_hours.weekday`. */
  weekday: number;
  /** Fecha local en formato `YYYY-MM-DD`. */
  dateKey: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function partsFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Descompone un instante en la hora local de `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const year = Number(read('year'));
  const month = Number(read('month'));
  const day = Number(read('day'));
  // Intl devuelve 24 para la medianoche en algunos entornos.
  const hour = Number(read('hour')) % 24;
  const minute = Number(read('minute'));

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: WEEKDAY_INDEX[read('weekday')] ?? 0,
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
  };
}

/** Desplazamiento de `timeZone` respecto a UTC, en milisegundos, para ese instante. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const secondsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    second: '2-digit',
  });
  const seconds = Number(secondsFormatter.format(date)) || 0;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    seconds,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convierte una hora de pared (`2026-07-14`, `09:30`) de la zona del taller al
 * instante UTC equivalente.
 */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = Date.UTC(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0);
  // Dos pasadas: la primera puede caer en el lado equivocado de un cambio de hora.
  let instant = guess - timeZoneOffsetMs(new Date(guess), timeZone);
  instant = guess - timeZoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** Fecha de hoy (`YYYY-MM-DD`) en la zona del taller. */
export function todayKey(timeZone: string, now: Date = new Date()): string {
  return zonedParts(now, timeZone).dateKey;
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const base = Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  const next = new Date(base + days * 86_400_000);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** `HH:MM` → minutos desde medianoche. */
export function minutesFromTime(time: string | null | undefined): number | null {
  if (!time) return null;
  const [hour, minute] = time.split(':').map(Number);
  if (Number.isNaN(hour)) return null;
  return hour * 60 + (Number.isNaN(minute) ? 0 : minute);
}

/** Minutos desde medianoche → `HH:MM`. */
export function timeFromMinutes(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

export function weekdayOfKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)).getUTCDay();
}
