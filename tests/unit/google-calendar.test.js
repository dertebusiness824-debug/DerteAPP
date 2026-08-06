import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCalendarEvent,
  parseOAuthState,
  serializeGoogleCalendarStatus,
  shopCalendarConnected,
  syncAppointmentToGoogleCalendar,
} from '../../server/services/google-calendar.js';

const shop = {
  id: '11111111-1111-1111-1111-111111111111',
  timezone: 'Europe/Madrid',
  slot_minutes: 60,
  google_calendar_sync_enabled: true,
  google_calendar_id: 'primary',
  google_calendar_refresh_token: 'refresh-token',
};

const appointment = {
  id: '22222222-2222-2222-2222-222222222222',
  reference: 'DT-ABC123',
  customer_name: 'Juan Pérez',
  customer_phone: '+34600111222',
  customer_email: 'juan@example.com',
  vehicle_make: 'Seat',
  vehicle_model: 'Leon',
  vehicle_year: 2019,
  vehicle_plate: '1234ABC',
  service_type: 'Cambio de aceite',
  notes: 'Cliente llama desde Retell · ruidos al frenar',
  scheduled_at: '2026-08-10T09:00:00.000Z',
  duration_minutes: 60,
  status: 'accepted',
  source: 'retell',
};

describe('buildCalendarEvent', () => {
  it('builds title, window window and description with phone/vehicle/notes', () => {
    const event = buildCalendarEvent(appointment, shop);
    assert.equal(event.summary, 'Juan Pérez - Cambio de aceite');
    assert.equal(event.start.timeZone, 'Europe/Madrid');
    assert.equal(event.end.dateTime, '2026-08-10T10:00:00.000Z');
    assert.match(event.description, /Teléfono:/);
    assert.match(event.description, /Seat Leon 2019/);
    assert.match(event.description, /1234ABC/);
    assert.match(event.description, /Notas: Cliente llama desde Retell/);
    assert.equal(event.extendedProperties.private.derte_appointment_id, appointment.id);
  });

  it('falls back to «Cita» when service_type is missing', () => {
    const event = buildCalendarEvent({ ...appointment, service_type: null }, shop);
    assert.equal(event.summary, 'Juan Pérez - Cita');
  });
});

describe('shopCalendarConnected', () => {
  it('requires sync flag, calendar id and a credential path', () => {
    assert.equal(shopCalendarConnected(shop), true);
    assert.equal(shopCalendarConnected({ ...shop, google_calendar_sync_enabled: false }), false);
    assert.equal(shopCalendarConnected({ ...shop, google_calendar_id: null }), false);
    assert.equal(
      shopCalendarConnected({ ...shop, google_calendar_refresh_token: null }),
      false,
    );
  });
});

describe('serializeGoogleCalendarStatus', () => {
  it('never exposes tokens', () => {
    const status = serializeGoogleCalendarStatus(shop);
    assert.equal(status.calendar_id, 'primary');
    assert.equal(status.sync_enabled, true);
    assert.equal('google_calendar_refresh_token' in status, false);
    assert.equal('refresh_token' in status, false);
  });
});

describe('parseOAuthState', () => {
  it('round-trips base64url JSON state', () => {
    const raw = Buffer.from(JSON.stringify({ shopId: 'abc', userId: 'u1' })).toString('base64url');
    assert.deepEqual(parseOAuthState(raw), { shopId: 'abc', userId: 'u1' });
    assert.equal(parseOAuthState('not-valid'), null);
  });
});

describe('syncAppointmentToGoogleCalendar', () => {
  it('no-ops when the shop is not connected', async () => {
    const result = await syncAppointmentToGoogleCalendar(
      { ...shop, google_calendar_sync_enabled: false },
      appointment,
    );
    assert.deepEqual(result, { synced: false, reason: 'not_connected' });
  });
});
