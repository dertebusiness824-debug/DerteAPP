import { describe, expect, it } from 'vitest';
import type { WeeklyHour } from '@/data/types';
import {
  buildAvailabilityCalendar,
  buildDayAvailability,
  firstDayWithAvailability,
  slotLoadMap,
  type AvailabilityShop,
} from './slots';

function day(
  weekday: number,
  openTime: string,
  closeTime: string,
  breakStart: string | null = null,
  breakEnd: string | null = null,
): WeeklyHour {
  return { weekday, isClosed: false, openTime, closeTime, breakStart, breakEnd };
}

const SHOP: AvailabilityShop = {
  timezone: 'Europe/Madrid',
  slotMinutes: 60,
  capacity: 2,
  minNoticeMinutes: 120,
  bookingHorizonDays: 30,
  hours: [
    { weekday: 0, isClosed: true, openTime: null, closeTime: null, breakStart: null, breakEnd: null },
    ...[1, 2, 3, 4, 5].map((weekday) => day(weekday, '09:00', '13:00')),
    day(6, '09:00', '11:00'),
  ],
};

// Jueves 2026-08-27, 06:00 UTC = 08:00 en Madrid.
const NOW = new Date('2026-08-27T06:00:00.000Z');

describe('buildDayAvailability', () => {
  it('genera un hueco por cada paso dentro del horario', () => {
    const availability = buildDayAvailability(SHOP, '2026-08-28', new Map(), NOW);
    expect(availability.slots.map((slot) => slot.time)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
    ]);
    expect(availability.isClosed).toBe(false);
  });

  it('convierte cada hueco al instante UTC del taller', () => {
    const availability = buildDayAvailability(SHOP, '2026-08-28', new Map(), NOW);
    expect(availability.slots[0].iso).toBe('2026-08-28T07:00:00.000Z');
  });

  it('bloquea los huecos que no cumplen la antelación mínima', () => {
    const availability = buildDayAvailability(SHOP, '2026-08-27', new Map(), NOW);
    const nine = availability.slots.find((slot) => slot.time === '09:00');
    const eleven = availability.slots.find((slot) => slot.time === '11:00');
    expect(nine?.available).toBe(false);
    expect(nine?.blockedReason).toBe('notice');
    expect(eleven?.available).toBe(true);
  });

  it('bloquea el hueco cuando la agenda del taller está completa', () => {
    const load = slotLoadMap([
      { slotStart: '2026-08-28T07:00:00.000Z', booked: 1 },
      { slotStart: '2026-08-28T07:00:00.000Z', booked: 1 },
    ]);
    const availability = buildDayAvailability(SHOP, '2026-08-28', load, NOW);
    const nine = availability.slots.find((slot) => slot.time === '09:00');
    expect(nine?.available).toBe(false);
    expect(nine?.blockedReason).toBe('full');
    expect(nine?.remaining).toBe(0);
  });

  it('deja libre el hueco mientras queda aforo', () => {
    const load = slotLoadMap([{ slotStart: '2026-08-28T07:00:00.000Z', booked: 1 }]);
    const nine = buildDayAvailability(SHOP, '2026-08-28', load, NOW).slots[0];
    expect(nine.available).toBe(true);
    expect(nine.remaining).toBe(1);
  });

  it('marca el día como cerrado y sin huecos', () => {
    const sunday = buildDayAvailability(SHOP, '2026-08-30', new Map(), NOW);
    expect(sunday.isClosed).toBe(true);
    expect(sunday.slots).toEqual([]);
    expect(sunday.availableCount).toBe(0);
  });

  it('reserva sitio para servicios más largos que el paso de agenda', () => {
    // Un servicio de 2 h no cabe en el último hueco antes del cierre.
    const availability = buildDayAvailability(SHOP, '2026-08-28', new Map(), NOW, 120);
    expect(availability.slots.map((slot) => slot.time)).toEqual(['09:00', '10:00', '11:00']);
  });

  it('salta la pausa de comida', () => {
    const shop: AvailabilityShop = {
      ...SHOP,
      hours: [day(5, '09:00', '19:00', '13:00', '15:00')],
    };
    // 2026-08-28 es viernes.
    const times = buildDayAvailability(shop, '2026-08-28', new Map(), NOW).slots.map(
      (slot) => slot.time,
    );
    expect(times).toContain('12:00');
    expect(times).not.toContain('13:00');
    expect(times).not.toContain('14:00');
    expect(times).toContain('15:00');
  });
});

describe('buildAvailabilityCalendar', () => {
  it('empieza hoy en la zona del taller y respeta el número de días', () => {
    const calendar = buildAvailabilityCalendar(SHOP, new Map(), { days: 5, now: NOW });
    expect(calendar).toHaveLength(5);
    expect(calendar[0].dateKey).toBe('2026-08-27');
    expect(calendar[4].dateKey).toBe('2026-08-31');
  });

  it('nunca ofrece más días que el horizonte publicado por el taller', () => {
    const calendar = buildAvailabilityCalendar(
      { ...SHOP, bookingHorizonDays: 3 },
      new Map(),
      { days: 14, now: NOW },
    );
    expect(calendar).toHaveLength(3);
  });

  it('preselecciona el primer día con hueco libre', () => {
    const calendar = buildAvailabilityCalendar(SHOP, new Map(), { days: 7, now: NOW });
    expect(firstDayWithAvailability(calendar)?.dateKey).toBe('2026-08-27');
  });

  it('salta al día siguiente cuando hoy ya está completo', () => {
    // Sábado 06:00 UTC: sólo quedan huecos con menos antelación de la exigida.
    const saturday = new Date('2026-08-29T07:30:00.000Z');
    const calendar = buildAvailabilityCalendar(SHOP, new Map(), { days: 7, now: saturday });
    expect(calendar[0].availableCount).toBe(0);
    expect(firstDayWithAvailability(calendar)?.dateKey).toBe('2026-08-31');
  });
});

describe('slotLoadMap', () => {
  it('agrega la ocupación por instante normalizado', () => {
    const map = slotLoadMap([
      { slotStart: '2026-08-28T07:00:00+00:00', booked: 1 },
      { slotStart: '2026-08-28T09:00:00.000Z', booked: 2 },
      { slotStart: '2026-08-28T07:00:00.000Z', booked: 3 },
    ]);
    expect(map.get('2026-08-28T07:00:00.000Z')).toBe(4);
    expect(map.get('2026-08-28T09:00:00.000Z')).toBe(2);
  });
});
