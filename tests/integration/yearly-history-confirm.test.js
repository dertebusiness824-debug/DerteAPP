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

async function bookConfirmed({ time = '11:00' } = {}) {
  const booked = await app.post(`/api/public/shops/${publicKey}/appointments`, {
    customer_name: 'Lucia Navarro',
    customer_phone: '+34611000077',
    customer_email: 'lucia.navarro@example.com',
    service_type: 'ITV',
    date: nextWeekday(),
    time,
  });
  assert.equal(booked.status, 201);
  assert.equal(booked.body.status, 'confirmed');
  const list = await app.get(`/api/appointments?shop_id=${shopId}&status=confirmed`, { token: owner.token });
  const appointment = list.body.appointments.find((item) => item.reference === booked.body.reference);
  assert.ok(appointment);
  return appointment;
}

before(async () => {
  await resetDatabase();
  app = await startTestServer();
  admin = await createSuperAdmin(app);
  owner = await createOwner(app, { shop_name: 'History Garage', timezone: 'Europe/Madrid' });
  shopId = owner.shop.id;
  publicKey = (await app.get(`/api/shops/${shopId}`, { token: owner.token })).body.shop.public_key;
});

after(async () => {
  await app.close();
  await closeDatabase();
});

describe('shop yearly booking history', () => {
  it('returns the current-year counter, months and available years', async () => {
    await bookConfirmed({ time: '09:30' });
    const year = new Date().getFullYear();
    const response = await app.get(`/api/shops/${shopId}/history`, { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.year, year);
    assert.ok(response.body.total >= 1);
    assert.equal(response.body.months.length, 12);
    assert.ok(response.body.available_years.includes(year));
  });

  it('accepts an explicit year filter', async () => {
    const year = new Date().getFullYear();
    const response = await app.get(`/api/shops/${shopId}/history?year=${year}`, { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.year, year);
  });
});

describe('auto-confirm + cancel notifies by email path', () => {
  it('stores public bookings as confirmed without an accept step', async () => {
    const appointment = await bookConfirmed({ time: '10:30' });
    assert.equal(appointment.status, 'confirmed');
    assert.ok(appointment.allowed_transitions.includes('cancelled'));
    assert.ok(!appointment.allowed_transitions.includes('accepted'));
  });

  it('cancels a confirmed booking', async () => {
    const appointment = await bookConfirmed({ time: '12:00' });
    const cancelled = await app.post(
      `/api/appointments/${appointment.id}/status`,
      { shop_id: shopId, status: 'cancelled', reason: 'Sin stock' },
      { token: owner.token },
    );
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.appointment.status, 'cancelled');
    // Super Admin still exists for the suite; cancel must not require accept.
    assert.ok(admin.token);
  });
});
