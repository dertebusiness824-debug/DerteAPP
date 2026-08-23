import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { query, queryOne } from '../../server/db/index.js';
import { flushCalcomWebhookWork } from '../../server/routes/webhooks.js';
import { listShopPushSubscriptions } from '../../server/services/web-push.js';
import { closeDatabase, createOwner, resetDatabase, startTestServer } from '../helpers/harness.js';

describe('Cal.com BOOKING_CREATED webhook', () => {
  let client;

  before(async () => {
    client = await startTestServer();
  });
  after(async () => {
    await client.close();
    await closeDatabase();
  });
  beforeEach(resetDatabase);

  it('exposes a readiness endpoint', async () => {
    const response = await client.get('/api/webhooks/calcom');
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'calcom');
    assert.equal(response.body.ready, true);
    assert.deepEqual(response.body.events, ['BOOKING_CREATED']);
  });

  it('ACKs 200 and queries shop push_subscriptions before sending', async () => {
    const owner = await createOwner(client);
    const shopId = owner.shop.id;
    await query(
      `INSERT INTO push_subscriptions (user_id, shop_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        owner.user.id,
        shopId,
        'https://web.push.apple.com/calcom-test-endpoint',
        'dGVzdC1wMjU2ZGgtY2FsY29t',
        'dGVzdC1hdXRoLWNhbGNvbQ',
      ],
    );

    const rows = await listShopPushSubscriptions(shopId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].shop_id, shopId);
    assert.equal(rows[0].endpoint, 'https://web.push.apple.com/calcom-test-endpoint');

    const response = await client.post('/api/webhooks/calcom', {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'cal_int_1',
        eventTitle: 'ITV + revisión',
        startTime: '2026-08-25T09:00:00.000Z',
        organizer: { email: owner.email, timeZone: 'Europe/Madrid' },
        attendees: [{ name: 'Luis Pérez', timeZone: 'Europe/Madrid' }],
        metadata: { derte_shop_id: shopId },
      },
    });
    await flushCalcomWebhookWork();

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);
    assert.equal(response.body.triggerEvent, 'BOOKING_CREATED');

    const stored = await queryOne(
      `SELECT count(*)::int AS n FROM push_subscriptions WHERE shop_id = $1`,
      [shopId],
    );
    assert.equal(stored.n, 1);
  });

  it('resolves the shop from the organizer email when metadata is missing', async () => {
    const owner = await createOwner(client, { email: 'marco.calcom@gmail.com' });
    await query(`UPDATE shops SET email = $2 WHERE id = $1`, [owner.shop.id, owner.email]);

    const callsShop = owner.shop.id;
    const response = await client.post('/api/webhooks/calcom', {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'cal_int_2',
        eventTitle: 'Cambio de aceite',
        startTime: '2026-08-26T14:00:00.000Z',
        organizer: { email: owner.email, timeZone: 'Atlantic/Canary' },
        attendees: [{ name: 'Ana' }],
      },
    });
    await flushCalcomWebhookWork();
    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);

    const shop = await queryOne(`SELECT id, email FROM shops WHERE lower(email) = lower($1)`, [
      owner.email,
    ]);
    assert.equal(shop.id, callsShop);
  });
});
