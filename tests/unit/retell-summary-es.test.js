import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSpanishUrgenciaSummary,
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

  it('extracts name from "The user, José Manuel, llamó…" phrasing', () => {
    assert.equal(
      extractNameFromSummary(
        'The user, José Manuel, llamó a Talleres Melian para solicitar una cita urgente',
      ),
      'José Manuel',
    );
    assert.equal(
      extractNameFromSummary('The user, Ana Pérez, called the workshop due to a flat tire'),
      'Ana Pérez',
    );
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

  it('builds a Spanish template from extracted name/vehicle/reason', () => {
    const summary = buildSpanishUrgenciaSummary({
      name: 'José Manuel',
      vehicle: 'Seat León',
      reason: 'No arranca',
      summary: 'The user, José Manuel, called about a breakdown',
    });
    assert.equal(
      summary,
      'El cliente José Manuel solicitó asistencia urgente para su vehículo Seat León debido a No arranca.',
    );
  });

  it('falls back to name-from-summary when building Spanish template', () => {
    const summary = buildSpanishUrgenciaSummary({
      name: null,
      vehicle: 'Volkswagen Golf',
      reason: 'Pinchazo',
      summary: 'The user, Laura Ruiz, llamó por un pinchazo',
    });
    assert.match(summary, /El cliente Laura Ruiz/);
    assert.match(summary, /Volkswagen Golf/);
    assert.match(summary, /Pinchazo/);
  });
});
