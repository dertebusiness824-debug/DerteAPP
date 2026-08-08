import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDatabase,
  createOwner,
  createSuperAdmin,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';

let app;
let owner;
let admin;
let shopId;
let publicKey;

function nextWeekday() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 3);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function bookPending() {
  const booked = await app.post(`/api/public/shops/${publicKey}/appointments`, {
    customer_name: 'Paco Ruiz',
    customer_phone: '+34611000088',
    service_type: 'Aceite',
    date: nextWeekday(),
    time: '11:15',
  });
  assert.equal(booked.status, 201);
  const list = await app.get(`/api/appointments?shop_id=${shopId}&status=pending`, { token: owner.token });
  return list.body.appointments.find((item) => item.reference === booked.body.reference);
}

before(async () => {
  await resetDatabase();
  app = await startTestServer();
  admin = await createSuperAdmin(app);
  owner = await createOwner(app, { shop_name: 'Link Garage' });
  shopId = owner.shop.id;
  publicKey = (await app.get(`/api/shops/${shopId}`, { token: owner.token })).body.shop.public_key;
});

after(async () => {
  await app.close();
  await closeDatabase();
});

describe('user ↔ shop link and confirm auth guards', () => {
  it('confirms a pending booking with a valid session user', async () => {
    const appointment = await bookPending();
    const accepted = await app.post(
      `/api/appointments/${appointment.id}/accept`,
      { shop_id: shopId },
      { token: owner.token },
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.appointment.status, 'accepted');
    assert.equal(accepted.body.confirmed, true);
  });

  it('rejects confirm without a session', async () => {
    const appointment = await bookPending();
    const response = await app.post(`/api/appointments/${appointment.id}/accept`, { shop_id: shopId });
    assert.equal(response.status, 401);
  });

  it('links a new team member only when the user row exists', async () => {
    const response = await app.post(
      `/api/shops/${shopId}/members`,
      {
        phone: '+34611000999',
        full_name: 'Mecánico Nuevo',
        role: 'mechanic',
        password: 'TestPass123',
      },
      { token: owner.token },
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.member.full_name, 'Mecánico Nuevo');
  });

  it('lets Super Admin create an owner attached to an existing shop', async () => {
    const response = await app.post(
      '/api/admin/users',
      {
        email: 'nuevo.dueno@linkgarage.test',
        password: 'TestPass123',
        full_name: 'Nuevo Dueno',
        phone: '+34611000888',
        shop_id: shopId,
        create_shop: false,
        timezone: 'Europe/Madrid',
      },
      { token: admin.token },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.ok(response.body.user?.id);
    assert.equal(response.body.shop?.id, shopId);
  });
});
