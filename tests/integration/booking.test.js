import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { queryOne } from '../../server/db/index.js';
import { closeDatabase, createOwner, resetDatabase, startTestServer } from '../helpers/harness.js';

let app;
let owner;
let shopId;
let publicKey;

/** Monday-to-Friday 09:00-18:00 with a 13:00-14:00 break, weekends off. */
const WEEK = [
  { weekday: 0, is_closed: true },
  { weekday: 1, is_closed: false, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
  { weekday: 2, is_closed: false, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
  { weekday: 3, is_closed: false, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
  { weekday: 4, is_closed: false, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
  { weekday: 5, is_closed: false, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
  { weekday: 6, is_closed: true },
];

/** Next Wednesday, comfortably inside the booking horizon. */
function nextWednesday() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 3);
  while (date.getUTCDay() !== 3) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const book = (body) => app.post(`/api/public/shops/${publicKey}/appointments`, {
  customer_name: 'Ana Ferreira',
  customer_phone: '+34611000001',
  service_type: 'Brakes',
  ...body,
});

before(async () => {
  await resetDatabase();
  app = await startTestServer();
});

after(async () => {
  await app.close();
  await closeDatabase();
});

beforeEach(async () => {
  owner = await createOwner(app, { shop_name: 'Schedule Garage', timezone: 'Europe/Madrid' });
  shopId = owner.shop.id;
  await app.put(`/api/shops/${shopId}/schedule`, { days: WEEK }, { token: owner.token });
  const shop = await app.get(`/api/shops/${shopId}`, { token: owner.token });
  publicKey = shop.body.shop.public_key;
});

describe('published availability', () => {
  it('reflects the opening hours, break and capacity', async () => {
    const date = nextWednesday();
    const response = await app.get(`/api/public/shops/${publicKey}/availability?date=${date}`);
    assert.equal(response.status, 200);

    const [day] = response.body.days;
    assert.equal(day.date, date);
    assert.equal(day.is_closed, false);
    assert.equal(day.open_time, '09:00');
    assert.equal(day.close_time, '18:00');

    const times = day.slots.map((slot) => slot.time);
    assert.deepEqual(times, ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00']);
    assert.ok(!times.includes('13:00'), 'the break must not be offered');
    assert.ok(!times.includes('18:00'), 'a slot may not end after closing');
  });

  it('marks weekends as closed with no slots', async () => {
    const sunday = new Date();
    sunday.setUTCDate(sunday.getUTCDate() + 2);
    while (sunday.getUTCDay() !== 0) sunday.setUTCDate(sunday.getUTCDate() + 1);
    const date = sunday.toISOString().slice(0, 10);

    const response = await app.get(`/api/public/shops/${publicKey}/availability?date=${date}`);
    const [day] = response.body.days;
    assert.equal(day.is_closed, true);
    assert.deepEqual(day.slots, []);
  });

  it('honours a day-off exception added by the owner', async () => {
    const date = nextWednesday();
    const created = await app.post(
      `/api/shops/${shopId}/exceptions`,
      { date, is_closed: true, note: 'Team training' },
      { token: owner.token },
    );
    assert.equal(created.status, 201);

    const response = await app.get(`/api/public/shops/${publicKey}/availability?date=${date}`);
    const [day] = response.body.days;
    assert.equal(day.is_closed, true);
    assert.equal(day.note, 'Team training');
    assert.equal(day.source, 'exception');
  });
});

describe('booking guards for Hostinger forms', () => {
  it('accepts a slot inside opening hours', async () => {
    const response = await book({ date: nextWednesday(), time: '11:00' });
    assert.equal(response.status, 201);
    assert.equal(response.body.booked, true);
    assert.match(response.body.reference, /^DA-[A-Z0-9]{6}$/);
    assert.equal(response.body.status, 'pending');
  });

  it('stores the time as the shop wall clock, not the server clock', async () => {
    const date = nextWednesday();
    const response = await book({ date, time: '09:00' });
    assert.equal(response.status, 201);

    const stored = new Date(response.body.scheduled_at);
    const localHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(stored);
    assert.equal(localHour, '09');
  });

  it('refuses a time after closing', async () => {
    const response = await book({ date: nextWednesday(), time: '22:00' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'outside_hours');
    assert.match(response.body.error.message, /09:00-18:00/);
  });

  it('refuses a time before opening', async () => {
    const response = await book({ date: nextWednesday(), time: '07:00' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'outside_hours');
  });

  it('refuses a slot that overlaps the break', async () => {
    const response = await book({ date: nextWednesday(), time: '13:30' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'break_time');
    assert.match(response.body.error.message, /13:00 and 14:00/);
  });

  it('refuses a day off', async () => {
    const saturday = new Date();
    saturday.setUTCDate(saturday.getUTCDate() + 2);
    while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
    const response = await book({ date: saturday.toISOString().slice(0, 10), time: '11:00' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'closed_day');
  });

  it('stops booking once the slot capacity is used up', async () => {
    const date = nextWednesday();
    await app.patch(`/api/shops/${shopId}`, { capacity: 2 }, { token: owner.token });

    assert.equal((await book({ date, time: '10:00' })).status, 201);
    assert.equal((await book({ date, time: '10:00' })).status, 201);

    const third = await book({ date, time: '10:00' });
    assert.equal(third.status, 409);
    assert.equal(third.body.error.code, 'full');

    // A neighbouring slot is still free.
    assert.equal((await book({ date, time: '11:00' })).status, 201);
  });

  it('respects the minimum notice', async () => {
    await app.patch(`/api/shops/${shopId}`, { min_notice_minutes: 24 * 60 }, { token: owner.token });
    const response = await book({ date: nextWednesday(), time: '11:00' });
    // nextWednesday() is 3-9 days out, so a 1-day notice still allows it.
    assert.equal(response.status, 201);

    await app.patch(`/api/shops/${shopId}`, { min_notice_minutes: 20_000 }, { token: owner.token });
    const tooSoon = await book({ date: nextWednesday(), time: '12:00' });
    assert.equal(tooSoon.status, 409);
    assert.equal(tooSoon.body.error.code, 'too_soon');
  });

  it('respects the booking horizon', async () => {
    await app.patch(`/api/shops/${shopId}`, { booking_horizon_days: 2 }, { token: owner.token });
    const response = await book({ date: nextWednesday(), time: '11:00' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'beyond_horizon');
  });

  it('rejects a booking in the past', async () => {
    const lastWeek = new Date();
    lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
    while (lastWeek.getUTCDay() !== 3) lastWeek.setUTCDate(lastWeek.getUTCDate() - 1);
    const response = await book({ date: lastWeek.toISOString().slice(0, 10), time: '11:00' });
    assert.equal(response.status, 409);
    assert.ok(['in_past', 'too_soon'].includes(response.body.error.code));
  });

  it('validates the customer details', async () => {
    const noPhone = await book({ date: nextWednesday(), time: '11:00', customer_phone: 'abc' });
    assert.equal(noPhone.status, 400);

    const noName = await book({ date: nextWednesday(), time: '11:00', customer_name: 'A' });
    assert.equal(noName.status, 400);
  });

  it('accepts a local number when the shop declares its country', async () => {
    await app.patch(`/api/shops/${shopId}`, { country_code: '34' }, { token: owner.token });
    const response = await book({ date: nextWednesday(), time: '15:00', customer_phone: '611 22 33 55' });
    assert.equal(response.status, 201);

    const stored = await queryOne('SELECT customer_phone FROM appointments WHERE reference = $1', [
      response.body.reference,
    ]);
    assert.equal(stored.customer_phone, '+34611223355');
  });

  it('silently swallows honeypot submissions', async () => {
    const response = await book({ date: nextWednesday(), time: '16:00', trap: 'spam' });
    assert.equal(response.status, 202);
    const stored = await queryOne(`SELECT count(*)::int AS total FROM appointments WHERE shop_id = $1`, [shopId]);
    assert.equal(stored.total, 0);
  });

  it('rejects an unknown or rotated site key', async () => {
    assert.equal((await app.get('/api/public/shops/dk_does_not_exist/config')).status, 404);

    const rotated = await app.post(`/api/shops/${shopId}/rotate-public-key`, {}, { token: owner.token });
    assert.equal(rotated.status, 200);
    assert.equal((await app.get(`/api/public/shops/${publicKey}/config`)).status, 404);
    assert.equal((await app.get(`/api/public/shops/${rotated.body.public_key}/config`)).status, 200);
  });

  it('will not take bookings for a suspended shop', async () => {
    await queryOne(`UPDATE shops SET status = 'suspended' WHERE id = $1 RETURNING id`, [shopId]);
    const response = await book({ date: nextWednesday(), time: '11:00' });
    assert.equal(response.status, 403);
  });
});

describe('slot pre-check used by the embed script', () => {
  it('confirms a bookable slot', async () => {
    const response = await app.post(`/api/public/shops/${publicKey}/check-slot`, {
      date: nextWednesday(),
      time: '10:00',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.bookable, true);
    assert.deepEqual(response.body.opening_hours, {
      open_time: '09:00',
      close_time: '18:00',
      break_start: '13:00',
      break_end: '14:00',
    });
  });

  it('explains why a slot is not bookable', async () => {
    const response = await app.post(`/api/public/shops/${publicKey}/check-slot`, {
      date: nextWednesday(),
      time: '13:15',
    });
    assert.equal(response.body.bookable, false);
    assert.equal(response.body.reason, 'break_time');
    assert.match(response.body.message, /break/i);
  });
});

describe('dashboard bookings', () => {
  it('lets the owner slot in a job outside opening hours', async () => {
    const date = nextWednesday();
    const response = await app.post(
      '/api/appointments',
      {
        shop_id: shopId,
        customer_name: 'Walk In',
        customer_phone: '+34611000009',
        scheduled_at: `${date}T20:30:00+02:00`,
        duration_minutes: 30,
        enforce_schedule: false,
      },
      { token: owner.token },
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.appointment.status, 'accepted');
    assert.equal(response.body.appointment.customer_tel_link, 'tel:+34611000009');
    assert.equal(response.body.chat_link, undefined);
  });

  it('applies the schedule when the owner asks for it', async () => {
    const date = nextWednesday();
    const response = await app.post(
      '/api/appointments',
      {
        shop_id: shopId,
        customer_name: 'Walk In',
        customer_phone: '+34611000009',
        scheduled_at: `${date}T20:30:00+02:00`,
        enforce_schedule: true,
      },
      { token: owner.token },
    );
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'outside_hours');
  });

  it('moves an appointment through its status flow', async () => {
    const booked = await book({ date: nextWednesday(), time: '12:00' });
    const list = await app.get(`/api/appointments?shop_id=${shopId}&status=pending`, { token: owner.token });
    const appointment = list.body.appointments.find((item) => item.reference === booked.body.reference);
    assert.ok(appointment);
    assert.deepEqual(appointment.allowed_transitions, ['accepted', 'cancelled', 'no_show']);

    const path = `/api/appointments/${appointment.id}/status`;
    assert.equal((await app.post(path, { shop_id: shopId, status: 'accepted' }, { token: owner.token })).status, 200);
    assert.equal((await app.post(path, { shop_id: shopId, status: 'in_progress' }, { token: owner.token })).status, 200);
    assert.equal((await app.post(path, { shop_id: shopId, status: 'completed' }, { token: owner.token })).status, 200);

    const invalid = await app.post(path, { shop_id: shopId, status: 'in_progress' }, { token: owner.token });
    assert.equal(invalid.status, 409);
    assert.equal(invalid.body.error.code, 'invalid_transition');
  });
});
