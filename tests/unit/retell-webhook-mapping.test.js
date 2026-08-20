import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateUrgenciaGates,
  extractCallAnalyzedFields,
  extractFlexibleAnalysisData,
  extractRawVehicle,
  extractRetellCustomData,
  extractVehicleFromTranscript,
  getCustomField,
  getPostCallCustomData,
  hasValidVehicle,
  isValidVehicleValue,
  mapCustomAnalysisFields,
  mapCustomAnalysisFieldsFromPayload,
  normalizeExtractedFields,
} from '../../server/routes/webhooks.js';

describe('Retell webhook call_analyzed mapping', () => {
  it('maps nombre/vehiculo/matricula/motivo with defaults', () => {
    assert.deepEqual(mapCustomAnalysisFields({}), {
      nombre: 'Sin nombre',
      vehiculo: 'Sin vehículo',
      matricula: 'Sin matrícula',
      motivo: 'Consulta urgente',
    });
    assert.deepEqual(
      mapCustomAnalysisFields({
        nombre: 'Luis',
        vehiculo: 'Golf',
        matricula: '1234ABC',
        motivo: 'No arranca',
      }),
      {
        nombre: 'Luis',
        vehiculo: 'Golf',
        matricula: '1234ABC',
        motivo: 'No arranca',
      },
    );
  });

  it('extracts analysis from every nesting and normalizes ES/EN aliases', () => {
    const topLevelOnCall = {
      call: {
        duration_ms: 90_000,
        custom_analysis_data: {
          nombre: 'Ana',
          vehiculo: 'Golf',
          matricula: '1111AAA',
          motivo: 'ITV',
        },
      },
    };
    assert.deepEqual(normalizeExtractedFields(extractFlexibleAnalysisData(topLevelOnCall)), {
      name: 'Ana',
      vehicle: 'Golf',
      plate: '1111AAA',
      reason: 'ITV',
    });

    const bodyLevel = {
      custom_analysis_data: { name: 'Bob', car: 'Ibiza', plate: '2222BBB', reason: 'Humos' },
      call: { duration_ms: 50_000 },
    };
    const fromBody = extractCallAnalyzedFields(bodyLevel, bodyLevel.call);
    assert.equal(fromBody.name, 'Bob');
    assert.equal(fromBody.vehicle, 'Ibiza');
    assert.equal(fromBody.plate, '2222BBB');
    assert.equal(fromBody.reason, 'Humos');
    assert.equal(fromBody.canCreateReserva, true);

    const nested = {
      call: {
        duration_ms: 20_000,
        call_analysis: {
          custom_analysis_data: { customer_name: 'Eva', vehicle_make: 'Toyota' },
        },
      },
    };
    const short = extractCallAnalyzedFields(nested, nested.call);
    assert.equal(short.name, 'Eva');
    assert.equal(short.vehicle, 'Toyota');
    assert.equal(short.canCreateReserva, false, 'duration must be > 40');

    const noVehicle = extractCallAnalyzedFields(
      {
        call: {
          duration_ms: 90_000,
          call_analysis: { custom_analysis_data: { nombre: 'Luis', motivo: 'Ruido' } },
        },
      },
      { duration_ms: 90_000 },
    );
    assert.equal(noVehicle.canCreateReserva, false);
    assert.equal(noVehicle.vehicle, null);
  });

  it('falls back to transcript brand when analysis has no vehicle', () => {
    assert.equal(
      extractVehicleFromTranscript('User: Tengo un Seat Ibiza que no arranca'),
      'Seat Ibiza',
    );
    assert.equal(extractVehicleFromTranscript('Agent: ¿Qué marca? User: un Ford'), 'Ford');
    assert.equal(extractVehicleFromTranscript('Hola, necesito una cita'), null);

    const payload = {
      event: 'call_analyzed',
      call: {
        call_id: 'tx-1',
        duration_ms: 55_000,
        transcript: 'Cliente: Mi Volkswagen Golf perdió potencia en la A-7',
        call_analysis: { custom_analysis_data: {} },
      },
    };
    const extracted = extractCallAnalyzedFields(payload, payload.call);
    assert.equal(extracted.vehicle, 'Volkswagen Golf');
    assert.equal(extracted.vehicleSource, 'transcript');
    assert.equal(extracted.canCreateReserva, true);

    const gates = evaluateUrgenciaGates({ payload, call: payload.call });
    assert.equal(gates.ok, true);
    assert.equal(gates.rawVehicle, 'Volkswagen Golf');
    assert.equal(gates.customData?.vehiculo, 'Volkswagen Golf');

    const fromObject = extractCallAnalyzedFields(
      {
        call: {
          duration_ms: 90_000,
          transcript_object: [
            { role: 'user', content: 'Buenas, es un BMW Serie que no arranca' },
            { role: 'agent', content: 'De acuerdo' },
          ],
        },
      },
      {
        duration_ms: 90_000,
        transcript_object: [
          { role: 'user', content: 'Buenas, es un BMW Serie que no arranca' },
          { role: 'agent', content: 'De acuerdo' },
        ],
      },
    );
    assert.equal(fromObject.vehicle, 'BMW Serie');
    assert.equal(fromObject.canCreateReserva, true);
  });

  it('getCustomField finds nested bags and {value} wrappers', () => {
    const payload = {
      call: {
        call_analysis: {
          custom_analysis_data: {
            nombre: { value: 'Eva' },
            vehicle: 'Ibiza',
            plate: { answer: '9999ZZZ' },
            reason: 'Humos',
          },
        },
      },
    };
    assert.equal(getCustomField(payload, 'nombre'), 'Eva');
    assert.equal(getCustomField(payload, 'vehicle'), 'Ibiza');
    assert.equal(getCustomField(payload, 'plate'), '9999ZZZ');
    assert.equal(getCustomField(payload, 'motivo'), null);

    const mapped = mapCustomAnalysisFieldsFromPayload(payload);
    assert.equal(mapped.nombre, 'Eva');
    assert.equal(mapped.vehiculo, 'Ibiza');
    assert.equal(mapped.matricula, '9999ZZZ');
    assert.equal(mapped.motivo, 'Humos');
  });

  it('strict vehicle gate uses raw analysis without Sin vehículo fallback', () => {
    assert.equal(hasValidVehicle(null), false);
    assert.equal(hasValidVehicle(''), false);
    assert.equal(hasValidVehicle('Sin vehículo'), false);
    assert.equal(hasValidVehicle('null'), false);
    assert.equal(hasValidVehicle('Desconocido'), false);
    assert.equal(hasValidVehicle('-'), false);
    assert.equal(hasValidVehicle('Seat Ibiza'), true);
    assert.equal(isValidVehicleValue('Seat Ibiza'), true);

    // Empty custom_analysis_data → null (never invent keys / "Sin vehículo")
    const emptyPayload = {
      call: {
        call_analysis: { custom_analysis_data: {} },
        duration_ms: 90_000,
      },
    };
    assert.equal(getPostCallCustomData(emptyPayload), null);
    assert.equal(extractRawVehicle(emptyPayload), null);
    assert.equal(hasValidVehicle(extractRawVehicle(emptyPayload)), false);

    // Missing bag entirely
    assert.equal(getPostCallCustomData({ call: { call_id: 'x' } }), null);

    // Primary keys: vehiculo | vehicle | vehicle_make
    assert.equal(
      extractRawVehicle({
        call: { call_analysis: { custom_analysis_data: { vehicle_make: 'Toyota' } } },
      }),
      'Toyota',
    );
    assert.equal(
      extractRawVehicle({ custom_analysis_data: { marca: 'Ford', modelo: 'Focus' } }),
      'Ford Focus',
    );
  });

  it('reads custom_analysis_data from call_analysis nesting', () => {
    const custom = extractRetellCustomData(
      {
        call_analysis: {
          custom_analysis_data: { name: 'Eva', vehicle: 'Ibiza', plate: '9999ZZZ', reason: 'Humos' },
        },
      },
      {},
    );
    const mapped = mapCustomAnalysisFields(custom);
    assert.equal(mapped.nombre, 'Eva');
    assert.equal(mapped.vehiculo, 'Ibiza');
    assert.equal(mapped.matricula, '9999ZZZ');
    assert.equal(mapped.motivo, 'Humos');
  });
});
