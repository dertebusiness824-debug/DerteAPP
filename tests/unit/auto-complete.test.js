import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closingAutoCompleteThreshold } from '../../server/services/auto-complete.js';

describe('closingAutoCompleteThreshold', () => {
  it('returns close − 30 minutes for an open day', () => {
    const result = closingAutoCompleteThreshold(
      { is_closed: false, close_time: '19:00' },
      '2026-08-08',
      'Europe/Madrid',
    );
    assert.ok(result);
    assert.equal(result.closeMinutes, 19 * 60);
    assert.equal(result.thresholdMinutes, 18 * 60 + 30);
    assert.ok(result.thresholdAt instanceof Date);
  });

  it('returns null when the shop is closed', () => {
    assert.equal(
      closingAutoCompleteThreshold({ is_closed: true }, '2026-08-08', 'Europe/Madrid'),
      null,
    );
  });

  it('returns null without a close_time', () => {
    assert.equal(
      closingAutoCompleteThreshold({ is_closed: false, close_time: null }, '2026-08-08', 'Europe/Madrid'),
      null,
    );
  });
});
