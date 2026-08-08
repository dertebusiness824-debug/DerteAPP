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

/** Books and accepts one appointment (no customer chat is created). */
async function bookAndAccept({ time = '11:00' } = {}) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 3);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);

  const booked = await app.post(`/api/public/shops/${publicKey}/appointments`, {
    customer_name: 'Ana Ferreira',
    customer_phone: '+34611000001',
    customer_email: 'ana.ferreira@example.com',
    service_type: 'Brakes',
    vehicle_make: 'Seat',
    vehicle_model: 'Leon',
    vehicle_plate: '1234ABC',
    date: date.toISOString().slice(0, 10),
    time,
  });
  assert.equal(booked.status, 201);

  const list = await app.get(`/api/appointments?shop_id=${shopId}&status=confirmed`, { token: owner.token });
  const appointment = list.body.appointments.find((item) => item.reference === booked.body.reference);
  assert.ok(appointment);
  assert.equal(appointment.status, 'confirmed');
  return { appointment, accepted: { appointment } };
}

before(async () => {
  await resetDatabase();
  app = await startTestServer();
  admin = await createSuperAdmin(app);
  owner = await createOwner(app, { shop_name: 'Chat Garage', full_name: 'Marco Ruiz' });
  shopId = owner.shop.id;
  publicKey = (await app.get(`/api/shops/${shopId}`, { token: owner.token })).body.shop.public_key;
});

after(async () => {
  await app.close();
  await closeDatabase();
});

describe('accepting a booking keeps customer contact on the card', () => {
  it('returns the booking with phone, email, vehicle and plate — no chat link', async () => {
    const { accepted, appointment } = await bookAndAccept({ time: '09:00' });
    assert.equal(appointment.status, 'confirmed');
    assert.equal(appointment.customer_name, 'Ana Ferreira');
    assert.equal(appointment.customer_email, 'ana.ferreira@example.com');
    assert.equal(appointment.vehicle.make, 'Seat');
    assert.equal(appointment.vehicle.model, 'Leon');
    assert.equal(appointment.vehicle.plate, '1234ABC');
    assert.equal(appointment.customer_tel_link, 'tel:+34611000001');
    assert.equal(accepted.chat_link, undefined);
    assert.equal(accepted.chat_thread_id, undefined);
    assert.equal(accepted.share_message, undefined);
  });

  it('lists only support threads for the shop (no customer chats)', async () => {
    await bookAndAccept({ time: '10:00' });
    const threads = await app.get(`/api/chat/threads?shop_id=${shopId}`, { token: owner.token });
    assert.equal(threads.status, 200);
    assert.ok(threads.body.threads.every((thread) => thread.kind === 'support'));
  });
});

describe('legacy customer chat endpoints are gone', () => {
  it('returns 410 for public customer chat routes', async () => {
    assert.equal((await app.get('/api/public/chat/any-old-token-abcdefghijklmno')).status, 410);
    assert.equal(
      (await app.post('/api/public/chat/any-old-token-abcdefghijklmno/messages', { body: 'Hi' })).status,
      410,
    );
  });

  it('returns 410 for legacy /c/:token pages', async () => {
    const response = await app.get('/c/any-old-token-abcdefghijklmno');
    assert.equal(response.status, 410);
  });
});

describe('shop owner to Super Admin support line', () => {
  it('opens one support thread per shop and carries the owner number', async () => {
    const support = await app.get(`/api/chat/support?shop_id=${shopId}`, { token: owner.token });
    assert.equal(support.status, 200);
    assert.equal(support.body.thread.kind, 'support');
    assert.equal(support.body.contact.phone, owner.phone);

    const again = await app.get(`/api/chat/support?shop_id=${shopId}`, { token: owner.token });
    assert.equal(again.body.thread.id, support.body.thread.id, 'the support thread is reused');
  });

  it('lets the owner and the Super Admin talk to each other', async () => {
    const support = await app.get(`/api/chat/support?shop_id=${shopId}`, { token: owner.token });
    const threadId = support.body.thread.id;

    const fromOwner = await app.post(
      `/api/chat/threads/${threadId}/messages`,
      { body: 'Please connect our new Zadarma number.' },
      { token: owner.token },
    );
    assert.equal(fromOwner.status, 201);
    assert.equal(fromOwner.body.message.sender_type, 'shop');

    const fromAdmin = await app.post(
      `/api/chat/threads/${threadId}/messages`,
      { body: 'Routing it today.' },
      { token: admin.token },
    );
    assert.equal(fromAdmin.status, 201);
    assert.equal(fromAdmin.body.message.sender_type, 'admin');
    assert.match(fromAdmin.body.message.sender_name, /DerteApp$/);

    const ownerView = await app.get(`/api/chat/threads/${threadId}`, { token: owner.token });
    assert.ok(ownerView.body.messages.some((message) => message.body === 'Routing it today.'));
  });

  it('shows the owner number in the Super Admin inbox', async () => {
    await app.post(
      `/api/chat/threads/${(await app.get(`/api/chat/support?shop_id=${shopId}`, { token: owner.token })).body.thread.id}/messages`,
      { body: 'One more question.' },
      { token: owner.token },
    );

    const inbox = await app.get('/api/admin/inbox', { token: admin.token });
    assert.equal(inbox.status, 200);
    const entry = inbox.body.threads.find((thread) => thread.shop_id === shopId);
    assert.ok(entry, 'the shop should appear in the support inbox');
    assert.equal(entry.owner_phone, owner.phone);
    assert.equal(entry.owner_tel_link, `tel:${owner.phone}`);
    assert.ok(entry.owner_phone_display.startsWith('+'));
    assert.ok(entry.unread_for_other >= 1);
  });

  it('keeps the support inbox for Super Admins only', async () => {
    assert.equal((await app.get('/api/admin/inbox', { token: owner.token })).status, 403);
  });

  it('keeps support conversations inside their own tenant', async () => {
    const support = await app.get(`/api/chat/support?shop_id=${shopId}`, { token: owner.token });
    const threadId = support.body.thread.id;
    const otherOwner = await createOwner(app, { shop_name: 'Other Garage' });

    const read = await app.get(`/api/chat/threads/${threadId}`, { token: otherOwner.token });
    assert.equal(read.status, 403);

    const write = await app.post(
      `/api/chat/threads/${threadId}/messages`,
      { body: 'I should not be able to write here' },
      { token: otherOwner.token },
    );
    assert.equal(write.status, 403);
  });
});
