import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatPlate, isValidPlate, normalizePlate, parsePlate } from '../../server/lib/plates.js';

describe('normalizePlate', () => {
  it('strips separators and case so one car has one storage key', () => {
    assert.equal(normalizePlate('1234 BCD'), '1234BCD');
    assert.equal(normalizePlate('1234-bcd'), '1234BCD');
    assert.equal(normalizePlate(' 1234bcd '), '1234BCD');
    assert.equal(normalizePlate('M-1234-AB'), 'M1234AB');
  });

  it('returns null for anything with no plate in it', () => {
    assert.equal(normalizePlate(''), null);
    assert.equal(normalizePlate('   '), null);
    assert.equal(normalizePlate(null), null);
    assert.equal(normalizePlate(undefined), null);
  });
});

describe('formatPlate', () => {
  it('spaces national and provincial plates the way they are written', () => {
    assert.equal(formatPlate('1234bcd'), '1234 BCD');
    assert.equal(formatPlate('M1234AB'), 'M 1234 AB');
  });

  it('leaves an unrecognised plate untouched beyond normalising it', () => {
    assert.equal(formatPlate('foo-99'), 'FOO99');
    assert.equal(formatPlate(''), null);
  });
});

describe('parsePlate', () => {
  it('reads the national format and its 2000 floor', () => {
    const parsed = parsePlate('1234 BCD');
    assert.equal(parsed.plate, '1234BCD');
    assert.equal(parsed.valid, true);
    assert.equal(parsed.format, 'national');
    assert.equal(parsed.display, '1234 BCD');
    assert.equal(parsed.series, 'BCD');
    assert.equal(parsed.registered_after, 2000);
    assert.equal(parsed.province, null);
  });

  it('rejects vowels and Q, which the national series never uses', () => {
    assert.equal(parsePlate('1234 ABC').valid, false);
    assert.equal(parsePlate('1234 BQD').valid, false);
    assert.equal(parsePlate('1234 BCD').valid, true);
  });

  it('reads a provincial plate and names the province', () => {
    const parsed = parsePlate('M 1234 AB');
    assert.equal(parsed.format, 'provincial');
    assert.equal(parsed.valid, true);
    assert.equal(parsed.province, 'Madrid');
    assert.equal(parsed.province_code, 'M');
    assert.equal(parsed.registered_before, 2001);
    assert.equal(parsePlate('BI 4321 CD').province, 'Bizkaia');
    assert.equal(parsePlate('PM 1111 AA').province, 'Illes Balears');
  });

  it('does not accept an invented province code', () => {
    const parsed = parsePlate('XX 1234 AB');
    assert.equal(parsed.valid, false);
    assert.equal(parsed.format, 'unknown');
  });

  it('recognises trailer plates so a trailer is not reported as junk', () => {
    const parsed = parsePlate('R1234BCD');
    assert.equal(parsed.format, 'trailer');
    assert.equal(parsed.valid, true);
  });

  it('always reports the normalised plate, even when the format is unknown', () => {
    const parsed = parsePlate('abc 123');
    assert.equal(parsed.plate, 'ABC123');
    assert.equal(parsed.valid, false);
    assert.equal(parsed.format, 'unknown');
  });

  it('reports no plate at all rather than an invalid one', () => {
    assert.deepEqual(parsePlate(''), { plate: null, valid: false, format: 'unknown', display: null });
  });

  it('never guesses a year: a plate only bounds the registration date', () => {
    const national = parsePlate('1234 BCD');
    const provincial = parsePlate('M 1234 AB');
    assert.equal('year' in national, false);
    assert.equal('year' in provincial, false);
  });
});

describe('isValidPlate', () => {
  it('is the boolean shorthand of parsePlate', () => {
    assert.equal(isValidPlate('1234 BCD'), true);
    assert.equal(isValidPlate('M 1234 AB'), true);
    assert.equal(isValidPlate('nope'), false);
  });
});
