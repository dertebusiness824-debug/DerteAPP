import { describe, expect, it } from 'vitest';
import {
  foldText,
  formatDateTime,
  formatPlate,
  formatPrice,
  formatPriceRange,
  formatRating,
  formatRelative,
  formatTime,
  normalizePlateForStorage,
  pluralize,
} from './format';

/** Intl separa el importe del símbolo con un espacio duro. */
const NBSP = '\u00a0';

describe('precios', () => {
  it('formatea en euros sin decimales', () => {
    expect(formatPrice(69)).toBe(`69${NBSP}€`);
    expect(formatPrice(null)).toBeNull();
  });

  it('describe el rango tal y como lo publica el taller', () => {
    expect(formatPriceRange(49, 79)).toBe(`49${NBSP}€ – 79${NBSP}€`);
    expect(formatPriceRange(49, null)).toBe(`Desde 49${NBSP}€`);
    expect(formatPriceRange(null, 120)).toBe(`Hasta 120${NBSP}€`);
    expect(formatPriceRange(null, null)).toBe('Presupuesto sin coste');
    expect(formatPriceRange(60, 60)).toBe(`Desde 60${NBSP}€`);
  });
});

describe('matrículas', () => {
  it('separa los grupos del formato español actual', () => {
    expect(formatPlate('1234abc')).toBe('1234 ABC');
    expect(formatPlate(' 1234-ABC ')).toBe('1234 ABC');
  });

  it('reconstruye el formato anterior con provincia', () => {
    expect(formatPlate('m1234ab')).toBe('M-1234-AB');
  });

  it('deja intacta una matrícula que no reconoce', () => {
    expect(formatPlate('gb 21 xyz 9')).toBe('GB 21 XYZ 9');
  });

  it('guarda siempre la versión compacta', () => {
    expect(normalizePlateForStorage('1234 abc')).toBe('1234ABC');
    expect(normalizePlateForStorage('M-1234-AB')).toBe('M1234AB');
  });
});

describe('fechas', () => {
  it('escribe la fecha en la zona del taller', () => {
    expect(formatDateTime('2026-08-28T07:00:00.000Z', 'Europe/Madrid')).toBe(
      'Viernes 28 de agosto · 09:00',
    );
  });

  it('la misma cita se lee una hora antes en Canarias', () => {
    expect(formatTime('2026-08-28T07:00:00.000Z', 'Atlantic/Canary')).toBe('08:00');
  });

  it('describe cuánto hace de un instante', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    expect(formatRelative('2026-08-27T11:58:00.000Z', now)).toBe('hace 2 min');
    expect(formatRelative('2026-08-27T09:00:00.000Z', now)).toBe('hace 3 h');
    expect(formatRelative('2026-08-25T12:00:00.000Z', now)).toBe('hace 2 días');
  });
});

describe('textos', () => {
  it('muestra la valoración con coma decimal', () => {
    expect(formatRating(4.5)).toBe('4,5');
    expect(formatRating(3.96)).toBe('4,0');
    expect(formatRating(0)).toBe('—');
  });

  it('concuerda el plural', () => {
    expect(pluralize(1, 'taller', 'talleres')).toBe('1 taller');
    expect(pluralize(4, 'taller', 'talleres')).toBe('4 talleres');
  });

  it('quita tildes para poder buscar sin acentos', () => {
    expect(foldText('  Neumáticos Gràcia ')).toBe('neumaticos gracia');
  });
});
