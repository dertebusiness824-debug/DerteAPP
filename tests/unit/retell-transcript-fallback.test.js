import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractNameFromTranscript,
  extractSpanishPlateFromText,
} from '../../server/services/retell.js';
import {
  enrichVehicleLabelFromTranscript,
  extractCallAnalyzedFields,
  extractVehicleFromTranscript,
  isBrandOnlyVehicle,
} from '../../server/services/retell-gates.js';

describe('transcript field fallbacks', () => {
  it('extracts name from me llamo / soy / mi nombre es', () => {
    assert.equal(
      extractNameFromTranscript('User: Hola, me llamo José Manuel y necesito ayuda'),
      'José Manuel',
    );
    assert.equal(
      extractNameFromTranscript('User: Mi nombre es Ana Pérez\nAgent: Perfecto'),
      'Ana Pérez',
    );
    assert.equal(extractNameFromTranscript('User: Soy Laura Ruiz, tengo un pinchazo'), 'Laura Ruiz');
  });

  it('extracts Spanish plates (1234BCD)', () => {
    assert.equal(extractSpanishPlateFromText('La matrícula es 1234 BCD'), '1234BCD');
    assert.equal(extractSpanishPlateFromText('placa 9876XYZ por favor'), '9876XYZ');
    assert.equal(extractSpanishPlateFromText('sin placa dicha'), null);
  });

  it('enriches brand-only vehicle with model from transcript', () => {
    assert.equal(isBrandOnlyVehicle('Toyota'), true);
    assert.equal(isBrandOnlyVehicle('Toyota Yaris'), false);
    assert.equal(
      enrichVehicleLabelFromTranscript('Toyota', 'User: Tengo un Toyota Yaris que no arranca'),
      'Toyota Yaris',
    );
    assert.equal(
      extractVehicleFromTranscript('User: Es un Seat Ibiza del 2019'),
      'Seat Ibiza',
    );
  });

  it('fills name, model and plate from transcript when analysis is empty', () => {
    const extracted = extractCallAnalyzedFields(
      {
        call: {
          call_id: 'tx-1',
          duration_ms: 90_000,
          start_timestamp: Date.now() - 90_000,
          end_timestamp: Date.now(),
          transcript:
            'User: Hola, me llamo Carmen López. Tengo un Toyota Corolla, matrícula 4567FGH, no arranca.',
          call_analysis: {
            call_summary: 'The user called about brakes',
            custom_analysis_data: {
              vehiculo: 'Toyota',
              motivo: 'No arranca',
            },
          },
        },
      },
      {
        call_id: 'tx-1',
        duration_ms: 90_000,
        transcript:
          'User: Hola, me llamo Carmen López. Tengo un Toyota Corolla, matrícula 4567FGH, no arranca.',
        call_analysis: {
          call_summary: 'The user called about brakes',
          custom_analysis_data: {
            vehiculo: 'Toyota',
            motivo: 'No arranca',
          },
        },
      },
    );

    assert.equal(extracted.name, 'Carmen López');
    assert.equal(extracted.vehicle, 'Toyota Corolla');
    assert.equal(extracted.plate, '4567FGH');
    assert.equal(extracted.canCreateReserva, true);
  });
});
