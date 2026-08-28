import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  minutesFromTime,
  timeFromMinutes,
  todayKey,
  weekdayOfKey,
  zonedParts,
  zonedTimeToUtc,
} from './time';

describe('zonedTimeToUtc', () => {
  it('convierte hora local de Madrid en invierno (UTC+1)', () => {
    expect(zonedTimeToUtc('2026-01-15', '09:30', 'Europe/Madrid').toISOString()).toBe(
      '2026-01-15T08:30:00.000Z',
    );
  });

  it('convierte hora local de Madrid en verano (UTC+2)', () => {
    expect(zonedTimeToUtc('2026-07-15', '09:30', 'Europe/Madrid').toISOString()).toBe(
      '2026-07-15T07:30:00.000Z',
    );
  });

  it('respeta Canarias, que va una hora por detrás de la península', () => {
    expect(zonedTimeToUtc('2026-07-15', '09:30', 'Atlantic/Canary').toISOString()).toBe(
      '2026-07-15T08:30:00.000Z',
    );
  });

  it('resuelve la madrugada del cambio de hora sin saltar de día', () => {
    // El 29-03-2026 España adelanta el reloj a las 02:00.
    const instant = zonedTimeToUtc('2026-03-29', '08:00', 'Europe/Madrid');
    expect(instant.toISOString()).toBe('2026-03-29T06:00:00.000Z');
    expect(zonedParts(instant, 'Europe/Madrid').dateKey).toBe('2026-03-29');
  });

  it('es reversible: la hora de pared vuelve a salir en la zona del taller', () => {
    const instant = zonedTimeToUtc('2026-11-02', '17:45', 'Europe/Madrid');
    const parts = zonedParts(instant, 'Europe/Madrid');
    expect(`${parts.hour}:${parts.minute}`).toBe('17:45');
  });
});

describe('utilidades de fecha', () => {
  it('devuelve la fecha del taller, no la del dispositivo', () => {
    // 23:30 UTC ya es el día siguiente en Madrid.
    const key = todayKey('Europe/Madrid', new Date('2026-05-10T23:30:00.000Z'));
    expect(key).toBe('2026-05-11');
  });

  it('suma días cruzando fin de mes', () => {
    expect(addDaysToKey('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('calcula el día de la semana con la misma base que business_hours', () => {
    // 2026-08-27 es jueves → 4.
    expect(weekdayOfKey('2026-08-27')).toBe(4);
    expect(weekdayOfKey('2026-08-30')).toBe(0);
  });

  it('convierte entre HH:MM y minutos', () => {
    expect(minutesFromTime('09:30')).toBe(570);
    expect(minutesFromTime(null)).toBeNull();
    expect(timeFromMinutes(570)).toBe('09:30');
    expect(timeFromMinutes(1440)).toBe('00:00');
  });
});
