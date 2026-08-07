import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBookingNotes } from '../../server/lib/booking-notes-parse.js';

describe('parseBookingNotes', () => {
  it('extracts free-form opel corsa, plate 4961GGJ and email', () => {
    const parsed = parseBookingNotes('opel corsa\n4961GGJ\ncliente@taller.com');
    assert.equal(parsed.vehicle_make, 'Opel');
    assert.equal(parsed.vehicle_model, 'corsa');
    assert.equal(parsed.vehicle_plate, '4961GGJ');
    assert.equal(parsed.email, 'cliente@taller.com');
  });

  it('extracts labelled fields', () => {
    const parsed = parseBookingNotes(
      'Modelo: Leon\nMarca: Seat\nMatrícula: 1234BCD\nEmail: ana@ejemplo.com',
    );
    assert.equal(parsed.vehicle_make, 'Seat');
    assert.equal(parsed.vehicle_model, 'Leon');
    assert.equal(parsed.vehicle_plate, '1234BCD');
    assert.equal(parsed.email, 'ana@ejemplo.com');
  });

  it('handles vehicle + plate on one line', () => {
    const parsed = parseBookingNotes('Vehículo: VW Golf · 5678FGH');
    assert.equal(parsed.vehicle_make, 'VW');
    assert.equal(parsed.vehicle_model, 'Golf');
    assert.equal(parsed.vehicle_plate, '5678FGH');
  });
});
