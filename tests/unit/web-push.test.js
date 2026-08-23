import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNuevaUrgenciaPayload } from '../../server/services/web-push.js';

describe('web-push nueva urgencia payload', () => {
  it('builds the Retell/Render push payload with vehicle and client', () => {
    const payload = buildNuevaUrgenciaPayload({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      customer_name: 'María López',
      vehicle: { make: 'Seat', model: 'León', label: 'Seat León' },
    });

    assert.equal(payload.title, '🚨 NUEVA SOLICITUD URGENTE');
    assert.equal(payload.body, 'Vehículo: Seat León - Cliente: María López');
    assert.equal(payload.icon, '/icons/icon-192.png');
    assert.deepEqual(payload.data, { url: '/urgencias' });
    assert.equal(payload.url, '/urgencias');
    assert.equal(payload.tag, 'urgencia-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('falls back when vehicle or name is missing', () => {
    const payload = buildNuevaUrgenciaPayload({});
    assert.equal(payload.body, 'Vehículo: No especificado - Cliente: Por confirmar');
    assert.deepEqual(payload.data, { url: '/urgencias' });
  });
});
