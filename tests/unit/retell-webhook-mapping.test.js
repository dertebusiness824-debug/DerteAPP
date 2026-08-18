import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractRawVehicle,
  extractRetellCustomData,
  getCustomField,
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

  it('rejects placeholder vehicle values', () => {
    assert.equal(isValidVehicleValue(null), false);
    assert.equal(isValidVehicleValue(''), false);
    assert.equal(isValidVehicleValue('Sin vehículo'), false);
    assert.equal(isValidVehicleValue('Desconocido'), false);
    assert.equal(isValidVehicleValue('-'), false);
    assert.equal(isValidVehicleValue('Seat Ibiza'), true);
    assert.equal(extractRawVehicle({ custom_analysis_data: { marca: 'Ford', modelo: 'Focus' } }), 'Ford Focus');
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
