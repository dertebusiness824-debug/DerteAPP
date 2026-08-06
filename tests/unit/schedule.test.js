import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultWeeklyHours,
  normalizeDayRule,
  resolveDayRule,
  slotStartsForDay,
} from '../../server/services/schedule.js';

describe('opening hours validation', () => {
  it('normalises an open day', () => {
    const rule = normalizeDayRule({
      weekday: '1',
      open_time: '9:00',
      close_time: '18:00',
      break_start: '13:00',
      break_end: '14:00',
    });
    assert.deepEqual(rule, {
      weekday: 1,
      is_closed: false,
      open_time: '09:00',
      close_time: '18:00',
      break_start: '13:00',
      break_end: '14:00',
    });
  });

  it('clears times on a day off', () => {
    const rule = normalizeDayRule({ weekday: 0, is_closed: true, open_time: '09:00', close_time: '18:00' });
    assert.equal(rule.is_closed, true);
    assert.equal(rule.open_time, null);
    assert.equal(rule.close_time, null);
  });

  it('rejects impossible hours', () => {
    assert.throws(() => normalizeDayRule({ weekday: 9, open_time: '09:00', close_time: '18:00' }), /weekday/);
    assert.throws(() => normalizeDayRule({ weekday: 1 }), /required/);
    assert.throws(
      () => normalizeDayRule({ weekday: 1, open_time: '18:00', close_time: '09:00' }),
      /close_time must be after open_time/,
    );
    assert.throws(
      () => normalizeDayRule({ weekday: 1, open_time: '09:00', close_time: '18:00', break_start: '13:00' }),
      /both a start and an end/,
    );
    assert.throws(
      () =>
        normalizeDayRule({
          weekday: 1,
          open_time: '09:00',
          close_time: '18:00',
          break_start: '20:00',
          break_end: '21:00',
        }),
      /inside the opening hours/,
    );
  });
});

describe('effective day rule', () => {
  const weekly = defaultWeeklyHours();

  it('uses the weekly rule when there is no exception', () => {
    const rule = resolveDayRule('2026-08-10', weekly); // Monday
    assert.equal(rule.is_closed, false);
    assert.equal(rule.open_time, '09:00');
    assert.equal(rule.source, 'weekly');
  });

  it('treats the configured day off as closed', () => {
    const rule = resolveDayRule('2026-08-09', weekly); // Sunday
    assert.equal(rule.is_closed, true);
  });

  it('lets a holiday exception close an otherwise open day', () => {
    const exceptions = new Map([['2026-08-10', { exception_date: '2026-08-10', is_closed: true, note: 'Holiday' }]]);
    const rule = resolveDayRule('2026-08-10', weekly, exceptions);
    assert.equal(rule.is_closed, true);
    assert.equal(rule.note, 'Holiday');
    assert.equal(rule.source, 'exception');
  });

  it('lets an exception override the hours of a closed day', () => {
    const exceptions = new Map([
      ['2026-08-09', { exception_date: '2026-08-09', is_closed: false, open_time: '10:00', close_time: '14:00' }],
    ]);
    const rule = resolveDayRule('2026-08-09', weekly, exceptions);
    assert.equal(rule.is_closed, false);
    assert.equal(rule.open_time, '10:00');
    assert.equal(rule.close_time, '14:00');
  });
});

describe('slot generation', () => {
  const openDay = {
    is_closed: false,
    open_time: '09:00',
    close_time: '18:00',
    break_start: '13:00',
    break_end: '14:00',
  };

  it('skips slots that overlap the break and never runs past closing', () => {
    const starts = slotStartsForDay(openDay, { slotMinutes: 60, durationMinutes: 60 });
    assert.deepEqual(starts, [540, 600, 660, 720, 840, 900, 960, 1020]);
    // 13:00 (780) is the break, 18:00 (1080) would end after closing.
    assert.ok(!starts.includes(780));
    assert.ok(!starts.includes(1080));
  });

  it('accounts for jobs longer than one slot', () => {
    const starts = slotStartsForDay(openDay, { slotMinutes: 60, durationMinutes: 120 });
    // 11:00 finishes exactly as the break starts, so it stays available; 12:00
    // would run into the break and 17:00 past closing, so both are dropped.
    assert.deepEqual(starts, [540, 600, 660, 840, 900, 960]);
    assert.ok(!starts.includes(720));
    assert.ok(!starts.includes(1020));
  });

  it('supports fine-grained slots', () => {
    const starts = slotStartsForDay(
      { is_closed: false, open_time: '09:00', close_time: '10:00' },
      { slotMinutes: 15, durationMinutes: 30 },
    );
    assert.deepEqual(starts, [540, 555, 570]);
  });

  it('returns nothing for a closed day', () => {
    assert.deepEqual(slotStartsForDay({ is_closed: true }, { slotMinutes: 60, durationMinutes: 60 }), []);
  });
});
