import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractNameFromTranscript,
  extractReasonFromTranscript,
  extractSpanishPlateFromText,
  isGenericUrgenciaReason,
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

  it('extracts real motivo phrases from transcript', () => {
    assert.equal(
      extractReasonFromTranscript('User: Hola, no me arranca el coche esta mañana'),
      'No me arranca el coche',
    );
    assert.equal(
      extractReasonFromTranscript('User: Tengo los frenos rotos y no puedo circular'),
      'Tengo los frenos rotos',
    );
    assert.equal(extractReasonFromTranscript('User: Pierde aceite por debajo'), 'Pierde aceite');
    assert.equal(
      extractReasonFromTranscript('User: Se encendió el testigo de motor'),
      'Se encendió el testigo de motor',
    );
    assert.equal(
      extractReasonFromTranscript('User: Necesito un cambio de ruedas urgente'),
      'Necesito un cambio de ruedas',
    );
    assert.equal(isGenericUrgenciaReason('Consulta urgente'), true);
    assert.equal(isGenericUrgenciaReason('Consulta sobre avería'), true);
    assert.equal(isGenericUrgenciaReason('No arranca'), false);
  });

  it('fills name, model, plate and motivo from transcript when analysis is empty/generic', () => {
    const extracted = extractCallAnalyzedFields(
      {
        call: {
          call_id: 'tx-1',
          duration_ms: 90_000,
          start_timestamp: Date.now() - 90_000,
          end_timestamp: Date.now(),
          transcript:
            'User: Hola, me llamo Carmen López. Tengo un Toyota Corolla, matrícula 4567FGH, no me arranca el coche.',
          call_analysis: {
            call_summary: 'The user called about brakes',
            custom_analysis_data: {
              vehiculo: 'Toyota',
              motivo: 'Consulta urgente',
            },
          },
        },
      },
      {
        call_id: 'tx-1',
        duration_ms: 90_000,
        transcript:
          'User: Hola, me llamo Carmen López. Tengo un Toyota Corolla, matrícula 4567FGH, no me arranca el coche.',
        call_analysis: {
          call_summary: 'The user called about brakes',
          custom_analysis_data: {
            vehiculo: 'Toyota',
            motivo: 'Consulta urgente',
          },
        },
      },
    );

    assert.equal(extracted.name, 'Carmen López');
    assert.equal(extracted.vehicle, 'Toyota Corolla');
    assert.equal(extracted.plate, '4567FGH');
    assert.equal(extracted.reason, 'No me arranca el coche');
    assert.equal(extracted.canCreateReserva, true);
  });
});
