import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatUrgenciaCanaryDateTime } from '../../public/js/views/urgencias.js';

describe('urgencia Canary datetime', () => {
  it('formats created_at as short date + 24h time in Atlantic/Canary', () => {
    // 2026-06-14 17:40 UTC → 18:40 in Canary (WEST, UTC+1 in June)
    const label = formatUrgenciaCanaryDateTime({
      created_at: '2026-06-14T17:40:00.000Z',
    });
    assert.match(label, /14\/6\/2026/);
    assert.match(label, /18:40/);
    assert.equal(label.includes(','), false);
  });

  it('falls back to called_at when created_at is missing', () => {
    const label = formatUrgenciaCanaryDateTime({
      called_at: '2026-01-10T12:05:00.000Z',
    });
    assert.match(label, /10\/1\/2026/);
    assert.match(label, /12:05/);
  });

  it('returns empty string for invalid input', () => {
    assert.equal(formatUrgenciaCanaryDateTime({}), '');
    assert.equal(formatUrgenciaCanaryDateTime({ created_at: 'not-a-date' }), '');
  });
});
