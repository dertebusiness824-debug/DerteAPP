import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDatabase, createOwner, createSuperAdmin, resetDatabase, startTestServer, testPhone } from '../helpers/harness.js';

let app;
let admin;
let shopA;
let shopB;

before(async () => {
  await resetDatabase();
  app = await startTestServer();
  admin = await createSuperAdmin(app);
  shopA = await createOwner(app, { shop_name: 'Alpha Motors', full_name: 'Alice Alvarez' });
  shopB = await createOwner(app, { shop_name: 'Beta Garage', full_name: 'Bruno Blanco' });
});

after(async () => {
  await app.close();
  await closeDatabase();
});

describe('tenant isolation', () => {
  it('lists only the shops an owner belongs to', async () => {
    const response = await app.get('/api/shops', { token: shopA.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.shops[0].id, shopA.shop.id);
  });

  it('blocks every cross-tenant read and write', async () => {
    const target = shopB.shop.id;
    const checks = [
      await app.get(`/api/shops/${target}`, { token: shopA.token }),
      await app.get(`/api/shops/${target}/overview`, { token: shopA.token }),
      await app.get(`/api/shops/${target}/analytics`, { token: shopA.token }),
      await app.get(`/api/shops/${target}/schedule`, { token: shopA.token }),
      await app.get(`/api/appointments?shop_id=${target}`, { token: shopA.token }),
      await app.get(`/api/chat/threads?shop_id=${target}`, { token: shopA.token }),
      await app.patch(`/api/shops/${target}`, { name: 'Hijacked' }, { token: shopA.token }),
      await app.put(`/api/shops/${target}/schedule`, { days: [{ weekday: 1, is_closed: true }] }, { token: shopA.token }),
    ];
    for (const response of checks) {
      assert.equal(response.status, 403, `expected 403, got ${response.status}`);
    }
  });

  it('rejects a malformed or unknown shop id', async () => {
    assert.equal((await app.get('/api/shops/not-a-uuid/overview', { token: admin.token })).status, 400);
    assert.equal(
      (await app.get('/api/shops/00000000-0000-4000-8000-000000000000/overview', { token: admin.token })).status,
      404,
    );
  });

  it('requires a Super Admin to name the shop they are acting on', async () => {
    const response = await app.get('/api/appointments', { token: admin.token });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'shop_id_required');
  });

  it('falls back to the owner primary shop when none is given', async () => {
    const response = await app.get('/api/appointments', { token: shopA.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.shop.id, shopA.shop.id);
  });
});

describe('Super Admin shop switcher', () => {
  it('sees every shop and can act on any of them', async () => {
    const all = await app.get('/api/shops', { token: admin.token });
    assert.equal(all.status, 200);
    assert.ok(all.body.count >= 2);
    const names = all.body.shops.map((shop) => shop.name);
    assert.ok(names.includes('Alpha Motors') && names.includes('Beta Garage'));

    for (const shop of [shopA, shopB]) {
      const overview = await app.get(`/api/shops/${shop.shop.id}/overview`, { token: admin.token });
      assert.equal(overview.status, 200);
      assert.equal(overview.body.shop.id, shop.shop.id);
    }
  });

  it('onboards a new Hostinger site with its owner', async () => {
    const phone = testPhone();
    const response = await app.post(
      '/api/shops',
      {
        name: 'Gamma Autos',
        timezone: 'Europe/Lisbon',
        site_url: 'https://gamma-autos.test',
        site_domains: ['gamma-autos.test'],
        owner: { phone, full_name: 'Carla Costa' },
      },
      { token: admin.token },
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.shop.timezone, 'Europe/Lisbon');
    assert.ok(response.body.shop.public_key.startsWith('dk_'));
    assert.equal(response.body.owner.phone, phone);
    assert.ok(response.body.temporary_password, 'the admin needs a password to hand over');

    // The new owner can sign in immediately and sees exactly their own shop.
    const login = await app.post('/api/auth/login', { phone, password: response.body.temporary_password });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.shops.length, 1);
    assert.equal(login.body.user.shops[0].name, 'Gamma Autos');

    // A fresh shop starts with a usable week and its own support thread.
    const schedule = await app.get(`/api/shops/${response.body.shop.id}/schedule`, { token: admin.token });
    assert.equal(schedule.body.weekly_hours.length, 7);
    assert.ok(schedule.body.weekly_hours.some((day) => day.is_closed === false));
  });

  it('keeps shop creation away from owners', async () => {
    const response = await app.post('/api/shops', { name: 'Sneaky Garage' }, { token: shopA.token });
    assert.equal(response.status, 403);
  });

  it('reserves telephony routing and the domain allowlist for Super Admins', async () => {
    const blocked = await app.patch(`/api/shops/${shopA.shop.id}`, { zadarma_did: '+34910000001' }, { token: shopA.token });
    assert.equal(blocked.status, 403);

    const allowed = await app.patch(
      `/api/shops/${shopA.shop.id}`,
      { zadarma_did: '+34910000001', site_domains: ['alpha-motors.test'] },
      { token: admin.token },
    );
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.shop.zadarma_did, '+34910000001');
  });
});

