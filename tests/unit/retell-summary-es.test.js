import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractNameFromSummary,
  translateRetellSummaryToSpanish,
} from '../../server/services/retell.js';
import { normalizeExtractedFields } from '../../server/services/retell-gates.js';

describe('Retell summary name + Spanish translation', () => {
  it('extracts the caller name from English/Spanish summaries', () => {
    assert.equal(
      extractNameFromSummary('Juan Diego called Talleres Melian to request an urgent appointment'),
      'Juan Diego',
    );
    assert.equal(
      extractNameFromSummary('María López llamó a Talleres Melian para solicitar una cita urgente'),
      'María López',
    );
    assert.equal(extractNameFromSummary('The caller asked for help'), null);
  });

  it('reads car_plate as plate alias', () => {
    assert.equal(
      normalizeExtractedFields({ car_plate: '1234ABC', nombre: 'Ana' }).plate,
      '1234ABC',
    );
  });

  it('translates common Retell English summary phrases to Spanish', () => {
    const translated = translateRetellSummaryToSpanish(
      'Juan Diego called Talleres Melian to request an urgent appointment due to engine noise',
    );
    assert.match(translated, /llamó/);
    assert.match(translated, /cita urgente/);
    assert.match(translated, /debido a/);
    assert.match(translated, /ruido en el motor|motor/);
    assert.equal(/\bcalled\b/i.test(translated), false);
  });
});
