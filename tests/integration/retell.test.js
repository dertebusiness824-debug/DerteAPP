import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { query } from '../../server/db/index.js';
import { flushRetellWebhookWork } from '../../server/routes/webhooks.js';
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

  async function signedPost(payload) {
    const raw = JSON.stringify(payload);
    const response = await client.request('POST', '/api/webhooks/retell', {
      body: raw,
      headers: { 'x-retell-signature': signWebhook(raw, SECRET) },
    });
    await flushRetellWebhookWork();
    return response;
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
    assert.equal(response.body.received, true);
  });

  it('always ACKs 200 { received: true } and never 400', async () => {
    const empty = await client.post('/api/webhooks/retell', {});
    assert.equal(empty.status, 200);
    assert.equal(empty.body.received, true);

    const payload = analysedCall('ack-1', { customer_name: 'X', vehicle: 'Seat Ibiza' });
    const bare = await client.post('/api/webhooks/retell', payload);
    assert.equal(bare.status, 200);
    assert.equal(bare.body.received, true);
    assert.notEqual(bare.status, 400);

    const wrong = await client.request('POST', '/api/webhooks/retell', {
      body: payload,
      headers: { 'x-retell-signature': signWebhook(JSON.stringify(payload), 'wrong-secret') },
    });
    assert.equal(wrong.status, 200);
    assert.equal(wrong.body.received, true);
    await flushRetellWebhookWork();

    // Invalid JSON must still ACK 200 (body-parser must not return 400).
    const badJson = await client.request('POST', '/api/webhooks/retell', {
      body: '{not-json',
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(badJson.status, 200);
    assert.equal(badJson.body.received, true);
  });

  it('creates a booking from a finished call (background ingest)', async () => {
    const owner = await createOwner(client, { shop_name: 'Retell Garage' });
    await wireShop(owner.shop.id);
    const date = nextWeekday(1);

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

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const list = await client.get(`/api/appointments?shop_id=${owner.shop.id}&date=${date}`, {
      token: owner.token,
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.appointments.length, 1);
    assert.equal(list.body.appointments[0].customer_name, 'Laura Jimenez');
    assert.equal(list.body.appointments[0].customer_phone, '+34655112233');
    assert.equal(list.body.appointments[0].service_type, 'Brake inspection');
    assert.equal(list.body.appointments[0].vehicle.plate, '4455XYZ');
    assert.match(list.body.appointments[0].scheduled_local, /10:30/);

    const calls = await client.get(`/api/telephony/calls?shop_id=${owner.shop.id}`, { token: owner.token });
    assert.equal(calls.body.calls.some((entry) => entry.provider === 'retell' && entry.status === 'completed'), true);
  });

  it('is idempotent: call_ended waits, call_analyzed with vehicle creates booking', async () => {
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
        duration_ms: 70_000,
        start_timestamp: Date.now() - 70_000,
        end_timestamp: Date.now(),
      },
    });
    assert.equal(ended.status, 200);
    assert.equal(ended.body.received, true);
    assert.equal(ended.body.event, 'call_ended');

    const stub = await query(`SELECT count(*)::int AS n FROM urgencias WHERE external_ref = $1`, [
      'retell:call-dup-1',
    ]);
    assert.equal(stub.rows[0].n, 0);

    const analysed = await signedPost(
      analysedCall('call-dup-1', {
        customer_name: 'Pedro Ruiz Gomez',
        appointment_reason: 'Oil change',
        appointment_date: date,
        appointment_time: '12:00',
        vehicle: 'VW Golf',
      }),
    );
    assert.equal(analysed.status, 200);
    assert.equal(analysed.body.received, true);

    const rows = await query(`SELECT id, customer_name, service_type FROM appointments WHERE shop_id = $1`, [
      owner.shop.id,
    ]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].customer_name, 'Pedro Ruiz Gomez');
    assert.equal(rows.rows[0].service_type, 'Oil change');
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
        vehiculo: 'Renault Clio',
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const appt = await query(`SELECT * FROM appointments WHERE external_ref = $1`, ['retell:call-es-1']);
    assert.equal(appt.rows[0].customer_name, 'Carmen Delgado');
    assert.equal(appt.rows[0].customer_phone, '+34655998877');
    assert.equal(appt.rows[0].service_type, 'Cambio de neumáticos');
  });

  it('ignores call_analyzed without vehicle and routes incomplete+vehicle to Urgencias', async () => {
    const owner = await createOwner(client);
    await wireShop(owner.shop.id);

    const ignored = await signedPost({
      event: 'call_analyzed',
      call: {
        call_id: 'call-vague-no-car',
        agent_id: 'agent_test_shop',
        call_type: 'phone_call',
        direction: 'inbound',
        from_number: '+34655112233',
        to_number: '+34910000111',
        call_status: 'ended',
        duration_ms: 90_000,
        start_timestamp: Date.now() - 90_000,
        end_timestamp: Date.now(),
        call_analysis: {
          custom_analysis_data: {
            customer_name: 'Ana Solis',
            appointment_reason: 'Engine noise',
          },
        },
      },
    });
    assert.equal(ignored.status, 200);
    assert.match(String(ignored.body.message || ''), /vehículo|vehiculo/i);
    assert.equal(
      (await query(`SELECT count(*)::int AS n FROM urgencias WHERE external_ref = $1`, [
        'retell:call-vague-no-car',
      ])).rows[0].n,
      0,
    );

    const response = await signedPost({
      event: 'call_analyzed',
      call: {
        call_id: 'call-vague-1',
        agent_id: 'agent_test_shop',
        call_type: 'phone_call',
        direction: 'inbound',
        from_number: '+34655112233',
        to_number: '+34910000111',
        call_status: 'ended',
        duration_ms: 90_000,
        start_timestamp: Date.now() - 90_000,
        end_timestamp: Date.now(),
        call_analysis: {
          custom_analysis_data: {
            customer_name: 'Ana Solis',
            appointment_reason: 'Engine noise',
            vehicle: 'Opel Corsa',
          },
        },
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const appt = await query(`SELECT count(*)::int AS n FROM appointments WHERE external_ref = $1`, [
      'retell:call-vague-1',
    ]);
    assert.equal(appt.rows[0].n, 0);

    const urg = await query(`SELECT * FROM urgencias WHERE external_ref = $1`, ['retell:call-vague-1']);
    assert.equal(urg.rows[0].customer_name, 'Ana Solis');
    assert.equal(urg.rows[0].reason, 'Engine noise');
    assert.equal(urg.rows[0].vehicle_model, 'Opel Corsa');
    assert.equal(urg.rows[0].status, 'pending');
    assert.equal(urg.rows[0].title, 'Solicitud de servicio urgente');
  });

  it('never creates a reserva named Caller +34…', async () => {
    const owner = await createOwner(client, { shop_name: 'Caller Block Garage' });
    await wireShop(owner.shop.id);
    const date = nextWeekday(2);

    const response = await signedPost(
      analysedCall('call-caller-placeholder', {
        customer_name: 'Caller +34655112233',
        appointment_reason: 'Something',
        appointment_date: date,
        appointment_time: '10:00',
        vehicle: 'Peugeot 208',
      }),
    );
    assert.equal(response.status, 200);

    const appointments = await query(`SELECT count(*)::int AS n FROM appointments WHERE shop_id = $1`, [
      owner.shop.id,
    ]);
    assert.equal(appointments.rows[0].n, 0);

    const urg = await query(`SELECT * FROM urgencias WHERE external_ref = $1`, [
      'retell:call-caller-placeholder',
    ]);
    assert.equal(urg.rows[0].status, 'pending');
    assert.equal(urg.rows[0].customer_name, 'Sin nombre');
  });

  it('call_analyzed maps custom_analysis_data into urgencias when is_urgent', async () => {
    const owner = await createOwner(client, { shop_name: 'Retell Urgencias' });
    await wireShop(owner.shop.id);

    const response = await signedPost({
      event: 'call_analyzed',
      call: {
        call_id: 'call-analyzed-map-1',
        agent_id: 'agent_test_shop',
        call_type: 'phone_call',
        direction: 'inbound',
        from_number: '+34655110000',
        to_number: '+34910000111',
        call_status: 'ended',
        start_timestamp: Date.now() - 90_000,
        end_timestamp: Date.now(),
        transcript: 'User: Tengo un pinchazo',
        retell_llm_dynamic_variables: {
          customer_name: 'Should be overridden',
        },
        call_analysis: {
          call_summary: 'Pinchazo en A-2',
          custom_analysis_data: {
            is_urgent: true,
            marca: 'Ford',
            modelo: 'Focus',
            nombre_cliente: 'Paco Lopez',
            telefono: '655 00 11 22',
            motivo_urgencia: 'Pinchazo',
          },
        },
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const list = await client.get(`/api/urgencias?shop_id=${owner.shop.id}&scope=active`, {
      token: owner.token,
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.urgencias[0].customer_name, 'Paco Lopez');
    assert.equal(list.body.urgencias[0].customer_phone, '+34655001122');
    assert.equal(list.body.urgencias[0].vehicle.make, 'Ford');
    assert.equal(list.body.urgencias[0].vehicle.model, 'Focus');
    assert.equal(list.body.urgencias[0].reason, 'Pinchazo');

    const log = await query(`SELECT status, caller_phone, raw FROM call_logs WHERE external_id = 'call-analyzed-map-1'`);
    assert.equal(log.rows[0].status, 'completed');
    assert.ok(log.rows[0].raw?.retell?.summary);
  });

  it('matches Melian DID +34828643107 and uses user_number as CLI', async () => {
    const owner = await createOwner(client, { shop_name: 'Talleres Melian' });
    await query(
      `UPDATE shops SET retell_did = $2, country_code = '34' WHERE id = $1`,
      [owner.shop.id, '+34828643107'],
    );

    const response = await signedPost({
      event: 'call_analyzed',
      call: {
        call_id: 'call-melian-1',
        direction: 'inbound',
        user_number: '+34655112233',
        to_number: '+34828643107',
        call_status: 'ended',
        duration_ms: 90_000,
        start_timestamp: Date.now() - 90_000,
        end_timestamp: Date.now(),
        call_analysis: {
          call_summary: 'Avería urgente',
          custom_analysis_data: {
            is_urgent: true,
            nombre_cliente: 'Cliente Melian',
            motivo_urgencia: 'No arranca',
            vehiculo: 'Citroen Berlingo',
          },
        },
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const urg = await query(`SELECT * FROM urgencias WHERE external_ref = $1`, ['retell:call-melian-1']);
    assert.equal(urg.rows[0].shop_id, owner.shop.id);
    assert.equal(urg.rows[0].customer_name, 'Cliente Melian');
    assert.equal(urg.rows[0].customer_phone, '+34655112233');

    const log = await query(`SELECT status, caller_phone FROM call_logs WHERE external_id = 'call-melian-1'`);
    assert.equal(log.rows[0].status, 'completed');
    assert.equal(log.rows[0].caller_phone, '+34655112233');
  });

  it('call_ended waits then call_analyzed with vehicle creates urgencia', async () => {
    const owner = await createOwner(client, { shop_name: 'Agent Match Garage' });
    await wireShop(owner.shop.id);

    const ended = await signedPost({
      event: 'call_ended',
      call: {
        call_id: 'call-ended-urgent-1',
        agent_id: 'agent_test_shop',
        direction: 'inbound',
        from_number: '+34655777888',
        to_number: '+34910000111',
        call_status: 'ended',
        duration_ms: 55_000,
        start_timestamp: Date.now() - 55_000,
        end_timestamp: Date.now(),
      },
    });

    assert.equal(ended.status, 200);
    assert.equal(ended.body.received, true);
    assert.equal(ended.body.event, 'call_ended');

    const before = await query(`SELECT count(*)::int AS n FROM urgencias WHERE external_ref = $1`, [
      'retell:call-ended-urgent-1',
    ]);
    assert.equal(before.rows[0].n, 0);

    const analysed = await signedPost({
      event: 'call_analyzed',
      call: {
        call_id: 'call-ended-urgent-1',
        agent_id: 'agent_test_shop',
        direction: 'inbound',
        from_number: '+34655777888',
        to_number: '+34910000111',
        call_status: 'ended',
        duration_ms: 55_000,
        start_timestamp: Date.now() - 55_000,
        end_timestamp: Date.now(),
        call_analysis: {
          custom_analysis_data: {
            is_urgent: true,
            nombre: 'Ana Urgente',
            vehiculo: 'Seat Ibiza',
            matricula: '1234ABC',
            motivo: 'Humos en motor',
          },
        },
      },
    });
    assert.equal(analysed.status, 200);
    assert.equal(analysed.body.received, true);

    const urg = await query(`SELECT * FROM urgencias WHERE external_ref = $1`, [
      'retell:call-ended-urgent-1',
    ]);
    assert.equal(urg.rows.length, 1);
    assert.equal(urg.rows[0].shop_id, owner.shop.id);
    assert.equal(urg.rows[0].customer_name, 'Ana Urgente');
    assert.equal(urg.rows[0].vehicle_model, 'Seat Ibiza');
    assert.equal(urg.rows[0].vehicle_plate, '1234ABC');
    assert.equal(urg.rows[0].reason, 'Humos en motor');

    const log = await query(
      `SELECT status, caller_phone FROM call_logs WHERE external_id = 'call-ended-urgent-1'`,
    );
    assert.equal(log.rows[0].status, 'completed');
    assert.equal(log.rows[0].caller_phone, '+34655777888');
  });

  it('ACKs ignored events and unmatched shops with 200', async () => {
    const transcript = await signedPost({
      event: 'transcript_updated',
      call: { call_id: 'tr-1', agent_id: 'agent_test_shop' },
    });
    assert.equal(transcript.status, 200);
    assert.equal(transcript.body.received, true);
    assert.match(String(transcript.body.message || ''), /call_ended|call_analyzed/i);

    const unmatched = await signedPost(
      analysedCall(
        'call-orphan',
        { customer_name: 'Nobody', vehicle: 'Fiat Panda' },
        { agent_id: 'unknown', to_number: '+19990001111' },
      ),
    );
    assert.equal(unmatched.status, 200);
    assert.equal(unmatched.body.received, true);

    const log = await query(`SELECT shop_id, status FROM call_logs WHERE external_id = 'call-orphan'`);
    assert.equal(log.rows[0]?.shop_id ?? null, null);
    assert.equal(log.rows[0]?.status, 'completed');
  });

  it('stores urgent calls in Urgencias (not appointments)', async () => {
    const owner = await createOwner(client, { shop_name: 'Urgencias Garage' });
    await wireShop(owner.shop.id);

    const response = await signedPost(
      analysedCall('call-urgent-1', {
        is_urgent: true,
        customer_name: 'Marta Urgente',
        customer_phone: '+34655119988',
        marca: 'Seat',
        modelo: 'Ibiza',
        matricula: '1234ABC',
        motivo_urgencia: 'Pinchazo en carretera',
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const active = await client.get(`/api/urgencias?shop_id=${owner.shop.id}&scope=active`, {
      token: owner.token,
    });
    assert.equal(active.status, 200);
    assert.equal(active.body.count, 1);
    assert.equal(active.body.urgencias[0].customer_name, 'Marta Urgente');
    assert.equal(active.body.urgencias[0].is_urgent, true);
    assert.equal(active.body.urgencias[0].status, 'pending');
    assert.equal(active.body.urgencias[0].status_label, 'pendiente');
    assert.equal(active.body.urgencias[0].title, 'Solicitud de servicio urgente');
    assert.equal(active.body.urgencias[0].vehicle.make, 'Seat');
    assert.equal(active.body.urgencias[0].vehicle.plate, '1234ABC');
    assert.ok(active.body.urgencias[0].customer_tel_link?.startsWith('tel:'));
    assert.equal(active.body.urgencias[0].can_accept, true);

    const appointments = await query(`SELECT count(*)::int AS n FROM appointments WHERE shop_id = $1`, [
      owner.shop.id,
    ]);
    assert.equal(appointments.rows[0].n, 0);
  });

  it('urgent calls with a captured slot still skip reservas until accepted', async () => {
    const owner = await createOwner(client, { shop_name: 'Urgent Slot Garage' });
    await wireShop(owner.shop.id);
    const date = nextWeekday(2);

    const response = await signedPost(
      analysedCall('call-urgent-with-slot', {
        is_urgent: true,
        customer_name: 'Luis Urgente',
        customer_phone: '+34655990011',
        marca: 'VW',
        modelo: 'Golf',
        motivo_urgencia: 'Fuga de aceite',
        appointment_date: date,
        appointment_time: '11:00',
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const urg = await query(`SELECT * FROM urgencias WHERE external_ref = $1`, [
      'retell:call-urgent-with-slot',
    ]);
    assert.equal(urg.rows.length, 1);
    assert.equal(urg.rows[0].status, 'pending');
    assert.equal(urg.rows[0].title, 'Solicitud de servicio urgente');

    const appointments = await query(`SELECT count(*)::int AS n FROM appointments WHERE shop_id = $1`, [
      owner.shop.id,
    ]);
    assert.equal(appointments.rows[0].n, 0);
  });

  it('ignores missed/short calls and does not create urgencias', async () => {
    const owner = await createOwner(client, { shop_name: 'Short Call Garage' });
    await wireShop(owner.shop.id);

    const response = await signedPost({
      event: 'call_analyzed',
      call: {
        call_id: 'call-short-hangup-1',
        agent_id: 'agent_test_shop',
        direction: 'inbound',
        from_number: '+34655999000',
        to_number: '+34910000111',
        call_status: 'ended',
        duration_ms: 6_000,
        start_timestamp: Date.now() - 6_000,
        end_timestamp: Date.now(),
        disconnection_reason: 'user_hangup',
        call_analysis: {
          call_successful: false,
          custom_analysis_data: {
            is_urgent: true,
            nombre: 'No Debe Guardarse',
            motivo: 'Colgó al instante',
          },
        },
      },
    });

    assert.equal(response.status, 200);
    assert.match(String(response.body.message || ''), /Duraci[oó]n\s*<=\s*40s/i);

    const urg = await query(`SELECT count(*)::int AS n FROM urgencias WHERE shop_id = $1`, [
      owner.shop.id,
    ]);
    assert.equal(urg.rows[0].n, 0);

    const appt = await query(`SELECT count(*)::int AS n FROM appointments WHERE shop_id = $1`, [
      owner.shop.id,
    ]);
    assert.equal(appt.rows[0].n, 0);
  });

  it('accepts an urgencia into a confirmed appointment', async () => {
    const owner = await createOwner(client, { shop_name: 'Accept Urgencia Garage' });
    await wireShop(owner.shop.id);

    await signedPost(
      analysedCall('call-urgent-accept-1', {
        is_urgent: true,
        customer_name: 'Eva Aceptar',
        customer_phone: '+34655123456',
        marca: 'Toyota',
        modelo: 'Corolla',
        matricula: '9876XYZ',
        motivo_urgencia: 'No arranca',
      }),
    );

    const list = await client.get(`/api/urgencias?shop_id=${owner.shop.id}&scope=active`, {
      token: owner.token,
    });
    const urgencia = list.body.urgencias[0];
    assert.ok(urgencia?.id);

    const accepted = await client.post(
      `/api/urgencias/${urgencia.id}/accept`,
      {
        shop_id: owner.shop.id,
        scheduled_date: nextWeekday(3),
        scheduled_time: '11:30',
      },
      { token: owner.token },
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.urgencia.status, 'accepted');
    assert.equal(accepted.body.urgencia.can_accept, false);
    assert.equal(accepted.body.appointment.status, 'confirmed');
    assert.equal(accepted.body.appointment.customer_name, 'Eva Aceptar');
    assert.equal(accepted.body.appointment.vehicle.plate, '9876XYZ');
    assert.ok(accepted.body.urgencia.appointment_id);
    assert.match(accepted.body.appointment.scheduled_local || '', /11:30/);

    const again = await client.post(
      `/api/urgencias/${urgencia.id}/accept`,
      { shop_id: owner.shop.id },
      { token: owner.token },
    );
    assert.equal(again.status, 200);
    assert.equal(again.body.already_accepted, true);
    assert.equal(again.body.appointment.id, accepted.body.appointment.id);
  });
});