describe('master dashboard', () => {
  it('aggregates metrics across every tenant', async () => {
    // Give the numbers something to count.
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 3);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);

    for (const shop of [shopA, shopB]) {
      const publicKey = (await app.get(`/api/shops/${shop.shop.id}`, { token: shop.token })).body.shop.public_key;
      await app.post(`/api/public/shops/${publicKey}/appointments`, {
        customer_name: 'Metrics Customer',
        customer_phone: '+34611000123',
        date: date.toISOString().slice(0, 10),
        time: '10:00',
      });
      await app.post(`/api/public/shops/${publicKey}/events`, {
        event_type: 'pageview',
        path: '/',
        session_id: `visitor-${shop.shop.id}`,
      });
    }

    const response = await app.get('/api/admin/overview?days=30', { token: admin.token });
    assert.equal(response.status, 200);
    assert.ok(response.body.totals.active_shops >= 2);
    assert.ok(response.body.totals.bookings >= 2);
    assert.ok(response.body.totals.pending_bookings >= 2);
    assert.ok(response.body.totals.pageviews >= 2);
    assert.ok(response.body.totals.visitors >= 2);
    assert.ok(Array.isArray(response.body.timeline));
    assert.ok(response.body.calls);

    // Per-shop rows carry the owner's number so support can call in one tap.
    const row = response.body.shops.find((shop) => shop.id === shopA.shop.id);
    assert.ok(row);
    assert.equal(row.owner_name, 'Alice Alvarez');
    assert.equal(row.owner_phone, shopA.phone);
    assert.ok(row.owner_phone_display.startsWith('+'));
    assert.ok(row.bookings >= 1);
  });

  it('searches shops by name, owner number or site', async () => {
    const byName = await app.get('/api/admin/shops?search=Alpha', { token: admin.token });
    assert.equal(byName.status, 200);
    assert.equal(byName.body.shops.length, 1);
    assert.equal(byName.body.shops[0].name, 'Alpha Motors');

    const byPhone = await app.get(`/api/admin/shops?search=${encodeURIComponent(shopB.phone)}`, { token: admin.token });
    assert.equal(byPhone.body.shops.length, 1);
    assert.equal(byPhone.body.shops[0].name, 'Beta Garage');
  });

  it('keeps the whole admin area away from shop owners', async () => {
    for (const path of ['/api/admin/overview', '/api/admin/shops', '/api/admin/users', '/api/admin/audit', '/api/admin/inbox']) {
      const response = await app.get(path, { token: shopA.token });
      assert.equal(response.status, 403, `${path} should be Super Admin only`);
    }
    assert.equal((await app.post('/api/admin/broadcast', { body: 'hello' }, { token: shopA.token })).status, 403);
  });
});

