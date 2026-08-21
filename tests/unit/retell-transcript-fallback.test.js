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
  takeVehicleModelWords,
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

  it('captures brand + up to 3 model words and strips connectors', () => {
    assert.equal(takeVehicleModelWords('Sandero al taller'), 'Sandero');
    assert.equal(takeVehicleModelWords('Sandero Stepway que no arranca'), 'Sandero Stepway');
    assert.equal(isBrandOnlyVehicle('Dacia'), true);
    assert.equal(
      extractVehicleFromTranscript('User: Tengo un Dacia Sandero al taller'),
      'Dacia Sandero',
    );
    assert.equal(
      extractVehicleFromTranscript('User: Es un Toyota Corolla Hybrid de 2020'),
      'Toyota Corolla Hybrid',
    );
    assert.equal(
      extractVehicleFromTranscript('User: Es un Seat Ibiza del 2019'),
      'Seat Ibiza',
    );
    assert.equal(
      enrichVehicleLabelFromTranscript('Dacia', 'User: Llevo el Dacia Sandero Stepway'),
      'Dacia Sandero Stepway',
    );
    assert.equal(
      enrichVehicleLabelFromTranscript('Toyota', 'User: Tengo un Toyota Yaris que no arranca'),
      'Toyota Yaris',
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
    assert.equal(isGenericUrgenciaReason('No especificado'), true);
    assert.equal(isGenericUrgenciaReason('No arranca'), false);
  });

  it('takes the user reply after the agent asks for motivo/avería', () => {
    const transcript = [
      'Agent: Hola, ¿en qué puedo ayudarte?',
      'User: Quiero una cita urgente',
      'Agent: ¿Cuál es el motivo o la avería?',
      'User: Se me ha parado el coche en la carretera',
      'Agent: De acuerdo',
    ].join('\n');
    assert.equal(extractReasonFromTranscript(transcript), 'Se ha parado el coche');
  });

  it('fills name, model, plate and motivo from transcript when analysis is empty/generic', () => {
    const extracted = extractCallAnalyzedFields(
      {
        call: {
          call_id: 'tx-1',
          duration_ms: 90_000,
          start_timestamp: Date.now() - 90_000,
          end_timestamp: Date.now(),
          transcript: [
            'User: Hola, me llamo Carmen López.',
            'Agent: ¿Qué vehículo tienes?',
            'User: Un Dacia Sandero al taller, matrícula 4567FGH.',
            'Agent: ¿Cuál es el motivo de la avería?',
            'User: No me arranca el coche.',
          ].join('\n'),
          call_analysis: {
            call_summary: 'The user called about brakes',
            custom_analysis_data: {
              vehiculo: 'Dacia',
              motivo: 'No especificado',
            },
          },
        },
      },
      {
        call_id: 'tx-1',
        duration_ms: 90_000,
        transcript: [
          'User: Hola, me llamo Carmen López.',
          'Agent: ¿Qué vehículo tienes?',
          'User: Un Dacia Sandero al taller, matrícula 4567FGH.',
          'Agent: ¿Cuál es el motivo de la avería?',
          'User: No me arranca el coche.',
        ].join('\n'),
        call_analysis: {
          call_summary: 'The user called about brakes',
          custom_analysis_data: {
            vehiculo: 'Dacia',
            motivo: 'No especificado',
          },
        },
      },
    );

    assert.equal(extracted.name, 'Carmen López');
    assert.equal(extracted.vehicle, 'Dacia Sandero');
    assert.equal(extracted.plate, '4567FGH');
    assert.equal(extracted.reason, 'No me arranca el coche');
    assert.equal(extracted.canCreateReserva, true);
  });
});
