import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatUrgenciaCanaryDateTime,
  formatUrgenciaCustomerDisplayName,
  formatUrgenciaDisplaySummary,
} from '../../public/js/views/urgencias.js';
import {
  formatUrgenciaDisplayDateTime,
  serializeUrgencia,
} from '../../server/services/urgencias.js';

describe('urgencia Canary datetime', () => {
  it('formats created_at as dd/MM/yyyy HH:mm in Atlantic/Canary', () => {
    // 2026-08-20 15:01 UTC → 16:01 in Canary (WEST, UTC+1 in August)
    const label = formatUrgenciaCanaryDateTime({
      created_at: '2026-08-20T15:01:00.000Z',
    });
    assert.equal(label, '20/08/2026 16:01');
  });

  it('ignores English called_local labels and rebuilds from ISO', () => {
    const label = formatUrgenciaCanaryDateTime({
      called_local: 'Thu 20 Aug, 16:39',
      created_at: '2026-08-20T15:39:00.000Z',
    });
    assert.equal(label, '20/08/2026 16:39');
  });

  it('falls back to called_at when created_at is missing', () => {
    const label = formatUrgenciaCanaryDateTime({
      called_at: '2026-01-10T12:05:00.000Z',
    });
    assert.equal(label, '10/01/2026 12:05');
  });

  it('returns empty string for invalid input', () => {
    assert.equal(formatUrgenciaCanaryDateTime({}), '');
    assert.equal(formatUrgenciaCanaryDateTime({ created_at: 'not-a-date' }), '');
  });

  it('serializes called_local as Canary dd/MM/yyyy HH:mm', () => {
    const serialized = serializeUrgencia(
      {
        id: '11111111-1111-1111-1111-111111111111',
        shop_id: '22222222-2222-2222-2222-222222222222',
        status: 'pending',
        customer_phone: '+34655112233',
        called_at: '2026-08-20T15:01:00.000Z',
        created_at: '2026-08-20T15:01:30.000Z',
      },
      { timezone: 'Atlantic/Canary' },
    );
    assert.equal(serialized.called_local, '20/08/2026 16:01');
    assert.equal(serialized.called_time, '20/08/2026 16:01');
    assert.equal(
      formatUrgenciaDisplayDateTime('2026-08-20T15:01:00.000Z', 'Atlantic/Canary'),
      '20/08/2026 16:01',
    );
  });
});

describe('urgencia card display formatters', () => {
  it('replaces The user / Sin nombre with Cliente por confirmar', () => {
    assert.equal(formatUrgenciaCustomerDisplayName('The user'), 'Cliente por confirmar');
    assert.equal(formatUrgenciaCustomerDisplayName('Sin nombre'), 'Cliente por confirmar');
  });

  it('rewrites English summaries with vehicle and motivo', () => {
    assert.equal(
      formatUrgenciaDisplaySummary({
        vehicle: { label: 'Renault Clio' },
        reason: 'Frenos',
        summary: 'The user called about brakes',
      }),
      'El cliente llamó solicitando atención urgente para su vehículo (Renault Clio). Motivo: Frenos.',
    );
  });
});
