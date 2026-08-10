import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  URGENCIA_ACTIVE_HOURS,
  URGENCIA_HISTORY_DAYS,
  serializeUrgencia,
} from '../../server/services/urgencias.js';

describe('urgencias helpers', () => {
  it('keeps 24h active / 60d history windows', () => {
    assert.equal(URGENCIA_ACTIVE_HOURS, 24);
    assert.equal(URGENCIA_HISTORY_DAYS, 60);
  });

  it('serializes vehicle, phone links and local call time', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      shop_id: '22222222-2222-2222-2222-222222222222',
      call_log_id: null,
      external_ref: 'retell:abc',
      is_urgent: true,
      customer_name: 'Ana',
      customer_phone: '+34655112233',
      vehicle_make: 'Audi',
      vehicle_model: 'A3',
      vehicle_plate: '1234ABC',
      reason: 'No frena',
      summary: 'Cliente en carretera',
      transcript: null,
      called_at: '2026-08-10T10:15:00.000Z',
      source: 'retell',
      created_at: '2026-08-10T10:16:00.000Z',
    };
    const serialized = serializeUrgencia(row, { timezone: 'Europe/Madrid' });
    assert.equal(serialized.vehicle.label, 'Audi A3');
    assert.equal(serialized.customer_tel_link, 'tel:+34655112233');
    assert.ok(serialized.called_time);
    assert.equal(serialized.is_urgent, true);
  });
});
