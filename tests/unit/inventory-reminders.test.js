import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANCHOR_FRIDAY,
  MONTHLY_REMINDER_DAY,
  REMINDER_HOUR_FROM,
  REMINDER_HOUR_UNTIL,
  calendarDate,
  dueReminders,
  isReminderFriday,
  monthKeyOf,
  shopCalendar,
} from '../../server/lib/inventory-reminders.js';

/** 11:00 in Madrid in January, i.e. comfortably inside the sending window. */
const at = (iso) => new Date(iso);
const MADRID = 'Europe/Madrid';

describe('isReminderFriday', () => {
  it('fires on the anchor Friday and every second Friday after it', () => {
    assert.equal(isReminderFriday(ANCHOR_FRIDAY), true);
    assert.equal(isReminderFriday('2026-01-16'), true);
    assert.equal(isReminderFriday('2026-01-30'), true);
    assert.equal(isReminderFriday('2026-02-13'), true);
  });

  it('skips the Fridays in between, which is what "every 14 days" means', () => {
    assert.equal(isReminderFriday('2026-01-09'), false);
    assert.equal(isReminderFriday('2026-01-23'), false);
    assert.equal(isReminderFriday('2026-02-06'), false);
  });

  it('never fires on another weekday', () => {
    assert.equal(isReminderFriday('2026-01-15'), false);
    assert.equal(isReminderFriday('2026-01-17'), false);
    assert.equal(isReminderFriday('2026-01-20'), false);
  });

  it('keeps the same rhythm before the anchor', () => {
    assert.equal(isReminderFriday('2025-12-19'), true);
    assert.equal(isReminderFriday('2025-12-26'), false);
  });

  it('ignores anything that is not a calendar date', () => {
    assert.equal(isReminderFriday('viernes'), false);
    assert.equal(isReminderFriday(''), false);
    assert.equal(isReminderFriday(null), false);
  });
});

describe('shopCalendar', () => {
  it('reads the day and the hour in the shop timezone, not the server one', () => {
    const instant = at('2026-01-16T23:30:00Z');

    const madrid = shopCalendar(instant, MADRID);
    assert.equal(madrid.today, '2026-01-17');
    assert.equal(madrid.hour, 0);

    // Same instant, one hour behind: still Friday for a shop in the Canaries.
    const canary = shopCalendar(instant, 'Atlantic/Canary');
    assert.equal(canary.today, '2026-01-16');
    assert.equal(canary.hour, 23);
  });

  it('exposes the month key used to send the monthly nudge once', () => {
    const { month_key: monthKey, day_of_month: day } = shopCalendar(at('2026-03-05T10:00:00Z'), MADRID);
    assert.equal(monthKey, '2026-03');
    assert.equal(day, 5);
    assert.equal(monthKeyOf('2026-03-05'), '2026-03');
  });
});

describe('calendarDate', () => {
  it('reads a DATE column as a calendar day whether pg returns text or a Date', () => {
    assert.equal(calendarDate('2026-01-16'), '2026-01-16');
    assert.equal(calendarDate('2026-01-16T00:00:00.000Z'), '2026-01-16');
    // A local-midnight Date, which is what node-pg builds for a DATE column.
    assert.equal(calendarDate(new Date(2026, 0, 16)), '2026-01-16');
  });

  it('is null when there is nothing recorded yet', () => {
    assert.equal(calendarDate(null), null);
    assert.equal(calendarDate(undefined), null);
    assert.equal(calendarDate('nunca'), null);
  });
});

