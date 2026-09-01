/**
 * Super Admin Consultas (monthly plate lookups) and the 31 Dec annual close.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { query } from '../../server/db/index.js';
import {
  closeAnnualYear,
  resetAnnualCloseForTests,
  YEAR_SUMMARY_TITLE,
} from '../../server/services/consultas.js';
import {
  closeDatabase,
  createOwner,
  createSuperAdmin,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';

describe('Consultas and annual year close', () => {
  let client;
  let owner;
  let admin;

  before(async () => {
    await resetDatabase();
    client = await startTestServer();
    admin = await createSuperAdmin(client);
    owner = await createOwner(client, { shop_name: 'Consulta Garage', timezone: 'Europe/Madrid' });
  });

  after(async () => {
    await client.close();
    await closeDatabase();
  });

  it('keeps Consultas Super-Admin-only', async () => {
    const forbidden = await client.get('/api/admin/consultas?year=2026&month=9', { token: owner.token });
    assert.equal(forbidden.status, 403);
  });

  it('counts official plate lookups per shop and user in a calendar month', async () => {
    await query(
      `INSERT INTO matriculas_lookups (user_id, shop_id, plate, found, reason, created_at)
       VALUES ($1, $2, '1234BCD', true, null, timestamptz '2026-09-02 10:00:00+02')`,
      [owner.user.id, owner.shop.id],
    );
    const response = await client.get('/api/admin/consultas?year=2026&month=9', { token: admin.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.year, 2026);
    assert.equal(response.body.month, 9);
    assert.ok(response.body.total_lookups >= 1);
    const shop = response.body.shops.find((row) => row.shop_id === owner.shop.id);
    assert.ok(shop);
    assert.ok(shop.lookups >= 1);
    assert.equal(shop.users[0].user_id, owner.user.id);
  });

  it('closes 2025 on demand, writes history and notifies the shop owner', async () => {
    await resetAnnualCloseForTests(2025);
    await query(`UPDATE shops SET created_at = timestamptz '2025-01-10 10:00:00+01' WHERE id = $1`, [
      owner.shop.id,
    ]);
    await query(
      `INSERT INTO appointments
         (shop_id, reference, customer_name, customer_phone, scheduled_at, status, source)
       VALUES
         ($1, 'YR-2025-A', 'Ana', '+34611000001', timestamptz '2025-03-10 10:00:00+01', 'confirmed', 'dashboard'),
         ($1, 'YR-2025-B', 'Luis', '+34611000002', timestamptz '2025-07-02 10:00:00+02', 'completed', 'dashboard')`,
      [owner.shop.id],
    );
    await query(
      `INSERT INTO matriculas_lookups (user_id, shop_id, plate, found, created_at)
       VALUES ($1, $2, '5847GKZ', true, timestamptz '2025-04-01 09:00:00+02')`,
      [owner.user.id, owner.shop.id],
    );
    await query(
      `INSERT INTO diagnostic_queries (shop_id, prompt, provider, created_by, created_at)
       VALUES ($1, 'ruido al frenar', 'local', $2, timestamptz '2025-08-12 09:00:00+02')`,
      [owner.shop.id, owner.user.id],
    );

    const closed = await closeAnnualYear({
      year: 2025,
      now: new Date('2025-12-31T17:00:00.000Z'),
      force: true,
    });
    assert.equal(closed.ran, true);
    assert.equal(closed.year, 2025);
    assert.ok(closed.shops_closed >= 1);
    assert.ok(closed.users_notified >= 1);

    const again = await closeAnnualYear({ year: 2025, force: true });
    assert.equal(again.reason, 'already_closed');

    const summary = await client.get('/api/workshop/year-summary?year=2025', { token: owner.token });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.message, 'Muchas gracias por hacernos parte de tu año');
    assert.equal(summary.body.closed, true);
    assert.ok(summary.body.totals.bookings_scheduled >= 2);
    assert.ok(summary.body.totals.bookings_completed >= 1);
    assert.ok(summary.body.totals.plate_lookups >= 1);
    assert.ok(summary.body.totals.diagnostic_queries >= 1);

    const notes = await client.get('/api/notifications', { token: owner.token });
    const yearNote = notes.body.notifications.find((row) => row.type === 'year_summary');
    assert.ok(yearNote);
    assert.equal(yearNote.title, YEAR_SUMMARY_TITLE);
    assert.equal(yearNote.link, '/rendimiento?year=2025');

    const annual = await client.get('/api/admin/consultas/annual?year=2025', { token: admin.token });
    assert.equal(annual.status, 200);
    const shop = annual.body.shops.find((row) => row.shop_id === owner.shop.id);
    assert.ok(shop);
    assert.equal(shop.closed, true);
    assert.ok(shop.plate_lookups >= 1);
  });
});
