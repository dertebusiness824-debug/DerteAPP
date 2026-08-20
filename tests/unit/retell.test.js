import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectFields,
  detectUrgent,
  extractBooking,
  extractTranscript,
  mapUrgenciaFieldsFromAnalysis,
  parseSpokenDate,
  parseSpokenTime,
  resolveAppointmentTime,
  signWebhook,
  verifyWebhook,
} from '../../server/services/retell.js';
import {
  canCreateConfirmedReserva,
  hasAnalysisPayload,
  isMissedOrTooShortCall,
  isPlaceholderCallerName,
  MIN_CALL_DURATION_MS,
  resolveCallDurationMs,
} from '../../server/services/retell-intake.js';

describe('Retell webhook signatures', () => {
  const secret = 'retell-test-api-key';
  const body = '{"event":"call_analyzed","call":{"call_id":"abc"}}';

  it('accepts a correctly signed body', () => {
    const signature = signWebhook(body, secret);
    assert.equal(verifyWebhook(body, signature, { secret }).ok, true);
  });

  it('rejects a tampered body', () => {
    const signature = signWebhook(body, secret);
    assert.equal(verifyWebhook(body.replace('abc', 'xyz'), signature, { secret }).ok, false);
  });

  it('rejects a wrong secret', () => {
    const signature = signWebhook(body, secret);
    assert.equal(verifyWebhook(body, signature, { secret: 'other' }).ok, false);
  });

  it('rejects a stale timestamp', () => {
    const signature = signWebhook(body, secret, Date.now() - 10 * 60_000);
    assert.equal(verifyWebhook(body, signature, { secret }).ok, false);
    assert.equal(verifyWebhook(body, signature, { secret }).reason, 'stale_signature');
  });

  it('rejects a malformed header', () => {
    assert.equal(verifyWebhook(body, 'not-a-signature', { secret }).ok, false);
  });
});

describe('spoken date and time parsing', () => {
  // A fixed "now" keeps relative words like "tomorrow" deterministic.
  const now = new Date('2026-08-06T08:00:00.000Z'); // Thursday in Madrid

  it('parses ISO, D/M/Y and named months', () => {
    assert.deepEqual(parseSpokenDate('2026-08-17', { timezone: 'Europe/Madrid', now }), {
      year: 2026,
      month: 8,
      day: 17,
    });
    assert.deepEqual(parseSpokenDate('19/08/2026', { timezone: 'Europe/Madrid', now }), {
      year: 2026,
      month: 8,
      day: 19,
    });
    assert.deepEqual(parseSpokenDate('12 de marzo', { timezone: 'Europe/Madrid', now }), {
      year: 2027,
      month: 3,
      day: 12,
    });
  });

  it('resolves relative Spanish and English days', () => {
    assert.deepEqual(parseSpokenDate('hoy', { timezone: 'Europe/Madrid', now }), {
      year: 2026,
      month: 8,
      day: 6,
    });
    assert.deepEqual(parseSpokenDate('mañana', { timezone: 'Europe/Madrid', now }), {
      year: 2026,
      month: 8,
      day: 7,
    });
    assert.deepEqual(parseSpokenDate('tomorrow', { timezone: 'Europe/Madrid', now }), {
      year: 2026,
      month: 8,
      day: 7,
    });
  });

  it('parses clock readings and afternoon defaults', () => {
    assert.equal(parseSpokenTime('10:30'), 10 * 60 + 30);
    assert.equal(parseSpokenTime('9h30'), 9 * 60 + 30);
    assert.equal(parseSpokenTime('4 pm'), 16 * 60);
    assert.equal(parseSpokenTime('16:00'), 16 * 60);
    // Bare "at 4" at a garage means the afternoon.
    assert.equal(parseSpokenTime('a las 4'), 16 * 60);
  });

  it('does not confuse a date for a time', () => {
    assert.equal(parseSpokenTime('19/08/2026'), null);
    assert.equal(parseSpokenTime('2026-08-19'), null);
  });

  it('combines a date and a time into an absolute instant', () => {
    const resolved = resolveAppointmentTime(
      new Map([
        ['fecha', '19/08/2026'],
        ['hora', '16:00'],
      ]),
      { timezone: 'Europe/Madrid', now },
    );
    assert.equal(resolved.precision, 'datetime');
    // 16:00 Madrid in August is 14:00 UTC.
    assert.equal(resolved.at.toISOString(), '2026-08-19T14:00:00.000Z');
  });
});