describe('platform moderation', () => {
  it('suspends and restores a shop', async () => {
    const suspended = await app.patch(
      `/api/admin/shops/${shopB.shop.id}/status`,
      { status: 'suspended', reason: 'unpaid invoice' },
      { token: admin.token },
    );
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.shop.status, 'suspended');

    // The owner is locked out of their dashboard while suspended.
    const blocked = await app.get(`/api/shops/${shopB.shop.id}/overview`, { token: shopB.token });
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error.message, /suspended/i);

    const restored = await app.patch(
      `/api/admin/shops/${shopB.shop.id}/status`,
      { status: 'active' },
      { token: admin.token },
    );
    assert.equal(restored.status, 200);
    assert.equal((await app.get(`/api/shops/${shopB.shop.id}/overview`, { token: shopB.token })).status, 200);
  });

  it('suspends a user and kills their sessions immediately', async () => {
    const victim = await createOwner(app, { shop_name: 'Doomed Garage' });
    assert.equal((await app.get('/api/auth/me', { token: victim.token })).status, 200);

    const suspended = await app.patch(
      `/api/admin/users/${victim.user.id}`,
      { status: 'suspended' },
      { token: admin.token },
    );
    assert.equal(suspended.status, 200);
    assert.equal((await app.get('/api/auth/me', { token: victim.token })).status, 401);

    const login = await app.post('/api/auth/login', { phone: victim.phone, password: victim.password });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'account_suspended');
  });

  it('will not let a Super Admin lock themselves out', async () => {
    const response = await app.patch(`/api/admin/users/${admin.user.id}`, { status: 'suspended' }, { token: admin.token });
    assert.equal(response.status, 400);
  });

  it('broadcasts an announcement into every support thread', async () => {
    const response = await app.post(
      '/api/admin/broadcast',
      { body: 'Maintenance window tonight at 02:00 UTC.' },
      { token: admin.token },
    );
    assert.equal(response.status, 201);
    assert.ok(response.body.delivered >= 2);

    const support = await app.get(`/api/chat/support?shop_id=${shopA.shop.id}`, { token: shopA.token });
    assert.ok(support.body.messages.some((message) => message.body.includes('Maintenance window')));
    assert.equal(support.body.messages.at(-1).sender_type, 'admin');
  });

  it('records an audit trail of privileged actions', async () => {
    const response = await app.get('/api/admin/audit', { token: admin.token });
    assert.equal(response.status, 200);
    const actions = response.body.entries.map((entry) => entry.action);
    assert.ok(actions.includes('shop.status'), 'suspending a shop should be audited');
    assert.ok(actions.includes('shop.create'), 'creating a shop should be audited');
    assert.ok(response.body.entries.every((entry) => entry.actor_name));
  });
});

describe('Hostinger integration handover', () => {
  it('hands the owner a ready-to-paste snippet with their key', async () => {
    const response = await app.get(`/api/shops/${shopA.shop.id}/embed`, { token: shopA.token });
    assert.equal(response.status, 200);
    assert.ok(response.body.public_key.startsWith('dk_'));
    assert.match(response.body.snippet, /<script/);
    assert.ok(response.body.snippet.includes(response.body.public_key));
    assert.ok(response.body.snippet.includes('/embed/derteapp.js'));
    assert.ok(response.body.endpoints.booking.includes(response.body.public_key));
    assert.ok(response.body.instructions.length >= 3);
  });

  it('rotating the key invalidates the old snippet', async () => {
    const before = (await app.get(`/api/shops/${shopA.shop.id}`, { token: shopA.token })).body.shop.public_key;
    const rotated = await app.post(`/api/shops/${shopA.shop.id}/rotate-public-key`, {}, { token: shopA.token });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.body.public_key, before);
    assert.match(rotated.body.warning, /previous key stops working/i);
    assert.equal((await app.get(`/api/public/shops/${before}/config`)).status, 404);
  });
});
