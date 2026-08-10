import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractBooking, normalizeRetellWebhookBody } from '../../server/services/retell.js';

describe('normalizeRetellWebhookBody', () => {
  it('merges body.args and custom_analysis_data into call analysis', () => {
    const { event, call } = normalizeRetellWebhookBody({
      event: 'call_analyzed',
      args: { car_brand: 'Seat', car_model: 'Leon', name: 'Ana' },
      call: {
        call_id: 'c1',
        from_number: '+34655112233',
        direction: 'inbound',
        custom_analysis_data: { phone: '655998877', reason: 'No arranca' },
      },
    });

    assert.equal(event, 'call_analyzed');
    assert.equal(call.call_analysis.custom_analysis_data.car_brand, 'Seat');
    assert.equal(call.call_analysis.custom_analysis_data.name, 'Ana');
    assert.equal(call.call_analysis.custom_analysis_data.reason, 'No arranca');

    const booking = extractBooking(call, { defaultCountryCode: '34' });
    assert.equal(booking.name, 'Ana');
    assert.equal(booking.vehicle_make, 'Seat');
    assert.equal(booking.vehicle_model, 'Leon');
    assert.equal(booking.phone, '+34655998877');
    assert.equal(booking.reason, 'No arranca');
  });

  it('synthesizes a call object from a flat Test payload', () => {
    const { event, call } = normalizeRetellWebhookBody({
      name: 'Luis',
      phone: '+34655110000',
      car_brand: 'VW',
      car_model: 'Golf',
      summary: 'Pinchazo',
    });
    assert.equal(event, 'call_analyzed');
    assert.ok(call.call_id);
    const booking = extractBooking(call, { defaultCountryCode: '34' });
    assert.equal(booking.name, 'Luis');
    assert.equal(booking.vehicle_make, 'VW');
    assert.equal(booking.vehicle_model, 'Golf');
    assert.equal(booking.reason, 'Pinchazo');
  });
});
