import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBookingWindow,
  buildCalcomBookingPayload,
  extractCalcomBookingFields,
  fallbackAttendeeEmail,
  formatFechaHoraCita,
  handleCalcomBookingCreated,
  isBookingCreatedEvent,
  unwrapCalcomWebhook,
  verifyCalcomWebhookSignature,
} from '../../server/services/calcom.js';

describe('calcom helpers', () => {
  it('uses sin-email@derteapp.com when no email is provided', () => {
    assert.equal(fallbackAttendeeEmail('+34655112233', 'María'), 'sin-email@derteapp.com');
  });

  it('builds start/end ISO UTC from scheduled_at (+60 min)', () => {
    const start = new Date('2026-08-20T10:00:00.000Z');
    const { startTime, endTime } = buildBookingWindow({
      scheduledAt: start,
      durationMinutes: 60,
    });
    assert.equal(startTime, '2026-08-20T10:00:00.000Z');
    assert.equal(endTime, '2026-08-20T11:00:00.000Z');
  });

  it('builds v1 payload with responses + inPerson location + Atlantic/Canary', () => {
    const payload = buildCalcomBookingPayload({
      appointment: {
        id: 'appt-1',
        customer_name: 'Ana',
        customer_email: null,
        customer_phone: '+34655112233',
        service_type: 'Urgencia',
        vehicle_plate: '1234ABC',
        reference: 'R-1',
      },
      shop: { id: 'shop-1', timezone: 'Atlantic/Canary' },
      startTime: '2026-08-20T10:00:00.000Z',
      endTime: '2026-08-20T11:00:00.000Z',
      timeZone: 'Atlantic/Canary',
    });

    assert.equal(payload.start, '2026-08-20T10:00:00.000Z');
    assert.equal(payload.end, '2026-08-20T11:00:00.000Z');
    assert.equal(payload.responses.name, 'Ana');
    assert.equal(payload.responses.email, 'sin-email@derteapp.com');
    assert.deepEqual(payload.responses.location, { value: 'inPerson', optionValue: 'Taller' });
    assert.equal(payload.timeZone, 'Atlantic/Canary');
    assert.equal(typeof payload.eventTypeId, 'number');
  });
});

describe('calcom BOOKING_CREATED webhook', () => {
  const shopId = '11111111-2222-4333-8444-555555555555';

  function bookingCreatedBody(overrides = {}) {
    return {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'cal_uid_1',
        title: 'Revisión entre María y Taller',
        eventTitle: 'Revisión',
        type: 'revision',
        startTime: '2026-08-25T09:00:00.000Z',
        organizer: { email: 'taller@example.com', timeZone: 'Europe/Madrid' },
        attendees: [{ name: 'María López', email: 'maria@example.com', timeZone: 'Europe/Madrid' }],
        metadata: { derte_shop_id: shopId },
        ...overrides,
      },
    };
  }

  it('recognizes BOOKING_CREATED trigger names', () => {
    assert.equal(isBookingCreatedEvent('BOOKING_CREATED'), true);
    assert.equal(isBookingCreatedEvent('booking.created'), true);
    assert.equal(isBookingCreatedEvent('BOOKING_CANCELLED'), false);
  });

  it('unwraps the nested Cal.com payload', () => {
    const { triggerEvent, payload } = unwrapCalcomWebhook(bookingCreatedBody());
    assert.equal(triggerEvent, 'BOOKING_CREATED');
    assert.equal(payload.eventTitle, 'Revisión');
  });

  it('extracts client, service and Spanish datetime', () => {
    const fields = extractCalcomBookingFields(bookingCreatedBody().payload);
    assert.equal(fields.nombreCliente, 'María López');
    assert.equal(fields.tipoServicio, 'Revisión');
    assert.equal(fields.fechaHoraFormateada, formatFechaHoraCita('2026-08-25T09:00:00.000Z', 'Europe/Madrid'));
    assert.match(fields.fechaHoraFormateada, /2026/);
    assert.match(fields.fechaHoraFormateada, /11:00/);
  });

  it('sends web-push for BOOKING_CREATED using metadata.derte_shop_id', async () => {
    const calls = [];
    const result = await handleCalcomBookingCreated(bookingCreatedBody(), {
      notify: async (id, booking) => {
        calls.push({ id, booking });
        return { sent: 1 };
      },
    });
    assert.equal(result.skipped, false);
    assert.equal(result.shopId, shopId);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, shopId);
    assert.equal(calls[0].booking.nombreCliente, 'María López');
    assert.equal(calls[0].booking.tipoServicio, 'Revisión');
    assert.match(calls[0].booking.fechaHoraFormateada, /11:00/);
  });

  it('ignores non-created events', async () => {
    const calls = [];
    const result = await handleCalcomBookingCreated(
      { triggerEvent: 'BOOKING_CANCELLED', payload: { uid: 'x' } },
      { notify: async () => calls.push(1) },
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'ignored_event');
    assert.equal(calls.length, 0);
  });

  it('accepts requests when no webhook secret is configured', () => {
    const check = verifyCalcomWebhookSignature('{}', '', '');
    assert.equal(check.ok, true);
    assert.equal(check.skipped, true);
  });
});
