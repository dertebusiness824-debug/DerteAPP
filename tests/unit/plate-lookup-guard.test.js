import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createPlateLookupGuard,
  normalizeClientPlate,
  officialLookupSpent,
} from '../../public/js/plate-lookup-guard.js';

describe('createPlateLookupGuard', () => {
  it('normalizes plates the same way the finder does', () => {
    assert.equal(normalizeClientPlate('1234 bcd'), '1234BCD');
    assert.equal(normalizeClientPlate('1234-BCD'), '1234BCD');
  });

  it('blocks a second begin while a lookup is in flight', () => {
    const guard = createPlateLookupGuard();
    assert.equal(guard.begin('1234BCD').ok, true);
    assert.equal(guard.begin('1234BCD').reason, 'in_flight');
    assert.equal(guard.begin('9999ZZZ').reason, 'in_flight');
    guard.settle(false, '1234BCD');
    assert.equal(guard.begin('9999ZZZ').ok, true);
  });

  it('blocks the same plate after a spent lookup until the user edits', () => {
    const guard = createPlateLookupGuard();
    assert.equal(guard.begin('1234BCD').ok, true);
    guard.settle(true, '1234BCD');
    assert.equal(guard.begin('1234BCD').reason, 'already_consulted');
    guard.markEdited('1234BCE');
    assert.equal(guard.begin('1234BCD').ok, true);
  });

  it('allows a retry of the same plate after a retryable failure', () => {
    const guard = createPlateLookupGuard();
    assert.equal(guard.begin('1234BCD').ok, true);
    guard.settle(officialLookupSpent('timeout', false), '1234BCD');
    assert.equal(guard.begin('1234BCD').ok, true);
  });

  it('counts a found or not_found result as spent', () => {
    assert.equal(officialLookupSpent(null, true), true);
    assert.equal(officialLookupSpent('not_found', false), true);
    assert.equal(officialLookupSpent('quota_exceeded', false), true);
    assert.equal(officialLookupSpent('lookup_in_progress', false), false);
    assert.equal(officialLookupSpent('timeout', false), false);
  });
});
