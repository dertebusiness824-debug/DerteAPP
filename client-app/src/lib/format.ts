/** Formateo en español (es-ES) para precios, fechas y matrículas. */
import { WEEKDAY_LABELS } from './hours';
import { zonedParts } from './time';

const euro = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export function formatPrice(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return euro.format(value);
}

/** «Desde 49 €», «49 – 79 €», «Presupuesto sin coste». */
export function formatPriceRange(
  from: number | null | undefined,
  to: number | null | undefined,
): string {
  const low = formatPrice(from);
  const high = formatPrice(to);
  if (low && high && from !== to) return `${low} – ${high}`;
  if (low) return `Desde ${low}`;
  if (high) return `Hasta ${high}`;
  return 'Presupuesto sin coste';
}

export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const parts = zonedParts(date, timeZone);
  const day = new Intl.DateTimeFormat('es-ES', {
    timeZone,
    day: 'numeric',
    month: 'long',
  }).format(date);
  return `${WEEKDAY_LABELS[parts.weekday]} ${day} · ${String(parts.hour).padStart(2, '0')}:${String(
    parts.minute,
  ).padStart(2, '0')}`;
}

export function formatShortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    day: '2-digit',
    month: 'short',
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** «hace 5 min», «hace 3 h», «hace 2 días». */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const months = Math.round(days / 30);
  return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
}

/**
 * Matrícula lista para leer: «1234abc» → «1234 ABC».
 *
 * Solo separa los grupos cuando reconoce el formato español (actual o el
 * anterior con provincia); cualquier otra cosa se muestra tal cual, en
 * mayúsculas, para no estropear matrículas extranjeras.
 */
export function formatPlate(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[\s-]+/g, '');

  const current = /^(\d{4})([A-Z]{3})$/.exec(compact);
  if (current) return `${current[1]} ${current[2]}`;

  const legacy = /^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/.exec(compact);
  if (legacy) return `${legacy[1]}-${legacy[2]}-${legacy[3]}`;

  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizePlateForStorage(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function formatRating(value: number): string {
  return value > 0 ? value.toFixed(1).replace('.', ',') : '—';
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Quita acentos y pasa a minúsculas para poder buscar sin tildes. */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
