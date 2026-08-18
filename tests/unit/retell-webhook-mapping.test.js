import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractRetellCustomData,
  mapCustomAnalysisFields,
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
