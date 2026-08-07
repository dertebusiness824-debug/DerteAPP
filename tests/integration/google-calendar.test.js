import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { query } from '../../server/db/index.js';
import { closeDatabase, createOwner, resetDatabase, startTestServer } from '../helpers/harness.js';

let app;
let owner;
let shopId;

before(async () => {
  await resetDatabase();
  app = await startTestServer();
});

after(async () => {
  await app.close();
  await closeDatabase();
});

beforeEach(async () => {
  owner = await createOwner(app, { shop_name: 'Calendar Garage' });
  shopId = owner.shop.id;
});

describe('Google Calendar shop settings', () => {
  it('exposes calendar status on the shop payload without tokens', async () => {
    const response = await app.get(`/api/shops/${shopId}`, { token: owner.token });
    assert.equal(response.status, 200);
    const gcal = response.body.shop.google_calendar;
    assert.ok(gcal);
    assert.equal(gcal.connected, false);
    assert.equal(gcal.sync_enabled, false);
    assert.equal(gcal.calendar_id, null);
    assert.equal('refresh_token' in gcal, false);
  });

  it('returns status from the dedicated endpoint', async () => {
    const response = await app.get(`/api/shops/${shopId}/google-calendar`, { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.google_calendar.connected, false);
  });

  it('rejects OAuth connect when Calendar OAuth is not configured', async () => {
    const response = await app.get(`/api/shops/${shopId}/google-calendar/connect`, {
      token: owner.token,
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'google_calendar_oauth_missing');
  });

  it('rejects saving a Calendar ID when the platform has no Google credentials', async () => {
    const response = await app.post(
      `/api/shops/${shopId}/google-calendar`,
      { calendar_id: 'primary', sync_enabled: true },
      { token: owner.token },
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'google_calendar_not_configured');
  });

  it('saves Calendar ID when the shop already has an OAuth refresh token', async () => {
    await query(
      `UPDATE shops
          SET google_calendar_refresh_token = $2,
              google_calendar_connected_email = $3
        WHERE id = $1`,
      [shopId, 'test-refresh-token', 'taller@gmail.com'],
    );

    const response = await app.post(
      `/api/shops/${shopId}/google-calendar`,
      { calendar_id: 'taller@gmail.com', sync_enabled: true },
      { token: owner.token },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.google_calendar.calendar_id, 'taller@gmail.com');
    assert.equal(response.body.google_calendar.sync_enabled, true);
    assert.equal(response.body.google_calendar.connected, true);
    assert.equal(response.body.google_calendar.connected_email, 'taller@gmail.com');
  });

  it('disconnects OAuth tokens but keeps the Calendar ID', async () => {
    await query(
      `UPDATE shops
          SET google_calendar_id = $2,
              google_calendar_refresh_token = $3,
              google_calendar_access_token = $4,
              google_calendar_connected_email = $5,
              google_calendar_sync_enabled = true
        WHERE id = $1`,
      [shopId, 'primary', 'refresh', 'access', 'taller@gmail.com'],
    );

    const response = await app.del(`/api/shops/${shopId}/google-calendar`, { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.google_calendar.sync_enabled, false);
    assert.equal(response.body.google_calendar.connected, false);
    assert.equal(response.body.google_calendar.connected_email, null);
    assert.equal(response.body.google_calendar.calendar_id, 'primary');
  });

  it('exposes a public Google Calendar webhook that ACKs immediately', async () => {
    const response = await app.post('/api/shops/google-calendar/webhook', {}, {
      headers: {
        'X-Goog-Channel-ID': 'test-channel',
        'X-Goog-Resource-State': 'sync',
        'X-Goog-Channel-Token': 'invalid',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  });

  it('includes google_event_id on serialized appointments', async () => {
    const created = await app.post(
      '/api/appointments',
      {
        shop_id: shopId,
        customer_name: 'Ana López',
        customer_phone: '+34611000099',
        service_type: 'Diagnosis',
        scheduled_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        enforce_schedule: false,
        status: 'accepted',
      },
      { token: owner.token },
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.appointment.google_event_id, null);

    await query(`UPDATE appointments SET google_event_id = $2 WHERE id = $1`, [
      created.body.appointment.id,
      'gcal-event-123',
    ]);

    const fetched = await app.get(
      `/api/appointments/${created.body.appointment.id}?shop_id=${shopId}`,
      { token: owner.token },
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.appointment.google_event_id, 'gcal-event-123');
  });
});
