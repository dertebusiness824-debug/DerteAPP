import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractRawVehicle,
  extractRetellCustomData,
  getCustomField,
  getPostCallCustomData,
  hasValidVehicle,
  isValidVehicleValue,
  mapCustomAnalysisFields,
  mapCustomAnalysisFieldsFromPayload,
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
