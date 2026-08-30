import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { query, queryOne } from '../../server/db/index.js';
import { flushRetellWebhookWork } from '../../server/routes/webhooks.js';
import { signWebhook } from '../../server/services/retell.js';
import {
  closeDatabase,
  createOwner,
  createSuperAdmin,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';

const SECRET = process.env.RETELL_API_KEY;

describe('Super Admin CLIENTES / platform leads', () => {
  let client;

  before(async () => {
    client = await startTestServer();
  });
  after(async () => {
    await client.close();
    await closeDatabase();
  });
  beforeEach(resetDatabase);

  async function signedPost(payload) {
    const raw = JSON.stringify(payload);
    const response = await client.request('POST', '/api/webhooks/retell', {
      body: raw,
      headers: { 'x-retell-signature': signWebhook(raw, SECRET) },
    });
    await flushRetellWebhookWork();
    return response;
  }

  function salesCall(callId, analysis, overrides = {}) {
    return {
      event: 'call_analyzed',
      call: {
        call_id: callId,
        agent_id: 'agent_platform_sales',
        call_type: 'phone_call',
        direction: 'inbound',
        from_number: '+34655119900',
        to_number: '+34919990000',
        call_status: 'ended',
        start_timestamp: Date.now() - 90_000,
        end_timestamp: Date.now(),
        duration_ms: 90_000,
        metadata: { purpose: 'clientes' },
        call_analysis: {
          call_summary: 'Taller interesado en DerteApp.',
          custom_analysis_data: analysis,
        },
        ...overrides,
      },
    };
  }

  it('ingests a Retell sales call and lists it for Super Admin only', async () => {
    const admin = await createSuperAdmin(client);
    const owner = await createOwner(client, { shop_name: 'Taller Ajeno' });

    const response = await signedPost(
      salesCall('lead-call-1', {
        nombre: 'María del Carmen Díaz',
        nombre_taller: 'Talleres Atlántico',
        isla: 'Tenerife',
        telefono: '+34655119900',
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const row = await queryOne(`SELECT * FROM platform_leads WHERE external_ref = 'retell:lead-call-1'`);
    assert.ok(row);
    assert.equal(row.customer_name, 'María del Carmen Díaz');
    assert.equal(row.shop_name, 'Talleres Atlántico');
    assert.equal(row.island, 'Tenerife');
    assert.equal(row.status, 'pending');

    const urgencia = await queryOne(`SELECT id FROM urgencias WHERE external_ref = 'retell:lead-call-1'`);
    assert.equal(urgencia, null);

    const forbidden = await client.get('/api/admin/clientes', { token: owner.token });
    assert.equal(forbidden.status, 403);

    const list = await client.get('/api/admin/clientes', { token: admin.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.pending, 1);
    assert.equal(list.body.leads.length, 1);
    assert.equal(list.body.leads[0].customer_name, 'María del Carmen Díaz');
    assert.equal(list.body.leads[0].shop_name, 'Talleres Atlántico');
    assert.equal(list.body.leads[0].island, 'Tenerife');
    assert.ok(list.body.leads[0].customer_tel_link);
    assert.ok(list.body.leads[0].customer_whatsapp_link);

    const badge = await client.get('/api/admin/clientes/status', { token: admin.token });
    assert.equal(badge.status, 200);
    assert.equal(badge.body.pending, 1);

    const overview = await client.get('/api/admin/overview', { token: admin.token });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.totals.pending_leads, 1);

    const inbox = await queryOne(
      `SELECT count(*)::int AS n FROM notifications WHERE type = 'platform_lead' AND user_id = $1`,
      [admin.user.id],
    );
    assert.equal(inbox.n, 1);
    const note = await queryOne(
      `SELECT title, body, link FROM notifications WHERE type = 'platform_lead' AND user_id = $1`,
      [admin.user.id],
    );
    assert.equal(note.title, 'Nuevo Taller Interesado');
    assert.equal(note.body, 'Talleres Atlántico (Tenerife) - María del Carmen Díaz');
    assert.equal(note.link, '/admin/clientes');

    const patched = await client.patch(
      `/api/admin/clientes/${list.body.leads[0].id}`,
      { status: 'contacted' },
      { token: admin.token },
    );
    assert.equal(patched.status, 200);
    assert.equal(patched.body.lead.status, 'contacted');

    const active = await client.get('/api/admin/clientes?scope=active', { token: admin.token });
    assert.equal(active.body.leads.length, 0);
    assert.equal(active.body.pending, 0);

    const history = await client.get('/api/admin/clientes?scope=history', { token: admin.token });
    assert.equal(history.body.leads.length, 1);
    assert.equal(history.body.leads[0].status, 'contacted');
  });

  it('does not turn a workshop Urgencia into a platform lead', async () => {
    const owner = await createOwner(client, { shop_name: 'Retell Garage' });
    await query(
      `UPDATE shops SET retell_agent_id = $2, retell_did = $3, country_code = '34' WHERE id = $1`,
      [owner.shop.id, 'agent_test_shop', '+34910000111'],
    );

    const response = await signedPost({
      event: 'call_analyzed',
      call: {
        call_id: 'shop-urgencia-1',
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
          call_summary: 'Avería urgente.',
          custom_analysis_data: {
            customer_name: 'Laura Jimenez',
            vehicle: 'Seat Ibiza',
            license_plate: '4455XYZ',
            motivo_urgencia: 'Frenos',
            is_urgent: true,
          },
        },
      },
    });
    assert.equal(response.status, 200);

    const leads = await queryOne(`SELECT count(*)::int AS n FROM platform_leads`);
    assert.equal(leads.n, 0);
  });

  it('does not save a sales lead missing isla, nombre, taller or teléfono', async () => {
    const incomplete = [
      { nombre: 'Ana Pérez', nombre_taller: 'Talleres Sol' },
      { nombre_taller: 'Talleres Sol', isla: 'Tenerife', telefono: '+34655119900' },
      { nombre: 'Ana Pérez', isla: 'Tenerife', telefono: '+34655119900' },
      { nombre: 'The user', nombre_taller: 'Talleres Sol', isla: 'Tenerife' },
      { nombre: 'Obteniendo nombre', nombre_taller: 'Talleres Sol', isla: 'Tenerife' },
      { nombre: 'Nombre pendiente', nombre_taller: 'Talleres Sol', isla: 'Tenerife' },
    ];

    for (const [index, analysis] of incomplete.entries()) {
      const response = await signedPost(salesCall(`lead-incomplete-${index}`, analysis));
      assert.equal(response.status, 200);
      assert.equal(response.body.received, true);
    }

    const noPhone = await signedPost(
      salesCall(
        'lead-incomplete-nophone',
        { nombre: 'Ana Pérez', nombre_taller: 'Talleres Sol', isla: 'Tenerife' },
        { from_number: '', user_number: '', customer_number: '' },
      ),
    );
    assert.equal(noPhone.status, 200);
    assert.equal(noPhone.body.received, true);

    const leads = await queryOne(`SELECT count(*)::int AS n FROM platform_leads`);
    assert.equal(leads.n, 0);

    const urgencias = await queryOne(`SELECT count(*)::int AS n FROM urgencias`);
    assert.equal(urgencias.n, 0);
  });

  it('saves a complete lead when the phone only comes from the call CLI', async () => {
    const response = await signedPost(
      salesCall(
        'lead-cli-phone',
        {
          nombre: 'Luis Morales',
          taller: 'Taller Morales',
          isla: 'Gran Canaria',
        },
        { from_number: '+34666777888' },
      ),
    );
    assert.equal(response.status, 200);

    const row = await queryOne(`SELECT * FROM platform_leads WHERE external_ref = 'retell:lead-cli-phone'`);
    assert.ok(row);
    assert.equal(row.customer_name, 'Luis Morales');
    assert.equal(row.shop_name, 'Taller Morales');
    assert.equal(row.island, 'Gran Canaria');
    assert.equal(row.customer_phone, '+34666777888');
  });

  it('saves each completed call as its own lead even when the phone repeats', async () => {
    await createSuperAdmin(client);
    const first = await signedPost(
      salesCall('lead-repeat-1', {
        nombre: 'María Díaz',
        nombre_taller: 'Talleres Atlántico',
        isla: 'Tenerife',
        telefono: '+34655119900',
      }),
    );
    assert.equal(first.status, 200);

    const second = await signedPost(
      salesCall('lead-repeat-2', {
        nombre: 'María Díaz',
        nombre_taller: 'Talleres Atlántico',
        isla: 'Lanzarote',
        telefono: '+34 655 119 900',
      }),
    );
    assert.equal(second.status, 200);

    const count = await queryOne(`SELECT count(*)::int AS n FROM platform_leads`);
    assert.equal(count.n, 2);
    const firstRow = await queryOne(`SELECT * FROM platform_leads WHERE external_ref = 'retell:lead-repeat-1'`);
    const secondRow = await queryOne(`SELECT * FROM platform_leads WHERE external_ref = 'retell:lead-repeat-2'`);
    assert.equal(firstRow.island, 'Tenerife');
    assert.equal(secondRow.island, 'Lanzarote');
    assert.notEqual(firstRow.id, secondRow.id);

    const replay = await signedPost(
      salesCall('lead-repeat-1', {
        nombre: 'María del Carmen Díaz',
        nombre_taller: 'Talleres Atlántico',
        isla: 'Tenerife',
        telefono: '+34655119900',
      }),
    );
    assert.equal(replay.status, 200);
    const afterReplay = await queryOne(`SELECT count(*)::int AS n FROM platform_leads`);
    assert.equal(afterReplay.n, 2);
    const stored = await queryOne(`SELECT * FROM platform_leads WHERE external_ref = 'retell:lead-repeat-1'`);
    assert.equal(stored.customer_name, 'María Díaz');

    const notes = await queryOne(`SELECT count(*)::int AS n FROM notifications WHERE type = 'platform_lead'`);
    assert.equal(notes.n, 2);
  });
});
