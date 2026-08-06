import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  daysBetween,
  isValidTimeZone,
  minutesToTime,
  parseDateOnly,
  timeToMinutes,
  utcFromZoned,
  weekdayOfDate,
  zonedDateString,
  zonedTimeString,
} from '../../server/lib/time.js';

describe('timezone helpers', () => {
  it('validates timezone identifiers', () => {
    assert.equal(isValidTimeZone('Europe/Madrid'), true);
    assert.equal(isValidTimeZone('UTC'), true);
    assert.equal(isValidTimeZone('Mars/Olympus'), false);
    assert.equal(isValidTimeZone(''), false);
  });

  it('converts a shop wall clock to the right absolute instant in summer', () => {
    // Madrid is UTC+2 in August.
    const instant = utcFromZoned({ year: 2026, month: 8, day: 10, hour: 9, minute: 0 }, 'Europe/Madrid');
    assert.equal(instant.toISOString(), '2026-08-10T07:00:00.000Z');
  });

  it('converts a shop wall clock to the right absolute instant in winter', () => {
    // Madrid is UTC+1 in January.
    const instant = utcFromZoned({ year: 2026, month: 1, day: 12, hour: 9, minute: 0 }, 'Europe/Madrid');
    assert.equal(instant.toISOString(), '2026-01-12T08:00:00.000Z');
  });

  it('round-trips wall clocks across a DST transition', () => {
    // Spain springs forward at 02:00 on 2026-03-29.
    const before = utcFromZoned({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, 'Europe/Madrid');
    const after = utcFromZoned({ year: 2026, month: 3, day: 29, hour: 3, minute: 30 }, 'Europe/Madrid');
    assert.equal(zonedTimeString(before, 'Europe/Madrid'), '01:30');
    assert.equal(zonedTimeString(after, 'Europe/Madrid'), '03:30');
    assert.equal(after.getTime() - before.getTime(), 60 * 60 * 1000);
  });

  it('reports the shop-local calendar day, not the server day', () => {
    const lateEvening = new Date('2026-08-10T23:30:00.000Z');
    assert.equal(zonedDateString(lateEvening, 'Europe/Madrid'), '2026-08-11');
    assert.equal(zonedDateString(lateEvening, 'America/New_York'), '2026-08-10');
  });

  it('parses and formats times and dates', () => {
    assert.equal(timeToMinutes('09:30'), 570);
    assert.equal(timeToMinutes('13:00:00'), 780);
    assert.equal(timeToMinutes('bad'), null);
    assert.equal(timeToMinutes(null), null);
    assert.equal(minutesToTime(570), '09:30');
    assert.deepEqual(parseDateOnly('2026-08-10'), { year: 2026, month: 8, day: 10 });
    assert.equal(parseDateOnly('10/08/2026'), null);
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(daysBetween('2026-08-01', '2026-08-10'), 9);
    assert.equal(weekdayOfDate('2026-08-09'), 0, 'expected a Sunday');
  });
});
