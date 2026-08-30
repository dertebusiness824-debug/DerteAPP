import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNuevaCitaPayload,
  buildNuevaUrgenciaPayload,
  buildNuevoLeadPayload,
} from '../../server/services/web-push.js';

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

describe('web-push nueva cita payload', () => {
  it('builds the Cal.com BOOKING_CREATED push payload', () => {
    const payload = buildNuevaCitaPayload({
      uid: 'cal_abc123',
      nombreCliente: 'María López',
      tipoServicio: 'Revisión',
      fechaHoraFormateada: '25 ago 2026, 11:00',
    });

    assert.equal(payload.title, '📅 ¡Nueva Cita Confirmada!');
    assert.equal(payload.body, 'María López - Revisión para el 25 ago 2026, 11:00');
    assert.equal(payload.icon, '/icon.png');
    assert.deepEqual(payload.data, { url: '/reservas' });
    assert.equal(payload.url, '/reservas');
    assert.equal(payload.tag, 'cita-cal_abc123');
  });

  it('falls back when client or service is missing', () => {
    const payload = buildNuevaCitaPayload({});
    assert.equal(payload.body, 'Cliente - Reserva para el fecha por confirmar');
    assert.deepEqual(payload.data, { url: '/reservas' });
  });
});

describe('web-push nuevo lead payload', () => {
  it('builds the CLIENTES push for the Super Admin móvil', () => {
    const payload = buildNuevoLeadPayload({
      id: 'lead-1',
      customer_name: 'Ana Pérez',
      shop_name: 'Talleres Sol',
      island: 'Gran Canaria',
    });

    assert.equal(payload.title, 'Nuevo Taller Interesado');
    assert.equal(payload.body, 'Talleres Sol (Gran Canaria) - Ana Pérez');
    assert.deepEqual(payload.data, { url: '/admin/clientes' });
    assert.equal(payload.url, '/admin/clientes');
    assert.equal(payload.tag, 'lead-lead-1');
  });
});
