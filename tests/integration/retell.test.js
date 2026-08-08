import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { query } from '../../server/db/index.js';
import { signWebhook } from '../../server/services/retell.js';
import {
  closeDatabase,
  createOwner,
  nextWeekday,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';

const SECRET = process.env.RETELL_API_KEY;

describe('Retell AI webhook', () => {
  let client;

  before(async () => {
    client = await startTestServer();
  });
  after(async () => {
    await client.close();
    await closeDatabase();
  });
  beforeEach(resetDatabase);

  async function wireShop(shopId) {
    await query(
      `UPDATE shops SET retell_agent_id = $2, retell_did = $3, country_code = '34' WHERE id = $1`,
      [shopId, 'agent_test_shop', '+34910000111'],
    );
  }

  function signedPost(payload) {
    const raw = JSON.stringify(payload);
    return client.request('POST', '/api/webhooks/retell', {
      body: raw,
      headers: { 'x-retell-signature': signWebhook(raw, SECRET) },
    });
  }

  function analysedCall(callId, analysis, overrides = {}) {
    return {
      event: 'call_analyzed',
      call: {
        call_id: callId,
        agent_id: 'agent_test_shop',
        call_type: 'phone_call',
        direction: 'inbound',
        from_number: '+34655112233',
        to_number: '+34910000111',
        call_status: 'ended',
        start_timestamp: Date.now() - 120_000,
        end_timestamp: Date.now(),
        duration_ms: 120_000,
        call_analysis: {
          call_summary: 'Caller booked a visit.',
          custom_analysis_data: analysis,
        },
        ...overrides,
      },
    };
  }

  it('exposes a readiness endpoint', async () => {
    const response = await client.get('/api/webhooks/retell');
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'retell');
    assert.equal(response.body.ready, true);
  });

  it('rejects unsigned or badly signed requests', async () => {
    const payload = analysedCall('unsigned', { customer_name: 'X' });
    const bare = await client.post('/api/webhooks/retell', payload);
    assert.equal(bare.status, 401);

    const wrong = await client.request('POST', '/api/webhooks/retell', {
      body: payload,
      headers: { 'x-retell-signature': signWebhook(JSON.stringify(payload), 'wrong-secret') },
    });
    assert.equal(wrong.status, 401);
  });

  it('creates a pending booking from a finished call', async () => {
    const owner = await createOwner(client, { shop_name: 'Retell Garage' });
    await wireShop(owner.shop.id);
    const date = nextWeekday(1); // Monday

    const response = await signedPost(
      analysedCall('call-create-1', {
        customer_name: 'Laura Jimenez',
        customer_phone: '+34655112233',
        appointment_reason: 'Brake inspection',
        appointment_date: date,
        appointment_time: '10:30',
        vehicle: 'Audi A3',
        license_plate: '4455XYZ',
      }),
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.created, true);
    assert.equal(response.body.appointment.source, 'retell');
    assert.equal(response.body.appointment.status, 'confirmed');
    assert.equal(response.body.appointment.customer_name, 'Laura Jimenez');
    assert.equal(response.body.appointment.customer_phone, '+34655112233');
    assert.equal(response.body.appointment.service_type, 'Brake inspection');
    assert.equal(response.body.appointment.vehicle.plate, '4455XYZ');
    assert.match(response.body.appointment.scheduled_local, /10:30/);

    // The booking is visible on the shop calendar.
    const list = await client.get(`/api/appointments?shop_id=${owner.shop.id}&date=${date}`, {
      token: owner.token,
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.appointments.length, 1);
    assert.equal(list.body.appointments[0].reference, response.body.appointment.reference);

    // A call log row is kept alongside it.
    const calls = await client.get(`/api/telephony/calls?shop_id=${owner.shop.id}`, { token: owner.token });
    assert.equal(calls.body.calls.some((entry) => entry.provider === 'retell'), true);
  });

  it('is idempotent across call_ended and call_analyzed', async () => {
    const owner = await createOwner(client);
    await wireShop(owner.shop.id);
    const date = nextWeekday(2);

    const ended = await signedPost({
      event: 'call_ended',
      call: {
        call_id: 'call-dup-1',
        agent_id: 'agent_test_shop',
        direction: 'inbound',
        from_number: '+34655112233',
        to_number: '+34910000111',
        call_status: 'ended',
        call_analysis: {
          custom_analysis_data: {
            customer_name: 'Pedro Ruiz',
            appointment_date: date,
            appointment_time: '12:00',
          },
        },
      },
    });
    assert.equal(ended.status, 201);

    const analysed = await signedPost(
      analysedCall('call-dup-1', {
        customer_name: 'Pedro Ruiz Gomez',
        appointment_reason: 'Oil change',
        appointment_date: date,
        appointment_time: '12:00',
      }),
    );
    assert.equal(analysed.status, 200);
    assert.equal(analysed.body.updated, true);
    assert.equal(analysed.body.appointment.customer_name, 'Pedro Ruiz Gomez');
    assert.equal(analysed.body.appointment.service_type, 'Oil change');
    assert.equal(analysed.body.appointment.id, ended.body.appointment.id);

    const count = await query(`SELECT count(*)::int AS n FROM appointments WHERE shop_id = $1`, [owner.shop.id]);
    assert.equal(count.rows[0].n, 1);
  });

  it('accepts Spanish extraction fields and a local phone number', async () => {
    const owner = await createOwner(client);
    await wireShop(owner.shop.id);
    const date = nextWeekday(3);

    const [day, month, year] = date.split('-').reverse();
    const response = await signedPost(
      analysedCall('call-es-1', {
        nombre_cliente: 'Carmen Delgado',
        telefono_cliente: '655 99 88 77',
        motivo_de_la_cita: 'Cambio de neumáticos',
        fecha: `${day}/${month}/${year}`,
        hora: '16:00',
      }),
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.appointment.customer_name, 'Carmen Delgado');
    assert.equal(response.body.appointment.customer_phone, '+34655998877');
    assert.equal(response.body.appointment.service_type, 'Cambio de neumáticos');
    assert.match(response.body.appointment.scheduled_local, /16:00/);
  });

  it('still creates a booking when the time is missing', async () => {
    const owner = await createOwner(client);
    await wireShop(owner.shop.id);

    const response = await signedPost(
      analysedCall('call-vague-1', {
        customer_name: 'Ana Solis',
        appointment_reason: 'Engine noise',
      }),
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.needs_review, true);
    assert.equal(response.body.appointment.status, 'confirmed');
    assert.ok(response.body.appointment.notes.includes('did not capture a date'));
  });

  it('ignores transcript updates and unmatched shops', async () => {
    const transcript = await signedPost({
      event: 'transcript_updated',
      call: { call_id: 'tr-1', agent_id: 'agent_test_shop' },
    });
    assert.equal(transcript.status, 202);

    const unmatched = await signedPost(
      analysedCall('call-orphan', { customer_name: 'Nobody' }, { agent_id: 'unknown', to_number: '+19990001111' }),
    );
    assert.equal(unmatched.status, 200);
    assert.equal(unmatched.body.reason, 'shop_not_matched');
  });
});
