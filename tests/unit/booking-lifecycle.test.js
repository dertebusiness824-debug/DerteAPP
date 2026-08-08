import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyClosingAutoComplete,
  canCancelAppointment,
  isPastClosingAutoComplete,
} from '../../public/js/booking-lifecycle.js';

describe('booking-lifecycle client helpers', () => {
  it('detects close − 30 minutes threshold', () => {
    const before = new Date('2026-08-08T16:00:00.000Z'); // 18:00 Madrid (CEST)
    const after = new Date('2026-08-08T16:40:00.000Z'); // 18:40 Madrid
    assert.equal(
      isPastClosingAutoComplete('19:00', { timeZone: 'Europe/Madrid', now: before }),
      false,
    );
    assert.equal(
      isPastClosingAutoComplete('19:00', { timeZone: 'Europe/Madrid', now: after }),
      true,
    );
  });

  it('marks today confirmed bookings completed after the threshold', () => {
    const now = new Date('2026-08-08T16:40:00.000Z');
    const [decorated] = applyClosingAutoComplete(
      [
        {
          id: 'a1',
          status: 'confirmed',
          scheduled_at: '2026-08-08T10:00:00.000Z',
          allowed_transitions: ['cancelled', 'completed'],
        },
      ],
      { closeTime: '19:00', timeZone: 'Europe/Madrid', now },
    );
    assert.equal(decorated.status, 'completed');
    assert.equal(decorated._autoCompleted, true);
    assert.equal(canCancelAppointment(decorated), false);
  });

  it('keeps Cancel visible before the threshold', () => {
    const now = new Date('2026-08-08T15:00:00.000Z'); // 17:00 Madrid
    const [decorated] = applyClosingAutoComplete(
      [
        {
          id: 'a1',
          status: 'confirmed',
          scheduled_at: '2026-08-08T10:00:00.000Z',
          allowed_transitions: ['cancelled', 'completed'],
        },
      ],
      { closeTime: '19:00', timeZone: 'Europe/Madrid', now },
    );
    assert.equal(decorated.status, 'confirmed');
    assert.equal(canCancelAppointment(decorated), true);
  });
});
