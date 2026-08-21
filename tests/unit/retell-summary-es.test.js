import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSpanishUrgenciaSummary,
  extractNameFromSummary,
  formatUrgenciaCustomerDisplayName,
  formatUrgenciaDisplaySummary,
  translateRetellSummaryToSpanish,
} from '../../server/services/retell.js';
import { normalizeExtractedFields } from '../../server/services/retell-gates.js';
import { serializeUrgencia } from '../../server/services/urgencias.js';

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
      'El cliente solicitó atención urgente para su vehículo (Seat León). Motivo: No arranca.',
    );
  });

  it('falls back to name-from-summary when building Spanish template', () => {
    const summary = buildSpanishUrgenciaSummary({
      name: null,
      vehicle: 'Volkswagen Golf',
      reason: 'Pinchazo',
      summary: 'The user, Laura Ruiz, llamó por un pinchazo',
    });
    assert.equal(
      summary,
      'El cliente solicitó atención urgente para su vehículo (Volkswagen Golf). Motivo: Pinchazo.',
    );
  });

  it('rewrites English Spanglish summaries with vehicle/motivo fallbacks', () => {
    const summary = formatUrgenciaDisplaySummary({
      vehicle: null,
      reason: null,
      summary: 'The user called about brakes on the coche make',
    });
    assert.equal(
      summary,
      'El cliente solicitó atención urgente para su vehículo (No especificado). Motivo: No especificado.',
    );
  });

  it('removes duplicated El cliente prefixes', () => {
    assert.equal(
      formatUrgenciaDisplaySummary({
        vehicle: 'Seat Ibiza',
        reason: 'Frenos',
        summary: 'El cliente El cliente llamó solicitando atención urgente',
      }),
      'El cliente solicitó atención urgente para su vehículo (Seat Ibiza). Motivo: Frenos.',
    );
  });

  it('maps placeholder customer names to Cliente por confirmar', () => {
    assert.equal(formatUrgenciaCustomerDisplayName('The user'), 'Cliente por confirmar');
    assert.equal(formatUrgenciaCustomerDisplayName('user'), 'Cliente por confirmar');
    assert.equal(formatUrgenciaCustomerDisplayName('Sin nombre'), 'Cliente por confirmar');
    assert.equal(formatUrgenciaCustomerDisplayName(''), 'Cliente por confirmar');
    assert.equal(formatUrgenciaCustomerDisplayName('Ana López'), 'Ana López');
  });

  it('serializes Spanglish rows into clean Spanish card fields', () => {
    const serialized = serializeUrgencia(
      {
        id: '11111111-1111-1111-1111-111111111111',
        shop_id: '22222222-2222-2222-2222-222222222222',
        status: 'pending',
        customer_name: 'The user',
        customer_phone: '+34655112233',
        vehicle_make: 'Seat',
        vehicle_model: 'Ibiza',
        reason: 'Frenos',
        summary: 'The user called about brakes',
        called_at: '2026-08-20T15:39:00.000Z',
        created_at: '2026-08-20T15:39:00.000Z',
      },
      { timezone: 'Atlantic/Canary' },
    );
    assert.equal(serialized.customer_name, 'Cliente por confirmar');
    assert.equal(serialized.called_local, '20/08/2026 16:39');
    assert.equal(
      serialized.summary,
      'El cliente solicitó atención urgente para su vehículo (Seat Ibiza). Motivo: Frenos.',
    );
  });
});
