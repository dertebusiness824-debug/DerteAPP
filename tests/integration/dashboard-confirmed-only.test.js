import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDatabase,
  createOwner,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';
import { query, queryOne } from '../../server/db/index.js';
import { forceConfirmLegacyAppointments } from '../../server/services/appointments.js';
import { utcFromZoned, zonedDateString, zonedParts } from '../../server/lib/time.js';

let app;
let owner;
let shop;

before(async () => {
  await resetDatabase();
  app = await startTestServer();
  owner = await createOwner(app, { shop_name: 'Confirmed Only Garage', timezone: 'Europe/Madrid' });
  shop = (await app.get(`/api/shops/${owner.shop.id}`, { token: owner.token })).body.shop;
});

after(async () => {
  await app.close();
  await closeDatabase();
});

function openWeekday() {
  const cursor = new Date();
  for (let i = 0; i < 14; i += 1) {
    const parts = zonedParts(cursor, 'Europe/Madrid');
    if (parts.weekday >= 1 && parts.weekday <= 5) {
      return zonedDateString(cursor, 'Europe/Madrid');
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error('No weekday');
}

describe('dashboard confirmed-only flow', () => {
  it('force-confirms legacy pending rows in the database', async () => {
    const date = openWeekday();
    const [y, m, d] = date.split('-').map(Number);
    const scheduledAt = utcFromZoned({ year: y, month: m, day: d, hour: 10, minute: 0 }, 'Europe/Madrid');

    const booked = await app.post(
      '/api/appointments',
      {
        shop_id: shop.id,
        customer_name: 'Legacy Pending',
        customer_phone: '+34611000999',
        scheduled_at: scheduledAt.toISOString(),
        enforce_schedule: false,
      },
      { token: owner.token },
    );
    assert.equal(booked.status, 201);

    // Simulate a leftover pending row (old clients / imports).
    await query(`UPDATE appointments SET status = 'pending' WHERE id = $1`, [booked.body.appointment.id]);

    const updated = await forceConfirmLegacyAppointments();
    assert.ok(updated >= 1);

    const row = await queryOne('SELECT status FROM appointments WHERE id = $1', [booked.body.appointment.id]);
    assert.equal(row.status, 'confirmed');
  });

  it('overview has no legacy pending metric and exposes home job counters', async () => {
    const overview = await app.get(`/api/shops/${shop.id}/overview`, { token: owner.token });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.stats.pending, undefined);
    assert.ok('confirmed_today' in overview.body.stats);
    assert.ok('completed_today' in overview.body.stats);
    assert.ok('pending_urgencias' in overview.body.stats);
    assert.ok('pending_bookings_today' in overview.body.stats);
    assert.equal(typeof overview.body.stats.pending_urgencias, 'number');
    assert.equal(typeof overview.body.stats.pending_bookings_today, 'number');

    const today = await app.get(`/api/appointments/today?shop_id=${shop.id}`, { token: owner.token });
    assert.equal(today.status, 200);
    for (const item of today.body.appointments) {
      assert.ok(['confirmed', 'completed', 'in_progress'].includes(item.status), item.status);
    }
  });

  it('serves the public_key board without a user session', async () => {
    const board = await app.get(`/api/appointments/board?public_key=${shop.public_key}`);
    assert.equal(board.status, 200);
    assert.ok(Array.isArray(board.body.appointments));
    assert.equal(board.body.fallback, true);
  });

  it('returns an empty board for an unknown public_key (no login wall)', async () => {
    const board = await app.get('/api/appointments/board?public_key=unknown-key-xxxxxx');
    assert.equal(board.status, 200);
    assert.deepEqual(board.body.appointments, []);
  });

  it('accepts repeated status query params from the appointments panel', async () => {
    const list = await app.get(
      `/api/appointments?shop_id=${shop.id}&status=confirmed&status=completed&status=in_progress`,
      { token: owner.token },
    );
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.appointments));
    for (const item of list.body.appointments) {
      assert.ok(['confirmed', 'completed', 'in_progress'].includes(item.status), item.status);
    }
  });

  it('accepts a comma-separated status filter without 400', async () => {
    const list = await app.get(
      `/api/appointments?shop_id=${shop.id}&status=confirmed,completed,in_progress`,
      { token: owner.token },
    );
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.appointments));
  });

  it('rejects the removed Accept endpoint', async () => {
    const date = openWeekday();
    const [y, m, d] = date.split('-').map(Number);
    const scheduledAt = utcFromZoned({ year: y, month: m, day: d, hour: 11, minute: 0 }, 'Europe/Madrid');
    const booked = await app.post(
      '/api/appointments',
      {
        shop_id: shop.id,
        customer_name: 'No Accept',
        customer_phone: '+34611000998',
        scheduled_at: scheduledAt.toISOString(),
        enforce_schedule: false,
      },
      { token: owner.token },
    );
    const accept = await app.post(
      `/api/appointments/${booked.body.appointment.id}/accept`,
      { shop_id: shop.id },
      { token: owner.token },
    );
    assert.equal(accept.status, 410);
    assert.equal(accept.body.error.code, 'accept_removed');
  });
});
