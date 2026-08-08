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

async function bookPending({ time = '11:00' } = {}) {
  const booked = await app.post(`/api/public/shops/${publicKey}/appointments`, {
    customer_name: 'Lucia Navarro',
    customer_phone: '+34611000077',
    customer_email: 'lucia.navarro@example.com',
    service_type: 'ITV',
    date: nextWeekday(),
    time,
  });
  assert.equal(booked.status, 201);
  const list = await app.get(`/api/appointments?shop_id=${shopId}&status=pending`, { token: owner.token });
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
    await bookPending({ time: '09:30' });
    const year = new Date().getFullYear();
    const response = await app.get(`/api/shops/${shopId}/history`, { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.year, year);
    assert.ok(response.body.total >= 1);
    assert.equal(response.body.months.length, 12);
    assert.ok(response.body.available_years.includes(year));
    assert.ok(response.body.breakdown);
  });

  it('accepts an explicit year filter', async () => {
    const year = new Date().getFullYear();
    const response = await app.get(`/api/shops/${shopId}/history?year=${year}`, { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.year, year);
  });
});

describe('in-app confirmation notifies Super Admin', () => {
  it('sets status to accepted and creates a Super Admin notification', async () => {
    const appointment = await bookPending({ time: '10:30' });
    const accepted = await app.post(
      `/api/appointments/${appointment.id}/accept`,
      { shop_id: shopId },
      { token: owner.token },
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.appointment.status, 'accepted');
    assert.equal(accepted.body.confirmed, true);

    const notes = await app.get('/api/notifications?unread_only=true', { token: admin.token });
    assert.equal(notes.status, 200);
    const hit = notes.body.notifications.find(
      (item) => item.type === 'appointment_confirmed' && item.link === `/appointments/${appointment.id}`,
    );
    assert.ok(hit, 'Super Admin should receive appointment_confirmed');
    assert.match(hit.title, /confirmada/i);
    assert.match(hit.body, /History Garage/);
  });

  it('does not duplicate Super Admin alerts when confirming again', async () => {
    const appointment = await bookPending({ time: '12:00' });
    const first = await app.post(
      `/api/appointments/${appointment.id}/accept`,
      { shop_id: shopId },
      { token: owner.token },
    );
    assert.equal(first.body.confirmed, true);

    const before = await app.get('/api/notifications?unread_only=true', { token: admin.token });
    const countBefore = before.body.notifications.filter(
      (item) => item.type === 'appointment_confirmed' && item.link === `/appointments/${appointment.id}`,
    ).length;

    const second = await app.post(
      `/api/appointments/${appointment.id}/accept`,
      { shop_id: shopId },
      { token: owner.token },
    );
    assert.equal(second.status, 200);
    assert.equal(second.body.confirmed, false);

    const after = await app.get('/api/notifications?unread_only=true', { token: admin.token });
    const countAfter = after.body.notifications.filter(
      (item) => item.type === 'appointment_confirmed' && item.link === `/appointments/${appointment.id}`,
    ).length;
    assert.equal(countAfter, countBefore);
  });
});
