import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fallbackAttendeeEmail } from '../../server/services/calcom.js';

describe('calcom helpers', () => {
  it('builds a stable fallback attendee email from phone + name', () => {
    const email = fallbackAttendeeEmail('+34655112233', 'María López');
    assert.match(email, /^marialopez\.\d+@bookings\.derteapp\.local$/);
  });

  it('falls back when name is empty', () => {
    const email = fallbackAttendeeEmail('+34999888777', '');
    assert.match(email, /^cliente\.\d+@bookings\.derteapp\.local$/);
  });
});
