import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyTabFilter,
  localDateKey,
  parseAppointmentDate,
  shopTodayKey,
} from '../../public/js/booking-filters.js';

describe('booking-filters', () => {
  it('parses ISO timestamps', () => {
    const date = parseAppointmentDate('2026-08-08T10:30:00.000Z');
    assert.ok(date instanceof Date);
    assert.equal(date.toISOString(), '2026-08-08T10:30:00.000Z');
    assert.equal(parseAppointmentDate('not-a-date'), null);
  });

  it('computes shop-local calendar days (Madrid CEST)', () => {
    // 23:30 UTC on Aug 7 is 01:30 on Aug 8 in Europe/Madrid (CEST).
    assert.equal(localDateKey('2026-08-07T23:30:00.000Z', 'Europe/Madrid'), '2026-08-08');
    assert.equal(localDateKey('2026-08-08T10:00:00.000Z', 'Europe/Madrid'), '2026-08-08');
  });

  it('filters Hoy by calendar day ignoring clock time', () => {
    const now = new Date('2026-08-08T16:00:00.000Z'); // 18:00 Madrid
    const rows = [
      { id: '1', status: 'confirmed', scheduled_at: '2026-08-08T08:00:00.000Z' },
      { id: '2', status: 'completed', scheduled_at: '2026-08-08T17:00:00.000Z' },
      { id: '3', status: 'confirmed', scheduled_at: '2026-08-09T08:00:00.000Z' },
    ];
    const today = applyTabFilter(rows, 'today', { timeZone: 'Europe/Madrid', now });
    assert.deepEqual(
      today.map((row) => row.id),
      ['1', '2'],
    );
  });

  it('filters Próximas to future confirmed only', () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    const rows = [
      { id: 'past', status: 'confirmed', scheduled_at: '2026-08-08T10:00:00.000Z' },
      { id: 'future', status: 'confirmed', scheduled_at: '2026-08-08T15:00:00.000Z' },
      { id: 'done', status: 'completed', scheduled_at: '2026-08-08T16:00:00.000Z' },
      { id: 'progress', status: 'in_progress', scheduled_at: '2026-08-08T18:00:00.000Z' },
    ];
    const upcoming = applyTabFilter(rows, 'upcoming', { timeZone: 'Europe/Madrid', now });
    assert.deepEqual(
      upcoming.map((row) => row.id),
      ['future'],
    );
  });

  it('filters Completadas by status', () => {
    const rows = [
      { id: 'a', status: 'confirmed', scheduled_at: '2026-08-08T10:00:00.000Z' },
      { id: 'b', status: 'completed', scheduled_at: '2026-08-01T10:00:00.000Z' },
    ];
    const completed = applyTabFilter(rows, 'completed', { timeZone: 'Europe/Madrid' });
    assert.equal(completed.length, 1);
    assert.equal(completed[0].id, 'b');
  });

  it('shopTodayKey matches localDateKey(now)', () => {
    const now = new Date('2026-08-08T22:30:00.000Z');
    assert.equal(shopTodayKey('Europe/Madrid', now), localDateKey(now, 'Europe/Madrid'));
  });
});
