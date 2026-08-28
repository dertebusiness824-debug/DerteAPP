/**
 * Matriculas.org is Super Admin only. Shop owners and anonymous callers must
 * never spend the quota, even if they guess the URL.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDatabase,
  createOwner,
  createSuperAdmin,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';

describe('Matriculas.org admin-only plate lookup', () => {
  let client;
  const previousKey = process.env.MATRICULAS_API_KEY;

  before(async () => {
    await resetDatabase();
    delete process.env.MATRICULAS_API_KEY;
    delete process.env.PLATE_LOOKUP_API_KEY;
    client = await startTestServer();
  });

  after(async () => {
    if (previousKey === undefined) delete process.env.MATRICULAS_API_KEY;
    else process.env.MATRICULAS_API_KEY = previousKey;
    await client.close();
    await closeDatabase();
  });

  it('rejects anonymous callers', async () => {
    const response = await client.post('/api/admin/vehicles/plate', { plate: '1234BCD' });
    assert.equal(response.status, 401);
  });

  it('rejects a shop owner with 403, never 200', async () => {
    const owner = await createOwner(client);
    const response = await client.post(
      '/api/admin/vehicles/plate',
      { plate: '1234BCD' },
      { token: owner.token },
    );
    assert.equal(response.status, 403);
    assert.equal(response.body?.error?.code, 'role_forbidden');
  });

  it('rejects a shop owner on the status endpoint too', async () => {
    const owner = await createOwner(client);
    const response = await client.get('/api/admin/vehicles/matriculas', { token: owner.token });
    assert.equal(response.status, 403);
  });

  it('lets the Super Admin in, and reports the missing key instead of crashing', async () => {
    const admin = await createSuperAdmin(client);
    const status = await client.get('/api/admin/vehicles/matriculas', { token: admin.token });
    assert.equal(status.status, 200);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.provider, 'matriculas.org');

    const lookup = await client.post('/api/admin/vehicles/plate', { plate: '1234BCD' }, { token: admin.token });
    assert.equal(lookup.status, 503);
    assert.equal(lookup.body?.error?.code, 'not_configured');
    assert.match(lookup.body?.error?.message ?? '', /MATRICULAS_API_KEY/);
  });

  it('keeps the shop-owner plate finder working off local history only', async () => {
    const owner = await createOwner(client);
    const response = await client.post(
      '/api/workshop/vehicles/identify/plate',
      { shop_id: owner.shop.id, plate: '1234BCD' },
      { token: owner.token },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.provider_configured, false);
    assert.equal(response.body.found, false);
  });
});
