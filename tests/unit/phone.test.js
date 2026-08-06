import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPhone, maskPhone, normalizePhone, telLink, whatsappLink } from '../../server/lib/phone.js';

describe('phone normalisation', () => {
  it('accepts common human formats and stores E.164', () => {
    assert.equal(normalizePhone('+34 600 111 222'), '+34600111222');
    assert.equal(normalizePhone('+1 (555) 010-1234'), '+15550101234');
    assert.equal(normalizePhone('00351910222333'), '+351910222333');
    assert.equal(normalizePhone('+44-207-123-4567'), '+442071234567');
  });

  it('rejects anything that cannot be an international number', () => {
    for (const value of ['', '   ', '12345', '+0600111222', 'not a phone', null, undefined, '+3460011122233344']) {
      assert.equal(normalizePhone(value), null, `expected ${JSON.stringify(value)} to be rejected`);
    }
  });

  it('refuses a local number when no country is known', () => {
    // Guessing here would store a number nobody can call back.
    assert.equal(normalizePhone('600 111 222'), null);
    assert.equal(normalizePhone('07123 456789'), null);
  });

  it('applies the shop country code to a local number on a booking form', () => {
    assert.equal(normalizePhone('600 111 222', { defaultCountryCode: '34' }), '+34600111222');
    assert.equal(normalizePhone('07123456789', { defaultCountryCode: '44' }), '+447123456789');
  });

  it('does not double up a country code the customer already typed', () => {
    assert.equal(normalizePhone('34600111222', { defaultCountryCode: '34' }), '+34600111222');
    assert.equal(normalizePhone('+34600111222', { defaultCountryCode: '34' }), '+34600111222');
    // A 9-digit national number that merely starts with "34" is still national.
    assert.equal(normalizePhone('341234567', { defaultCountryCode: '34' }), '+34341234567');
  });

  it('formats for display using real country-code lengths', () => {
    assert.equal(formatPhone('+34600111222'), '+34 600 111 222');
    assert.equal(formatPhone('+351910222333'), '+351 910 222 333');
    assert.equal(formatPhone('+15550101234'), '+1 555 010 1234');
    assert.equal(formatPhone('+79161234567'), '+7 916 123 4567');
  });

  it('builds tappable call and WhatsApp links', () => {
    assert.equal(telLink('+34600111222'), 'tel:+34600111222');
    assert.equal(whatsappLink('+34600111222'), 'https://wa.me/34600111222');
    assert.equal(
      whatsappLink('+34600111222', 'Hi there'),
      'https://wa.me/34600111222?text=Hi%20there',
    );
    assert.equal(telLink('nonsense'), null);
    assert.equal(whatsappLink('nonsense'), null);
  });

  it('masks numbers for logs', () => {
    assert.equal(maskPhone('+34600111222'), '+346******22');
  });
});
