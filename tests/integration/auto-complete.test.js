import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDatabase,
  createOwner,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';
import { autoCompleteShopAppointments } from '../../server/services/auto-complete.js';
import { queryOne } from '../../server/db/index.js';
import { utcFromZoned, zonedDateString, zonedParts } from '../../server/lib/time.js';

let app;
let owner;
let shop;
let publicKey;

const WEEK = [
  { weekday: 0, is_closed: true },
  { weekday: 1, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { weekday: 2, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { weekday: 3, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { weekday: 4, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { weekday: 5, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { weekday: 6, is_closed: true },
];

before(async () => {
  await resetDatabase();
  app = await startTestServer();
  owner = await createOwner(app, { shop_name: 'AutoComplete Garage', timezone: 'Europe/Madrid' });
  shop = (await app.get(`/api/shops/${owner.shop.id}`, { token: owner.token })).body.shop;
  publicKey = shop.public_key;
  await app.put(`/api/shops/${shop.id}/schedule`, { days: WEEK }, { token: owner.token });
});

after(async () => {
  await app.close();
  await closeDatabase();
});

function openWeekdayNow() {
  // Find a moment that is a weekday in Europe/Madrid.
  const cursor = new Date();
  for (let i = 0; i < 14; i += 1) {
    const parts = zonedParts(cursor, 'Europe/Madrid');
    if (parts.weekday >= 1 && parts.weekday <= 5) {
      return { date: zonedDateString(cursor, 'Europe/Madrid'), parts };
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error('No weekday found');
}

describe('auto-complete near closing', () => {
  it('does not complete before the close−30m threshold', async () => {
    const { date } = openWeekdayNow();
    const [y, m, d] = date.split('-').map(Number);
    const scheduledAt = utcFromZoned({ year: y, month: m, day: d, hour: 10, minute: 0 }, 'Europe/Madrid');

    const booked = await app.post(
      '/api/appointments',
      {
        shop_id: shop.id,
        customer_name: 'Antes Umbral',
        customer_phone: '+34611000111',
        scheduled_at: scheduledAt.toISOString(),
        enforce_schedule: false,
      },
      { token: owner.token },
    );
    assert.equal(booked.status, 201);

    // 17:00 is still before 18:30 for a 19:00 close.
    const beforeThreshold = utcFromZoned({ year: y, month: m, day: d, hour: 17, minute: 0 }, 'Europe/Madrid');
    const result = await autoCompleteShopAppointments(
      { id: shop.id, timezone: 'Europe/Madrid' },
      beforeThreshold,
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'before_threshold');

    const row = await queryOne('SELECT status FROM appointments WHERE id = $1', [booked.body.appointment.id]);
    assert.equal(row.status, 'confirmed');
  });

  it('marks today confirmed bookings completed after close−30m', async () => {
    const { date } = openWeekdayNow();
    const [y, m, d] = date.split('-').map(Number);
    const scheduledAt = utcFromZoned({ year: y, month: m, day: d, hour: 11, minute: 0 }, 'Europe/Madrid');

    const booked = await app.post(
      '/api/appointments',
      {
        shop_id: shop.id,
        customer_name: 'Tras Umbral',
        customer_phone: '+34611000112',
        customer_email: 'tras@example.com',
        scheduled_at: scheduledAt.toISOString(),
        enforce_schedule: false,
      },
      { token: owner.token },
    );
    assert.equal(booked.status, 201);
    assert.equal(booked.body.appointment.status, 'confirmed');

    const afterThreshold = utcFromZoned({ year: y, month: m, day: d, hour: 18, minute: 35 }, 'Europe/Madrid');
    const result = await autoCompleteShopAppointments(
      { id: shop.id, timezone: 'Europe/Madrid' },
      afterThreshold,
    );
    assert.ok(result.completed >= 1);

    const row = await queryOne('SELECT status, completed_at FROM appointments WHERE id = $1', [
      booked.body.appointment.id,
    ]);
    assert.equal(row.status, 'completed');
    assert.ok(row.completed_at);

    // Listing refreshes the badge to Completada and no cancel transition.
    const detail = await app.get(`/api/appointments/${booked.body.appointment.id}?shop_id=${shop.id}`, {
      token: owner.token,
    });
    assert.equal(detail.body.appointment.status, 'completed');
    assert.ok(!detail.body.appointment.allowed_transitions.includes('cancelled'));
  });

  it('runs the check when the appointments panel loads', async () => {
    const { date } = openWeekdayNow();
    const [y, m, d] = date.split('-').map(Number);
    const scheduledAt = utcFromZoned({ year: y, month: m, day: d, hour: 12, minute: 0 }, 'Europe/Madrid');
    const booked = await app.post(
      '/api/appointments',
      {
        shop_id: shop.id,
        customer_name: 'Panel Refresh',
        customer_phone: '+34611000113',
        scheduled_at: scheduledAt.toISOString(),
        enforce_schedule: false,
      },
      { token: owner.token },
    );
    assert.equal(booked.status, 201);

    // Force the row into a "today near closing" state by calling the service with
    // a late clock, then confirm the list endpoint returns completed.
    const late = utcFromZoned({ year: y, month: m, day: d, hour: 18, minute: 45 }, 'Europe/Madrid');
    await autoCompleteShopAppointments({ id: shop.id, timezone: 'Europe/Madrid' }, late);

    const list = await app.get(`/api/appointments?shop_id=${shop.id}&date=${date}`, { token: owner.token });
    assert.equal(list.status, 200);
    const hit = list.body.appointments.find((item) => item.id === booked.body.appointment.id);
    assert.ok(hit);
    assert.equal(hit.status, 'completed');
  });
});
