import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import { queryOne } from '../../server/db/index.js';
import { closeDatabase, createOwner, createSuperAdmin, resetDatabase, startTestServer } from '../helpers/harness.js';

const SECRET = process.env.ZADARMA_SECRET;
const STUB_PORT = 39_547; // must match ZADARMA_API_URL in scripts/run-tests.js
const SHOP_DID = '+34910000000';

let app;
let owner;
let admin;
let shopId;
let stub;
const stubRequests = [];

/** Stand-in for api.zadarma.com that checks the signature we send. */
function startZadarmaStub() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const query = url.search.replace(/^\?/, '') || body;
      const [key, signature] = String(req.headers.authorization ?? '').split(':');

      const md5 = crypto.createHash('md5').update(query).digest('hex');
      const expected = Buffer.from(
        crypto.createHmac('sha1', SECRET).update(`${url.pathname}${query}${md5}`).digest('hex'),
      ).toString('base64');

      stubRequests.push({ path: url.pathname, query, key, signatureValid: signature === expected });

      res.setHeader('content-type', 'application/json');
      if (signature !== expected) {
        res.statusCode = 401;
        res.end(JSON.stringify({ status: 'error', message: 'signature check failed' }));
        return;
      }
      if (url.pathname === '/v1/info/balance/') {
        res.end(JSON.stringify({ status: 'success', balance: 42.5, currency: 'EUR' }));
        return;
      }
      if (url.pathname === '/v1/request/callback/') {
        res.end(JSON.stringify({ status: 'success', from: '', to: '', time: 1, pbx_call_id: 'stub-pbx-1' }));
        return;
      }
      res.end(JSON.stringify({ status: 'success' }));
    });
  });
  server.listen(STUB_PORT, '127.0.0.1');
  return once(server, 'listening').then(() => server);
}

/** Signs a webhook payload the way Zadarma does. */
const webhookSignature = (fields) =>
  Buffer.from(crypto.createHmac('sha1', SECRET).update(fields.join('')).digest('hex')).toString('base64');

before(async () => {
  await resetDatabase();
  app = await startTestServer();
  stub = await startZadarmaStub();
  admin = await createSuperAdmin(app);
  owner = await createOwner(app, { shop_name: 'Telephony Garage' });
  shopId = owner.shop.id;
  // Only a Super Admin may bind provider routing to a tenant.
  await app.patch(`/api/shops/${shopId}`, { zadarma_did: SHOP_DID, zadarma_sip: '100' }, { token: admin.token });
});

after(async () => {
  stub.close();
  await once(stub, 'close');
  await app.close();
  await closeDatabase();
});

