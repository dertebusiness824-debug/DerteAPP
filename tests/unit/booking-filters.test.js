import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyTabFilter,
  bookingScheduledAt,
  localDateKey,
  parseAppointmentDate,
  shopTodayKey,
} from '../../public/js/booking-filters.js';

describe('booking-filters', () => {
  it('parses ISO, date-only and spaced timestamps into Date', () => {
    assert.equal(parseAppointmentDate('2026-08-08T10:30:00.000Z').toISOString(), '2026-08-08T10:30:00.000Z');
    assert.ok(parseAppointmentDate('2026-08-08') instanceof Date);
    assert.ok(parseAppointmentDate('2026-08-08 10:30:00') instanceof Date);
    assert.ok(parseAppointmentDate(1_723_113_000) instanceof Date); // seconds epoch
    assert.equal(parseAppointmentDate('not-a-date'), null);
  });

  it('reads booking.date when scheduled_at is missing', () => {
    const scheduled = bookingScheduledAt({ date: '2026-08-08', status: 'confirmed' });
    assert.ok(scheduled instanceof Date);
    assert.equal(localDateKey(scheduled, 'Europe/Madrid'), '2026-08-08');
  });

  it('computes shop-local calendar days (Madrid CEST)', () => {
    assert.equal(localDateKey('2026-08-07T23:30:00.000Z', 'Europe/Madrid'), '2026-08-08');
    assert.equal(localDateKey('2026-08-08T10:00:00.000Z', 'Europe/Madrid'), '2026-08-08');
  });

  it('Hoy prefers today rows, then falls back to recent confirmed', () => {
    const now = new Date('2026-08-08T16:00:00.000Z');
    const withToday = [
      { id: '1', status: 'confirmed', scheduled_at: '2026-08-08T08:00:00.000Z' },
      { id: '2', status: 'confirmed', scheduled_at: '2026-08-09T08:00:00.000Z' },
    ];
    assert.deepEqual(
      applyTabFilter(withToday, 'today', { timeZone: 'Europe/Madrid', now }).map((row) => row.id),
      ['1'],
    );

    const noToday = [
      { id: 'old', status: 'confirmed', scheduled_at: '2026-08-01T08:00:00.000Z' },
      { id: 'newer', status: 'confirmed', scheduled_at: '2026-08-05T08:00:00.000Z' },
      { id: 'done', status: 'completed', scheduled_at: '2026-08-06T08:00:00.000Z' },
    ];
    const fallback = applyTabFilter(noToday, 'today', { timeZone: 'Europe/Madrid', now });
    assert.deepEqual(
      fallback.map((row) => row.id),
      ['newer', 'old'],
    );
  });

  it('Hoy last-resort shows completed when no confirmed/active remain', () => {
    const now = new Date('2026-08-08T16:00:00.000Z');
    const rows = [
      { id: 'done', status: 'completed', scheduled_at: '2026-08-01T08:00:00.000Z' },
      { id: 'cancel', status: 'cancelled', scheduled_at: '2026-08-02T08:00:00.000Z' },
    ];
    assert.deepEqual(
      applyTabFilter(rows, 'today', { timeZone: 'Europe/Madrid', now }).map((row) => row.id),
      ['done'],
    );
  });

  it('Próximas lists all confirmed ascending (including past test bookings)', () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    const rows = [
      { id: 'b', status: 'confirmed', scheduled_at: '2026-08-10T10:00:00.000Z' },
      { id: 'a', status: 'confirmed', date: '2026-08-01T10:00:00.000Z' },
      { id: 'done', status: 'completed', scheduled_at: '2026-08-09T10:00:00.000Z' },
    ];
    const upcoming = applyTabFilter(rows, 'upcoming', { timeZone: 'Europe/Madrid', now });
    assert.deepEqual(
      upcoming.map((row) => row.id),
      ['a', 'b'],
    );
  });

  it('Completadas is status-only', () => {
    const rows = [
      { id: 'a', status: 'confirmed', scheduled_at: '2026-08-08T10:00:00.000Z' },
      { id: 'b', status: 'completed', scheduled_at: '2026-08-01T10:00:00.000Z' },
    ];
    const completed = applyTabFilter(rows, 'completed', { timeZone: 'Europe/Madrid' });
    assert.deepEqual(
      completed.map((row) => row.id),
      ['b'],
    );
  });

  it('Completadas + windowHours=24 keeps only recent completions', () => {
    const now = new Date('2026-08-08T16:00:00.000Z');
    const rows = [
      {
        id: 'old',
        status: 'completed',
        scheduled_at: '2026-08-01T10:00:00.000Z',
        updated_at: '2026-08-01T12:00:00.000Z',
      },
      {
        id: 'new',
        status: 'completed',
        scheduled_at: '2026-08-08T10:00:00.000Z',
        updated_at: '2026-08-08T12:00:00.000Z',
      },
      {
        id: 'open',
        status: 'confirmed',
        scheduled_at: '2026-08-08T11:00:00.000Z',
      },
    ];
    assert.deepEqual(
      applyTabFilter(rows, 'completed', { timeZone: 'Europe/Madrid', now, windowHours: 24 }).map(
        (row) => row.id,
      ),
      ['new'],
    );
  });

  it('Todas returns the full list without date/status filter', () => {
    const rows = [
      { id: '2', status: 'completed', scheduled_at: '2026-08-02T10:00:00.000Z' },
      { id: '1', status: 'confirmed', scheduled_at: '2026-08-01T10:00:00.000Z' },
      { id: '3', status: 'cancelled', scheduled_at: '2026-08-03T10:00:00.000Z' },
    ];
    const all = applyTabFilter(rows, 'all', { timeZone: 'Europe/Madrid' });
    assert.deepEqual(
      all.map((row) => row.id),
      ['1', '2', '3'],
    );
  });

  it('shopTodayKey matches localDateKey(now)', () => {
    const now = new Date('2026-08-08T22:30:00.000Z');
    assert.equal(shopTodayKey('Europe/Madrid', now), localDateKey(now, 'Europe/Madrid'));
  });
});