describe('field extraction', () => {
  it('reads English custom_analysis_data', () => {
    const booking = extractBooking({
      call_id: 'c1',
      direction: 'inbound',
      from_number: '+34655112233',
      to_number: '+34910000111',
      call_analysis: {
        call_summary: 'Brakes',
        custom_analysis_data: {
          customer_name: 'Laura Jimenez',
          customer_phone: '+34655112233',
          appointment_reason: 'Brake inspection',
          appointment_date: '2026-08-17',
          appointment_time: '10:30',
        },
      },
    });
    assert.equal(booking.name, 'Laura Jimenez');
    assert.equal(booking.phone, '+34655112233');
    assert.equal(booking.reason, 'Brake inspection');
    assert.equal(booking.time.precision, 'datetime');
  });

  it('reads Spanish aliases and local phone numbers', () => {
    const booking = extractBooking(
      {
        call_id: 'c2',
        direction: 'inbound',
        from_number: '+34655112233',
        to_number: '+34910000111',
        call_analysis: {
          custom_analysis_data: {
            nombre_cliente: 'Carmen Delgado',
            telefono_cliente: '655 99 88 77',
            motivo_de_la_cita: 'Cambio de neumáticos',
            fecha: '19/08/2026',
            hora: '16:00',
          },
        },
      },
      { defaultCountryCode: '34' },
    );
    assert.equal(booking.name, 'Carmen Delgado');
    assert.equal(booking.phone, '+34655998877');
    assert.equal(booking.reason, 'Cambio de neumáticos');
    assert.equal(booking.time.precision, 'datetime');
  });

  it('falls back to the caller id when no phone field is present', () => {
    const booking = extractBooking({
      call_id: 'c3',
      direction: 'inbound',
      from_number: '+34655112233',
      to_number: '+34910000111',
      call_analysis: { custom_analysis_data: { customer_name: 'Anon' } },
    });
    assert.equal(booking.phone, '+34655112233');
  });

  it('prefers custom_analysis_data over raw call metadata', () => {
    const fields = collectFields({
      customer_name: 'From metadata',
      call_analysis: { custom_analysis_data: { customer_name: 'From analysis' } },
    });
    assert.equal(fields.get('customer_name'), 'From analysis');
  });

  it('detects urgent calls from is_urgent / tipo_llamada / motivo', () => {
    const urgentFields = collectFields({
      call_analysis: { custom_analysis_data: { is_urgent: true, marca: 'Seat', modelo: 'Leon' } },
    });
    assert.equal(detectUrgent(urgentFields), true);

    const kindFields = collectFields({
      call_analysis: { custom_analysis_data: { tipo_llamada: 'urgencia' } },
    });
    assert.equal(detectUrgent(kindFields), true);

    const booking = extractBooking({
      call_id: 'u1',
      direction: 'inbound',
      from_number: '+34655112233',
      call_analysis: {
        call_summary: 'El coche no arranca',
        custom_analysis_data: {
          is_urgent: 'si',
          nombre: 'Luis',
          marca: 'VW',
          modelo: 'Golf',
          motivo_urgencia: 'No arranca',
        },
      },
    });
    assert.equal(booking.is_urgent, true);
    assert.equal(booking.vehicle_make, 'VW');
    assert.equal(booking.vehicle_model, 'Golf');
    assert.equal(booking.reason, 'No arranca');
  });

  it('maps real call_analyzed bags: custom_analysis_data + retell_llm_dynamic_variables', () => {
    const booking = extractBooking({
      call_id: 'real-1',
      direction: 'inbound',
      from_number: '+34666777888',
      to_number: '+34910000111',
      transcript: 'Agent: Hola\nUser: No arranca el coche',
      retell_llm_dynamic_variables: {
        customer_name: 'From LLM vars',
      },
      call_analysis: {
        call_summary: 'Avería en carretera',
        custom_analysis_data: {
          marca: 'Toyota',
          modelo: 'Yaris',
          nombre_cliente: 'Elena Ruiz',
          telefono_cliente: '655 11 22 33',
          motivo: 'No arranca',
        },
      },
    });

    // custom_analysis_data wins over retell_llm_dynamic_variables
    assert.equal(booking.name, 'Elena Ruiz');
    assert.equal(booking.phone, '+34655112233');
    assert.equal(booking.vehicle_make, 'Toyota');
    assert.equal(booking.vehicle_model, 'Yaris');
    assert.equal(booking.reason, 'No arranca');
    assert.match(
      booking.summary,
      /El cliente Elena Ruiz llamó solicitando atención urgente para su vehículo \(.+\). Motivo: No arranca\./,
    );
    assert.match(booking.transcript, /No arranca el coche/);
  });

  it('extracts urgencia fields from args and falls back phone to from_number', () => {
    const booking = extractBooking({
      call_id: 'args-1',
      direction: 'inbound',
      from_number: '+34655001122',
      to_number: '+34828643107',
      args: {
        nombre_cliente: 'Ana Args',
        marca: 'Seat',
        modelo: 'Leon',
        motivo_urgencia: 'Pinchazo',
      },
    });
    assert.equal(booking.is_urgent, true);
    assert.equal(booking.name, 'Ana Args');
    assert.equal(booking.phone, '+34655001122');
    assert.equal(booking.vehicle_make, 'Seat');
    assert.equal(booking.vehicle_model, 'Leon');
    assert.equal(booking.reason, 'Pinchazo');
  });

  it('maps top-level custom_analysis_data nombre/vehiculo/matricula/motivo', () => {
    const booking = extractBooking({
      call_id: 'cad-top-1',
      direction: 'inbound',
      from_number: '+34655112233',
      custom_analysis_data: {
        is_urgent: true,
        nombre: 'Luis Melian',
        vehiculo: 'Ford Focus',
        matricula: '1234ABC',
        motivo: 'No arranca',
      },
    });
    assert.equal(booking.is_urgent, true);
    assert.equal(booking.name, 'Luis Melian');
    assert.equal(booking.vehicle, 'Ford Focus');
    // Full vehiculo string is stored on vehicle_model (ES agent schema).
    assert.equal(booking.vehicle_model, 'Ford Focus');
    assert.equal(booking.plate, '1234ABC');
    assert.equal(booking.reason, 'No arranca');
  });

  it('merges analysis from body.custom_analysis_data when call bag is empty', () => {
    const booking = extractBooking(
      {
        call_id: 'cad-body-1',
        direction: 'inbound',
        from_number: '+34655112233',
        call_analysis: { custom_analysis_data: {} },
      },
      {
        body: {
          custom_analysis_data: {
            name: 'Rosa Perez',
            car: 'Peugeot 208',
            plate: '9999ZZZ',
            urgency_reason: 'Humo en motor',
            is_urgent: true,
          },
        },
      },
    );
    assert.equal(booking.name, 'Rosa Perez');
    assert.equal(booking.vehicle_model, 'Peugeot 208');
    assert.equal(booking.plate, '9999ZZZ');
    assert.equal(booking.reason, 'Humo en motor');
    assert.equal(booking.is_urgent, true);
  });

  it('parses stringified custom_analysis_data JSON', () => {
    const booking = extractBooking({
      call_id: 'cad-str-1',
      direction: 'inbound',
      from_number: '+34655112233',
      call_analysis: {
        custom_analysis_data: JSON.stringify({
          nombre: 'Eva String',
          vehiculo: 'Audi A3',
          matricula: '1111AAA',
          motivo: 'Frenos',
          is_urgent: true,
        }),
      },
    });
    assert.equal(booking.name, 'Eva String');
    assert.equal(booking.vehicle_model, 'Audi A3');
    assert.equal(booking.plate, '1111AAA');
    assert.equal(booking.reason, 'Frenos');
  });

  it('unwraps { value } wrappers and maps ES/EN aliases for urgencias', () => {
    const booking = extractBooking({
      call_id: 'cad-wrap-1',
      direction: 'inbound',
      from_number: '+34655112233',
      call_analysis: {
        custom_analysis_data: {
          is_urgent: true,
          nombre: { value: 'Nora Wrap' },
          vehiculo: { answer: 'Kia Ceed' },
          matricula: { text: '5555BBB' },
          motivo: { value: 'Ruido suspensión' },
        },
      },
    });
    assert.equal(booking.name, 'Nora Wrap');
    assert.equal(booking.vehicle_model, 'Kia Ceed');
    assert.equal(booking.plate, '5555BBB');
    assert.equal(booking.reason, 'Ruido suspensión');

    const mapped = mapUrgenciaFieldsFromAnalysis(booking.custom_analysis_data);
    assert.equal(mapped.customerName, 'Nora Wrap');
    assert.equal(mapped.vehicleModel, 'Kia Ceed');
    assert.equal(mapped.licensePlate, '5555BBB');
    assert.equal(mapped.reasonUrgency, 'Ruido suspensión');
  });

  it('does not treat input retell_llm_dynamic_variables as custom_analysis_data', () => {
    const call = {
      call_id: 'cad-llm-only',
      direction: 'inbound',
      from_number: '+34655112233',
      retell_llm_dynamic_variables: {
        customer_name: 'Seed Only',
        motivo: 'Should not be analysis bag',
      },
    };
    const booking = extractBooking(call);
    // collectFields may still read LLM vars as a last-resort field source…
    assert.equal(booking.name, 'Seed Only');
    // …but the persisted analysis bag must stay empty so call_ended defers.
    assert.equal(booking.custom_analysis_data, null);
    assert.equal(hasAnalysisPayload(call, booking), false);
  });

  it('builds transcript text from transcript_object utterances', () => {
    const text = extractTranscript({
      transcript_object: [
        { role: 'agent', content: '¿Cuál es la marca?' },
        { role: 'user', content: 'Seat Ibiza' },
        { role: 'tool_call_invocation', content: 'skip' },
      ],
    });
    assert.equal(text, 'agent: ¿Cuál es la marca?\nuser: Seat Ibiza');
  });
});