describe('telephony status and fallbacks', () => {
  it('reports the provider state and the webhook URL to configure', async () => {
    const response = await app.get('/api/telephony/status', { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'zadarma');
    assert.equal(response.body.configured, true);
    assert.match(response.body.webhook_url, /\/api\/telephony\/webhooks\/zadarma$/);
    assert.deepEqual(response.body.fallbacks, ['tel', 'whatsapp']);
  });

  it('builds one-tap call and WhatsApp links for any number', async () => {
    const response = await app.get('/api/telephony/links?phone=%2B34611000001&message=Your%20car%20is%20ready', {
      token: owner.token,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.tel_link, 'tel:+34611000001');
    assert.equal(response.body.phone_display, '+34 611 000 001');
    assert.match(response.body.whatsapp_link, /^https:\/\/wa\.me\/34611000001\?text=/);
  });

  it('rejects a malformed number', async () => {
    assert.equal((await app.get('/api/telephony/links?phone=nonsense', { token: owner.token })).status, 400);
  });
});

describe('outbound calls through Zadarma', () => {
  it('signs the callback request and logs the call', async () => {
    stubRequests.length = 0;
    const response = await app.post(
      '/api/telephony/call',
      { shop_id: shopId, to: '+34611000001' },
      { token: owner.token },
    );
    assert.equal(response.status, 201);

    const request = stubRequests.find((entry) => entry.path === '/v1/request/callback/');
    assert.ok(request, 'the callback endpoint should have been called');
    assert.equal(request.signatureValid, true, 'Zadarma must accept our signature');
    assert.equal(request.key, 'test-key');
    // The owner is dialled first, then bridged to the customer.
    assert.match(request.query, /from=%2B/);
    assert.match(request.query, /to=34611000001/);
    assert.match(request.query, /sip=100/);

    assert.equal(response.body.call.direction, 'out');
    assert.equal(response.body.call.callee_phone, '+34611000001');
    assert.equal(response.body.call.status, 'started');

    const log = await queryOne('SELECT * FROM call_logs WHERE id = $1', [response.body.call.id]);
    assert.equal(log.shop_id, shopId);
    assert.equal(log.external_id, 'stub-pbx-1');
  });

  it('refuses to dial an invalid number', async () => {
    const response = await app.post('/api/telephony/call', { shop_id: shopId, to: 'abc' }, { token: owner.token });
    assert.equal(response.status, 400);
  });

  it('will not let one shop dial on behalf of another', async () => {
    const other = await createOwner(app, { shop_name: 'Nosy Garage' });
    const response = await app.post(
      '/api/telephony/call',
      { shop_id: shopId, to: '+34611000001' },
      { token: other.token },
    );
    assert.equal(response.status, 403);
  });

  it('keeps the account balance to Super Admins', async () => {
    const asAdmin = await app.get('/api/telephony/balance', { token: admin.token });
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.body.balance, 42.5);
    assert.equal((await app.get('/api/telephony/balance', { token: owner.token })).status, 403);
  });
});

describe('inbound call tracking via webhooks', () => {
  it('answers the zd_echo handshake so the URL can be saved in Zadarma', async () => {
    const response = await app.get('/api/telephony/webhooks/zadarma?zd_echo=handshake-123');
    assert.equal(response.status, 200);
    assert.equal(response.body, 'handshake-123');
  });

  it('rejects an unsigned notification', async () => {
    const response = await app.post(
      '/api/telephony/webhooks/zadarma',
      { event: 'NOTIFY_START', caller_id: '34611000001', called_did: SHOP_DID, pbx_call_id: 'unsigned-1' },
      { form: true },
    );
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'bad_signature');
  });

  it('rejects a notification signed with the wrong secret', async () => {
    const payload = { event: 'NOTIFY_START', caller_id: '34611000001', called_did: SHOP_DID, pbx_call_id: 'wrong-1' };
    const signature = Buffer.from(
      crypto.createHmac('sha1', 'not-the-secret').update('NOTIFY_START34611000001' + SHOP_DID).digest('hex'),
    ).toString('base64');
    const response = await app.post('/api/telephony/webhooks/zadarma', payload, {
      form: true,
      headers: { signature },
    });
    assert.equal(response.status, 401);
  });

  it('routes a signed inbound call to the shop that owns the DID', async () => {
    const payload = {
      event: 'NOTIFY_START',
      caller_id: '34611000001',
      called_did: SHOP_DID,
      pbx_call_id: 'inbound-call-1',
      call_start: new Date().toISOString(),
    };
    const response = await app.post('/api/telephony/webhooks/zadarma', payload, {
      form: true,
      headers: { signature: webhookSignature([payload.event, payload.caller_id, payload.called_did]) },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);

    const log = await queryOne(`SELECT * FROM call_logs WHERE external_id = $1`, ['inbound-call-1']);
    assert.ok(log, 'the call should be logged');
    assert.equal(log.shop_id, shopId);
    assert.equal(log.direction, 'in');
    assert.equal(log.status, 'ringing');
    assert.equal(log.caller_phone, '+34611000001');
  });

  it('merges later events into the same call record', async () => {
    const answer = {
      event: 'NOTIFY_ANSWER',
      caller_id: '34611000001',
      destination: SHOP_DID,
      pbx_call_id: 'inbound-call-1',
    };
    await app.post('/api/telephony/webhooks/zadarma', answer, {
      form: true,
      headers: { signature: webhookSignature([answer.event, answer.caller_id, answer.destination]) },
    });

    const end = {
      event: 'NOTIFY_END',
      caller_id: '34611000001',
      called_did: SHOP_DID,
      duration: '95',
      disposition: 'answered',
      pbx_call_id: 'inbound-call-1',
    };
    await app.post('/api/telephony/webhooks/zadarma', end, {
      form: true,
      headers: {
        signature: webhookSignature([end.event, end.caller_id, end.called_did, end.duration]),
      },
    });

    const logs = await queryOne(
      `SELECT count(*)::int AS total FROM call_logs WHERE external_id = 'inbound-call-1'`,
    );
    assert.equal(logs.total, 1, 'events must merge, not duplicate');

    const log = await queryOne(`SELECT * FROM call_logs WHERE external_id = 'inbound-call-1'`);
    assert.equal(log.status, 'completed');
    assert.equal(log.duration_seconds, 95);
    assert.ok(log.answered_at);
    assert.ok(log.ended_at);
  });

  it('records a missed call so the owner can chase it', async () => {
    const end = {
      event: 'NOTIFY_END',
      caller_id: '34611000002',
      called_did: SHOP_DID,
      duration: '0',
      disposition: 'no answer',
      pbx_call_id: 'missed-call-1',
    };
    await app.post('/api/telephony/webhooks/zadarma', end, {
      form: true,
      headers: { signature: webhookSignature([end.event, end.caller_id, end.called_did, end.duration]) },
    });

    const log = await queryOne(`SELECT * FROM call_logs WHERE external_id = 'missed-call-1'`);
    assert.equal(log.status, 'no_answer');

    const stats = await app.get(`/api/telephony/stats?shop_id=${shopId}&days=1`, { token: owner.token });
    assert.ok(stats.body.missed >= 1);
  });

  it('links an inbound call to a matching booking', async () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 3);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
    const booked = await app.post(
      '/api/appointments',
      {
        shop_id: shopId,
        customer_name: 'Known Caller',
        customer_phone: '+34611000777',
        scheduled_at: `${date.toISOString().slice(0, 10)}T10:00:00+02:00`,
        enforce_schedule: false,
      },
      { token: owner.token },
    );
    assert.equal(booked.status, 201);

    const payload = {
      event: 'NOTIFY_START',
      caller_id: '34611000777',
      called_did: SHOP_DID,
      pbx_call_id: 'known-caller-1',
    };
    await app.post('/api/telephony/webhooks/zadarma', payload, {
      form: true,
      headers: { signature: webhookSignature([payload.event, payload.caller_id, payload.called_did]) },
    });

    const log = await queryOne(`SELECT * FROM call_logs WHERE external_id = 'known-caller-1'`);
    assert.equal(log.appointment_id, booked.body.appointment.id);
  });

  it('shows the shop its own calls and nobody else its calls', async () => {
    const mine = await app.get(`/api/telephony/calls?shop_id=${shopId}`, { token: owner.token });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.calls.length >= 3);
    assert.ok(mine.body.calls.every((call) => call.shop_id === shopId));
    assert.ok(mine.body.calls.every((call) => call.tel_link?.startsWith('tel:')));

    assert.equal((await app.get('/api/telephony/calls/all', { token: owner.token })).status, 403);
    const global = await app.get('/api/telephony/calls/all', { token: admin.token });
    assert.equal(global.status, 200);
    assert.equal(global.body.scope, 'global');
  });

  it('accepts caller phone from clid/from and completes stuck En curso on list', async () => {
    const { query } = await import('../../server/db/index.js');
    await query(
      `INSERT INTO call_logs
         (shop_id, provider, external_id, pbx_call_id, direction, caller_phone, status, started_at, created_at)
       VALUES ($1, 'zadarma', 'stuck-call-1', 'stuck-call-1', 'in', NULL, 'started',
               now() - interval '15 minutes', now() - interval '15 minutes')`,
      [shopId],
    );

    const list = await app.get(`/api/telephony/calls?shop_id=${shopId}`, { token: owner.token });
    assert.equal(list.status, 200);
    const stuck = list.body.calls.find((call) => call.caller_phone == null && call.status === 'completed');
    // Prefer matching via DB — finalizeStuckCalls must have closed it.
    const log = await queryOne(`SELECT * FROM call_logs WHERE external_id = 'stuck-call-1'`);
    assert.equal(log.status, 'completed');
    assert.ok(log.ended_at);
    assert.ok(stuck || list.body.calls.some((call) => call.status_label === 'Completada'));

    const end = {
      event: 'NOTIFY_END',
      clid: '34611000444',
      from: '34611000444',
      called_did: SHOP_DID,
      duration: '30',
      disposition: 'answered',
      pbx_call_id: 'clid-call-1',
    };
    await app.post('/api/telephony/webhooks/zadarma', end, {
      form: true,
      headers: {
        signature: webhookSignature([end.event, end.caller_id ?? '', end.called_did, end.duration]),
      },
    });
    const clidLog = await queryOne(`SELECT * FROM call_logs WHERE external_id = 'clid-call-1'`);
    assert.equal(clidLog.status, 'completed');
    assert.equal(clidLog.caller_phone, '+34611000444');
  });

  it('NOTIFY_END without matching id closes the latest in-progress call', async () => {
    const start = {
      event: 'NOTIFY_START',
      caller_id: '34611000555',
      called_did: SHOP_DID,
      pbx_call_id: 'open-call-1',
    };
    await app.post('/api/telephony/webhooks/zadarma', start, {
      form: true,
      headers: { signature: webhookSignature([start.event, start.caller_id, start.called_did]) },
    });

    const end = {
      event: 'NOTIFY_END',
      caller_id: '34611000555',
      called_did: SHOP_DID,
      duration: '12',
      disposition: 'answered',
    };
    await app.post('/api/telephony/webhooks/zadarma', end, {
      form: true,
      headers: {
        signature: webhookSignature([end.event, end.caller_id, end.called_did, end.duration]),
      },
    });

    const log = await queryOne(`SELECT * FROM call_logs WHERE external_id = 'open-call-1'`);
    assert.equal(log.status, 'completed');
    assert.equal(log.duration_seconds, 12);
    assert.ok(log.ended_at);
  });
});
