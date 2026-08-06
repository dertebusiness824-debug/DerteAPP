import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDatabase,
  createOwner,
  createSuperAdmin,
  resetDatabase,
  startTestServer,
  testPhone,
} from '../helpers/harness.js';

let app;
let admin;
let owner;

before(async () => {
  await resetDatabase();
  app = await startTestServer();
  admin = await createSuperAdmin(app);
  owner = await createOwner(app, { shop_name: 'Taller Soporte', full_name: 'Owner One' });
});

after(async () => {
  await app.close();
  await closeDatabase();
});

describe('platform support contact', () => {
  it('exposes WhatsApp / tel on /api/public/support', async () => {
    const response = await app.get('/api/public/support');
    assert.equal(response.status, 200);
    assert.equal(response.body.support.phone, admin.user.phone);
    assert.ok(response.body.support.whatsapp_link.includes(admin.user.phone.replace('+', '')));
    assert.equal(response.body.support.tel_link, `tel:${admin.user.phone}`);
  });

  it('includes support on /api/auth/me', async () => {
    const response = await app.get('/api/auth/me', { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.support.phone, admin.user.phone);
    assert.ok(response.body.support.whatsapp_link);
  });
});

describe('Super Admin profile phone', () => {
  it('lets the Super Admin update the support phone', async () => {
    const next = testPhone();
    const patched = await app.patch('/api/auth/me', { phone: next }, { token: admin.token });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.user.phone, next);

    const support = await app.get('/api/public/support');
    assert.equal(support.body.support.phone, next);

    // Restore for later assertions that expect the original seed phone.
    await app.patch('/api/auth/me', { phone: admin.user.phone }, { token: admin.token });
  });

  it('blocks shop owners from changing their login phone', async () => {
    const response = await app.patch(
      '/api/auth/me',
      { phone: testPhone() },
      { token: owner.token },
    );
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'phone_locked');
  });
});

describe('shop owner password + Retell key', () => {
  it('stores Retell API key per shop for Super Admin only', async () => {
    const forbidden = await app.patch(
      `/api/shops/${owner.shop.id}`,
      { retell_api_key: 'key_owner_blocked' },
      { token: owner.token },
    );
    assert.equal(forbidden.status, 403);

    const ok = await app.patch(
      `/api/shops/${owner.shop.id}`,
      {
        retell_api_key: 'key_test_retell_123',
        retell_agent_id: 'agent_abc',
        site_url: 'https://taller-hostinger.example',
        site_domains: ['taller-hostinger.example'],
      },
      { token: admin.token },
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.shop.retell_api_key_set, true);
    assert.equal(ok.body.shop.retell_agent_id, 'agent_abc');
    assert.equal(ok.body.shop.site_url, 'https://taller-hostinger.example');
    assert.equal(ok.body.shop.retell_api_key, undefined);
  });

  it('refuses owner password reset from a shop owner', async () => {
    const response = await app.post(
      `/api/shops/${owner.shop.id}/owner-password`,
      { password: 'OtraClave99' },
      { token: owner.token },
    );
    assert.equal(response.status, 403);
  });

  it('lets Super Admin reset the owner password', async () => {
    const response = await app.post(
      `/api/shops/${owner.shop.id}/owner-password`,
      { password: 'NuevaClave99' },
      { token: admin.token },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.updated, true);

    const login = await app.post('/api/auth/login', {
      email: owner.email,
      password: 'NuevaClave99',
    });
    assert.equal(login.status, 200);
    owner.token = login.body.token;
  });
});