describe('Retell reserva vs urgencia routing guards', () => {
  it('detects Caller +34 placeholder names', () => {
    assert.equal(isPlaceholderCallerName('Caller +34655112233'), true);
    assert.equal(isPlaceholderCallerName('Caller +34 655'), true);
    assert.equal(isPlaceholderCallerName('Ana Solis'), false);
    assert.equal(isPlaceholderCallerName(''), true);
  });

  it('allows confirmed reservas only with name + motivo + datetime + vehicle + duration > 40', () => {
    assert.equal(
      canCreateConfirmedReserva(
        {
          name: 'Ana',
          reason: 'ITV',
          is_urgent: false,
          vehicle: 'Seat Ibiza',
          time: { precision: 'datetime', at: new Date() },
        },
        { durationSec: 90 },
      ),
      true,
    );
    assert.equal(
      canCreateConfirmedReserva(
        {
          name: 'Ana',
          reason: 'ITV',
          is_urgent: false,
          time: { precision: 'datetime', at: new Date() },
        },
        { durationSec: 90 },
      ),
      false,
      'missing vehicle',
    );
    assert.equal(
      canCreateConfirmedReserva(
        {
          name: 'Ana',
          reason: 'ITV',
          is_urgent: false,
          vehicle: 'Seat Ibiza',
          time: { precision: 'datetime', at: new Date() },
        },
        { durationSec: 30 },
      ),
      false,
      'short duration',
    );
    assert.equal(
      canCreateConfirmedReserva({
        name: 'Caller +34655112233',
        reason: 'ITV',
        is_urgent: false,
        vehicle: 'Seat Ibiza',
        time: { precision: 'datetime', at: new Date() },
      }, { durationSec: 90 }),
      false,
    );
    assert.equal(
      canCreateConfirmedReserva(
        {
          name: 'Ana',
          reason: 'ITV',
          is_urgent: true,
          vehicle: 'Seat Ibiza',
          time: { precision: 'datetime', at: new Date() },
        },
        { durationSec: 90 },
      ),
      false,
    );
    assert.equal(
      canCreateConfirmedReserva(
        {
          name: 'Ana',
          reason: 'ITV',
          is_urgent: false,
          vehicle: 'Seat Ibiza',
          time: { precision: 'date' },
        },
        { durationSec: 90 },
      ),
      false,
    );
  });

  it('resolves duration from duration_ms or timestamps', () => {
    assert.equal(resolveCallDurationMs({ duration_ms: 12_000 }), 12_000);
    assert.equal(
      resolveCallDurationMs({
        start_timestamp: 1_000_000,
        end_timestamp: 1_045_000,
      }),
      45_000,
    );
    assert.equal(MIN_CALL_DURATION_MS, 40_000);
  });

  it('skips missed / short / voicemail / unsuccessful calls', () => {
    assert.equal(
      isMissedOrTooShortCall({
        call_id: 'short-1',
        duration_ms: 8_000,
        disconnection_reason: 'user_hangup',
      }).skip,
      true,
    );
    assert.equal(
      isMissedOrTooShortCall({
        call_id: 'busy-1',
        duration_ms: 120_000,
        disconnection_reason: 'dial_busy',
      }).skip,
      true,
    );
    assert.equal(
      isMissedOrTooShortCall({
        call_id: 'vm-1',
        duration_ms: 90_000,
        disconnection_reason: 'voicemail_reached',
      }).skip,
      true,
    );
    assert.equal(
      isMissedOrTooShortCall({
        call_id: 'fail-1',
        duration_ms: 60_000,
        transcript: 'hi',
        call_analysis: { call_successful: false },
      }).skip,
      true,
    );
    assert.equal(
      isMissedOrTooShortCall({
        call_id: 'ok-1',
        duration_ms: 90_000,
        disconnection_reason: 'agent_hangup',
        transcript: 'Cliente: necesito ayuda con el coche que no arranca en la A-7',
        call_analysis: { call_successful: true },
      }).skip,
      false,
    );
  });
});
