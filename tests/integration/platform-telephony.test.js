import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { queryOne } from '../../server/db/index.js';
import { resetPlatformTelephonyCache } from '../../server/services/platform-telephony.js';
import {
  closeDatabase,
  createOwner,
  createSuperAdmin,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';

describe('Super Admin global lead telephony', () => {
  let client;

  before(async () => {
    client = await startTestServer();
  });
  after(async () => {
    await client.close();
    await closeDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    resetPlatformTelephonyCache();
  });

  it('is Super Admin only and never returns secrets', async () => {
    const admin = await createSuperAdmin(client);
    const owner = await createOwner(client);

    assert.equal((await client.get('/api/admin/settings/leads-telephony', { token: owner.token })).status, 403);

    const empty = await client.get('/api/admin/settings/leads-telephony', { token: admin.token });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.assistant_status, 'offline');
    assert.equal(empty.body.zadarma.configured, true);
    assert.equal(empty.body.retell.configured, true);
    assert.equal(empty.body.assistant_online, false);
    assert.equal(empty.body.zadarma.key, undefined);
    assert.equal(empty.body.zadarma.secret, undefined);
    assert.equal(empty.body.retell.api_key, undefined);
    assert.match(empty.body.retell.webhook_url, /\/api\/webhooks\/retell$/);
    assert.match(empty.body.zadarma.webhook_url, /\/api\/telephony\/webhooks\/zadarma$/);

    const saved = await client.patch(
      '/api/admin/settings/leads-telephony',
      {
        zadarma_key: 'zd-test-key',
        zadarma_secret: 'zd-test-secret',
        zadarma_sip: '100',
        zadarma_did: '+34919990000',
        retell_api_key: 'retell-platform-key',
        retell_agent_id: 'agent_platform_sales',
        retell_did: '+34919990000',
      },
      { token: admin.token },
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.unchanged, false);
    assert.equal(saved.body.assistant_online, true);
    assert.equal(saved.body.assistant_status, 'online');
    assert.equal(saved.body.zadarma.sip, '100');
    assert.equal(saved.body.zadarma.did, '+34919990000');
    assert.equal(saved.body.retell.platform_agent_id, 'agent_platform_sales');
    assert.equal(saved.body.zadarma.key, undefined);
    assert.equal(saved.body.retell.api_key, undefined);

    const row = await queryOne(`SELECT value FROM platform_settings WHERE key = 'zadarma_api_key'`);
    assert.equal(row.value, 'zd-test-key');

    const keep = await client.patch('/api/admin/settings/leads-telephony', {}, { token: admin.token });
    assert.equal(keep.status, 200);
    assert.equal(keep.body.unchanged, true);
    assert.equal(keep.body.assistant_online, true);
  });
});