describe('dueReminders', () => {
  it('sends both nudges on a reminder Friday of an untouched month', () => {
    const due = dueReminders({
      now: at('2026-01-16T10:00:00Z'),
      timeZone: MADRID,
      state: null,
      changesThisMonth: 0,
    });
    assert.equal(due.fortnightly, true);
    assert.equal(due.monthly, true);
    assert.equal(due.today, '2026-01-16');
    assert.equal(due.month_key, '2026-01');
    assert.equal(due.reason, null);
  });

  it('sends only the fortnightly one when the month already has movements', () => {
    const due = dueReminders({
      now: at('2026-01-16T10:00:00Z'),
      timeZone: MADRID,
      state: null,
      changesThisMonth: 7,
    });
    assert.equal(due.fortnightly, true);
    assert.equal(due.monthly, false);
  });

  it('sends only the monthly one on an ordinary day of an untouched month', () => {
    const due = dueReminders({
      now: at('2026-01-20T10:00:00Z'),
      timeZone: MADRID,
      state: null,
      changesThisMonth: 0,
    });
    assert.equal(due.fortnightly, false);
    assert.equal(due.monthly, true);
  });

  it('waits until mid-month, so "nothing this month" is not trivially true', () => {
    const early = dueReminders({
      now: at('2026-01-02T10:00:00Z'),
      timeZone: MADRID,
      state: null,
      changesThisMonth: 0,
    });
    assert.equal(early.monthly, false);
    // The 2nd is the anchor Friday, so the fortnightly nudge is unaffected.
    assert.equal(early.fortnightly, true);

    const onTheDay = dueReminders({
      now: at(`2026-01-${MONTHLY_REMINDER_DAY}T10:00:00Z`),
      timeZone: MADRID,
      state: null,
      changesThisMonth: 0,
    });
    assert.equal(onTheDay.monthly, true);
  });

  it('is silenced entirely by the owner kill switch', () => {
    const due = dueReminders({
      now: at('2026-01-16T10:00:00Z'),
      timeZone: MADRID,
      state: { reminders_enabled: false },
      changesThisMonth: 0,
    });
    assert.equal(due.fortnightly, false);
    assert.equal(due.monthly, false);
    assert.equal(due.reason, 'reminders_disabled');
  });

  it('stays quiet outside the sending window, since the sweep runs hourly', () => {
    const tooEarly = dueReminders({
      now: at('2026-01-16T05:00:00Z'),
      timeZone: MADRID,
      state: null,
      changesThisMonth: 0,
    });
    assert.equal(tooEarly.reason, 'outside_sending_hours');
    assert.equal(tooEarly.fortnightly, false);
    assert.equal(tooEarly.monthly, false);

    const tooLate = dueReminders({
      now: at('2026-01-16T21:00:00Z'),
      timeZone: MADRID,
      state: null,
      changesThisMonth: 0,
    });
    assert.equal(tooLate.reason, 'outside_sending_hours');

    assert.ok(REMINDER_HOUR_FROM < REMINDER_HOUR_UNTIL);
  });

  it('does not repeat a fortnightly nudge already sent today', () => {
    const due = dueReminders({
      now: at('2026-01-16T10:00:00Z'),
      timeZone: MADRID,
      state: { reminders_enabled: true, last_biweekly_notified_on: '2026-01-16' },
      changesThisMonth: 3,
    });
    assert.equal(due.fortnightly, false);
    assert.equal(due.reason, 'nothing_due');
  });

  it('sends again on the next reminder Friday', () => {
    const due = dueReminders({
      now: at('2026-01-30T10:00:00Z'),
      timeZone: MADRID,
      state: { reminders_enabled: true, last_biweekly_notified_on: '2026-01-16' },
      changesThisMonth: 3,
    });
    assert.equal(due.fortnightly, true);
  });

  it('sends the monthly nudge once per calendar month', () => {
    const state = { reminders_enabled: true, last_monthly_notified_month: '2026-01' };

    const sameMonth = dueReminders({
      now: at('2026-01-20T10:00:00Z'),
      timeZone: MADRID,
      state,
      changesThisMonth: 0,
    });
    assert.equal(sameMonth.monthly, false);

    const nextMonth = dueReminders({
      now: at('2026-02-20T10:00:00Z'),
      timeZone: MADRID,
      state,
      changesThisMonth: 0,
    });
    assert.equal(nextMonth.monthly, true);
  });
});
