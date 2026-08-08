import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  normalizeLocale,
  setLocale,
  t,
} from '../../public/js/i18n.js';

describe('i18n', () => {
  it('defaults to Spanish and lists supported locales', () => {
    assert.equal(DEFAULT_LOCALE, 'es');
    assert.deepEqual(LOCALE_CODES, ['es', 'en', 'ca', 'eu', 'gl']);
  });

  it('normalizes locale codes', () => {
    assert.equal(normalizeLocale('EN-us'), 'en');
    assert.equal(normalizeLocale('ca'), 'ca');
    assert.equal(normalizeLocale('xx'), 'es');
  });

  it('translates keys and falls back to Spanish', () => {
    setLocale('en', { silent: true });
    assert.equal(t('nav.home'), 'Home');
    assert.equal(t('appointments.title'), 'Bookings');
    assert.equal(t('gcal.connect'), 'Connect Google Calendar');

    setLocale('es', { silent: true });
    assert.equal(t('nav.home'), 'Inicio');
    assert.equal(t('appointments.call', { name: 'Ana' }), 'Llamar a Ana');

    setLocale('ca', { silent: true });
    assert.equal(t('nav.home'), 'Inici');
    // Missing Catalan keys fall back to Spanish.
    assert.equal(t('home.jobsToday'), 'Confirmadas hoy');
  });
});
