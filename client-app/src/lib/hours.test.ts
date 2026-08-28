import { describe, expect, it } from 'vitest';
import type { WeeklyHour } from '@/data/types';
import { formatRange, getOpenState, openIntervals, weekOrder } from './hours';

function day(
  weekday: number,
  openTime: string,
  closeTime: string,
  breakStart: string | null = null,
  breakEnd: string | null = null,
): WeeklyHour {
  return { weekday, isClosed: false, openTime, closeTime, breakStart, breakEnd };
}

function closed(weekday: number): WeeklyHour {
  return { weekday, isClosed: true, openTime: null, closeTime: null, breakStart: null, breakEnd: null };
}

/** Semana tipo: lunes a viernes con pausa de comida, sábado corto, domingo cerrado. */
const WEEK: WeeklyHour[] = [
  closed(0),
  ...[1, 2, 3, 4, 5].map((weekday) => day(weekday, '09:00', '19:00', '13:30', '15:00')),
  day(6, '09:00', '14:00'),
];

describe('openIntervals', () => {
  it('parte el día en dos tramos cuando hay pausa', () => {
    expect(openIntervals(WEEK[1])).toEqual([
      [540, 810],
      [900, 1140],
    ]);
  });

  it('no devuelve tramos si el taller cierra', () => {
    expect(openIntervals(closed(0))).toEqual([]);
    expect(openIntervals(undefined)).toEqual([]);
  });

  it('ignora una pausa incoherente en lugar de romper el horario', () => {
    expect(openIntervals(day(1, '09:00', '19:00', '20:00', '21:00'))).toEqual([[540, 1140]]);
  });
});

describe('getOpenState', () => {
  it('marca abierto dentro del tramo de mañana', () => {
    // Jueves 2026-08-27, 10:00 en Madrid.
    const state = getOpenState(WEEK, 'Europe/Madrid', new Date('2026-08-27T08:00:00.000Z'));
    expect(state.openNow).toBe(true);
    expect(state.label).toBe('Abierto · cierra 13:30');
  });

  it('detecta la pausa de comida', () => {
    const state = getOpenState(WEEK, 'Europe/Madrid', new Date('2026-08-27T12:00:00.000Z'));
    expect(state.openNow).toBe(false);
    expect(state.reason).toBe('on_break');
    expect(state.label).toBe('En pausa · vuelve 15:00');
  });

  it('avisa de la próxima apertura cuando ya ha cerrado', () => {
    const state = getOpenState(WEEK, 'Europe/Madrid', new Date('2026-08-27T20:00:00.000Z'));
    expect(state.openNow).toBe(false);
    expect(state.reason).toBe('after_close');
    expect(state.label).toBe('Cerrado · abre mañana 09:00');
  });

  it('salta el domingo cerrado y apunta al lunes', () => {
    const state = getOpenState(WEEK, 'Europe/Madrid', new Date('2026-08-30T10:00:00.000Z'));
    expect(state.reason).toBe('closed_today');
    expect(state.label).toBe('Cerrado · abre mañana 09:00');
    expect(state.todayRange).toBeNull();
  });

  it('usa la zona del taller y no la del navegador', () => {
    // 06:30 UTC son 08:30 en Madrid (aún cerrado) y 09:30 en Bucarest (abierto).
    const instant = new Date('2026-08-27T06:30:00.000Z');
    expect(getOpenState(WEEK, 'Europe/Madrid', instant).openNow).toBe(false);
    expect(getOpenState(WEEK, 'Europe/Bucharest', instant).openNow).toBe(true);
    // Y en Canarias (UTC+1) son las 07:30: sigue cerrado.
    expect(getOpenState(WEEK, 'Atlantic/Canary', instant).openNow).toBe(false);
  });

  it('informa cuando el taller no ha publicado horario', () => {
    expect(getOpenState([], 'Europe/Madrid').reason).toBe('unknown');
  });
});

describe('presentación del horario', () => {
  it('formatea el rango con y sin pausa', () => {
    expect(formatRange(WEEK[1])).toBe('09:00–13:30 · 15:00–19:00');
    expect(formatRange(WEEK[6])).toBe('09:00–14:00');
    expect(formatRange(closed(0))).toBeNull();
  });

  it('ordena la semana de lunes a domingo', () => {
    expect(weekOrder(WEEK).map((entry) => entry.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('completa los días que el taller no ha rellenado', () => {
    const partial = weekOrder([day(1, '09:00', '18:00')]);
    expect(partial).toHaveLength(7);
    expect(partial.filter((entry) => entry.isClosed)).toHaveLength(6);
  });
});
