/**
 * APIVehículo admin endpoints stay Super Admin only. Shop owners identify
 * vehicles through the workshop route, which never receives the API key.
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

describe('APIVehículo plate lookup', () => {
  let client;
  const previousKey = process.env.API_VEHICULO_KEY;
  const previousAlias = process.env.APIVEHICULO_API_KEY;

  before(async () => {
    await resetDatabase();
    delete process.env.API_VEHICULO_KEY;
    delete process.env.APIVEHICULO_API_KEY;
    client = await startTestServer();
  });

  after(async () => {
    if (previousKey === undefined) delete process.env.API_VEHICULO_KEY;
    else process.env.API_VEHICULO_KEY = previousKey;
    if (previousAlias === undefined) delete process.env.APIVEHICULO_API_KEY;
    else process.env.APIVEHICULO_API_KEY = previousAlias;
    await client.close();
    await closeDatabase();
  });

  it('rejects anonymous callers', async () => {
    const response = await client.post('/api/admin/vehicles/plate', { plate: '1234BCD' });
    assert.equal(response.status, 401);
  });

  it('rejects a shop owner on the Super Admin lookup with 403', async () => {
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
    const response = await client.get('/api/admin/vehicles/apivehiculo', { token: owner.token });
    assert.equal(response.status, 403);
  });

  it('lets the Super Admin in, and reports the missing key instead of crashing', async () => {
    const admin = await createSuperAdmin(client);
    const status = await client.get('/api/admin/vehicles/apivehiculo', { token: admin.token });
    assert.equal(status.status, 200);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.provider, 'apivehiculo.com');
    assert.equal(status.body.api_key, undefined);

    const lookup = await client.post('/api/admin/vehicles/plate', { plate: '1234BCD' }, { token: admin.token });
    assert.equal(lookup.status, 503);
    assert.equal(lookup.body?.error?.code, 'not_configured');
    assert.match(lookup.body?.error?.message ?? '', /API_VEHICULO_KEY|Ajustes/);
  });

  it('lets a shop owner identify a plate without ever seeing the key', async () => {
    const owner = await createOwner(client);
    const response = await client.post(
      '/api/workshop/vehicles/identify/plate',
      { shop_id: owner.shop.id, plate: '1234BCD' },
      { token: owner.token },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.found, false);
    assert.equal(response.body.api_key, undefined);
    assert.ok('provider_configured' in response.body);
    assert.ok('vehicle' in response.body);
    assert.ok('plate' in response.body);
  });

  it('lets a shop owner save the official ficha into the shop file', async () => {
    const owner = await createOwner(client);
    const response = await client.post(
      '/api/workshop/vehicles',
      {
        shop_id: owner.shop.id,
        plate: '5847GKZ',
        make: 'FORD',
        model: 'TRANSIT',
        year: 2009,
        fuel: 'diésel',
        identified_by: 'plate',
        specs: { provider: 'apivehiculo.com', first_registered: '2009-02-25' },
      },
      { token: owner.token },
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.vehicle.make, 'FORD');
    assert.equal(response.body.vehicle.model, 'TRANSIT');
    assert.equal(response.body.vehicle.year, 2009);
    assert.ok(response.body.vehicle.id);
    assert.equal(response.body.api_key, undefined);
  });

  it('lets the Super Admin ping the provider and reports the missing key', async () => {
    const admin = await createSuperAdmin(client);
    const ping = await client.post('/api/admin/vehicles/apivehiculo/ping', {}, { token: admin.token });
    assert.equal(ping.status, 200);
    assert.equal(ping.body.ok, false);
    assert.equal(ping.body.configured, false);
    assert.equal(ping.body.reason, 'not_configured');
    assert.equal(ping.body.api_key, undefined);
  });

  it('stores the API key from Ajustes without returning it', async () => {
    const admin = await createSuperAdmin(client);
    const owner = await createOwner(client);

    const forbidden = await client.patch(
      '/api/admin/vehicles/apivehiculo',
      { api_key: 'secret-from-owner' },
      { token: owner.token },
    );
    assert.equal(forbidden.status, 403);

    const empty = await client.patch('/api/admin/vehicles/apivehiculo', { api_key: '' }, { token: admin.token });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.unchanged, true);
    assert.equal(empty.body.configured, false);
    assert.equal(empty.body.api_key, undefined);

    const saved = await client.patch(
      '/api/admin/vehicles/apivehiculo',
      { api_key: 'av_test_key_not_live' },
      { token: admin.token },
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.configured, true);
    assert.equal(saved.body.unchanged, false);
    assert.equal(saved.body.api_key, undefined);

    const status = await client.get('/api/admin/vehicles/apivehiculo', { token: admin.token });
    assert.equal(status.body.configured, true);
    assert.equal(status.body.api_key, undefined);
    assert.equal(status.body.provider, 'apivehiculo.com');
  });
});
