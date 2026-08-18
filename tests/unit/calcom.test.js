import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBookingWindow,
  buildCalcomBookingPayload,
  fallbackAttendeeEmail,
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
