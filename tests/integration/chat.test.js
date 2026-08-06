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

/** Books and accepts one appointment, returning the customer chat handle. */
async function bookAndAccept({ time = '11:00' } = {}) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 3);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);

  const booked = await app.post(`/api/public/shops/${publicKey}/appointments`, {
    customer_name: 'Ana Ferreira',
    customer_phone: '+34611000001',
    service_type: 'Brakes',
    vehicle_make: 'Seat',
    vehicle_model: 'Leon',
    date: date.toISOString().slice(0, 10),
    time,
  });
  assert.equal(booked.status, 201);

  const list = await app.get(`/api/appointments?shop_id=${shopId}&status=pending`, { token: owner.token });
  const appointment = list.body.appointments.find((item) => item.reference === booked.body.reference);

  const accepted = await app.post(
    `/api/appointments/${appointment.id}/accept`,
    { shop_id: shopId },
    { token: owner.token },
  );
  assert.equal(accepted.status, 200);
  return {
    appointment,
    accepted: accepted.body,
    token: accepted.body.chat_link.split('/c/')[1],
    threadId: accepted.body.chat_thread_id,
  };
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

describe('customer chat created on acceptance', () => {
  it('returns a unique secure link and a ready-to-send message', async () => {
    const { accepted } = await bookAndAccept({ time: '09:00' });
    assert.match(accepted.chat_link, /\/c\/[A-Za-z0-9_-]{20,}$/);
    assert.equal(accepted.appointment.status, 'accepted');
    assert.match(accepted.share_message, /Chat with us here/);
    assert.ok(accepted.share_message.includes(accepted.chat_link));

    const second = await bookAndAccept({ time: '10:00' });
    assert.notEqual(second.accepted.chat_link, accepted.chat_link, 'each booking gets its own link');
  });

  it('reuses the same thread when the booking is accepted again', async () => {
    const first = await bookAndAccept({ time: '11:00' });
    const again = await app.post(
      `/api/appointments/${first.appointment.id}/accept`,
      { shop_id: shopId },
      { token: owner.token },
    );
    assert.equal(again.status, 200);
    assert.equal(again.body.chat_thread_id, first.threadId);
    assert.equal(again.body.chat_link, first.accepted.chat_link);
  });

  it('shows the shop owner phone number at the top of the customer chat', async () => {
    const { token, appointment } = await bookAndAccept({ time: '12:00' });
    const view = await app.get(`/api/public/chat/${token}`);
    assert.equal(view.status, 200);

    // This is the tap-to-call header the customer sees.
    assert.equal(view.body.contact.phone, owner.phone);
    assert.equal(view.body.contact.tel_link, `tel:${owner.phone}`);
    assert.equal(view.body.contact.owner_name, 'Marco Ruiz');
    assert.ok(view.body.contact.phone_display.startsWith('+'));
    assert.ok(view.body.contact.whatsapp_link.includes(owner.phone.slice(1)));
    assert.equal(view.body.contact.shop_name, 'Chat Garage');

    // The booking context and the confirmation message travel with it.
    assert.equal(view.body.appointment.reference, appointment.reference);
    assert.equal(view.body.messages[0].sender_type, 'system');
    assert.match(view.body.messages[0].body, /confirmed/);
    // The greeting repeats the number so it is reachable even without the header.
    assert.ok(
      view.body.messages[0].body.includes(view.body.contact.phone_display),
      `expected the confirmation to quote ${view.body.contact.phone_display}`,
    );
  });

  it('never leaks the access token to the customer payload', async () => {
    const { token } = await bookAndAccept({ time: '14:00' });
    const view = await app.get(`/api/public/chat/${token}`);
    assert.equal(view.body.thread.access_token, undefined);
    assert.equal(view.body.thread.chat_link, undefined);
  });

  it('rejects an unknown chat link', async () => {
    assert.equal((await app.get('/api/public/chat/not-a-real-token-abcdefghijklmno')).status, 404);
    assert.equal((await app.get('/api/public/chat/short')).status, 404);
  });
});

describe('customer and owner exchange messages', () => {
  it('delivers both ways and keeps the phone numbers attached', async () => {
    const { token, threadId } = await bookAndAccept({ time: '15:00' });

    const fromCustomer = await app.post(`/api/public/chat/${token}/messages`, {
      body: 'Hi! Can I drop the car off 15 minutes early?',
    });
    assert.equal(fromCustomer.status, 201);
    assert.equal(fromCustomer.body.message.sender_type, 'customer');
    assert.equal(fromCustomer.body.message.sender_phone, '+34611000001');

    const thread = await app.get(`/api/chat/threads/${threadId}`, { token: owner.token });
    assert.equal(thread.status, 200);
    assert.ok(thread.body.messages.some((message) => message.body.includes('15 minutes early')));
    // The owner also sees the customer's number as a tappable link.
    assert.equal(thread.body.thread.customer_tel_link, 'tel:+34611000001');
    assert.ok(thread.body.thread.customer_whatsapp_link.includes('34611000001'));

    const reply = await app.post(
      `/api/chat/threads/${threadId}/messages`,
      { body: 'Of course, see you then.' },
      { token: owner.token },
    );
    assert.equal(reply.status, 201);
    assert.equal(reply.body.message.sender_type, 'shop');
    assert.equal(reply.body.message.sender_phone, owner.phone);

    const customerView = await app.get(`/api/public/chat/${token}`);
    assert.ok(customerView.body.messages.some((message) => message.body === 'Of course, see you then.'));
  });

  it('tracks unread counts for each side', async () => {
    const { token, threadId } = await bookAndAccept({ time: '16:00' });
    await app.post(`/api/public/chat/${token}/messages`, { body: 'Question one' });
    await app.post(`/api/public/chat/${token}/messages`, { body: 'Question two' });

    const unread = await app.get(`/api/chat/unread?shop_id=${shopId}`, { token: owner.token });
    assert.ok(unread.body.customer >= 2);

    // Opening the thread clears the shop's unread badge.
    await app.get(`/api/chat/threads/${threadId}`, { token: owner.token });
    const threads = await app.get(`/api/chat/threads?shop_id=${shopId}&kind=customer`, { token: owner.token });
    const thread = threads.body.threads.find((item) => item.id === threadId);
    assert.equal(thread.unread_for_shop, 0);
  });

  it('rejects an empty message', async () => {
    const { token } = await bookAndAccept({ time: '17:00' });
    assert.equal((await app.post(`/api/public/chat/${token}/messages`, { body: '   ' })).status, 400);
  });

  it('announces status changes in the conversation', async () => {
    const { appointment, token } = await bookAndAccept({ time: '09:00' });
    await app.post(
      `/api/appointments/${appointment.id}/status`,
      { shop_id: shopId, status: 'completed' },
      { token: owner.token },
    );
    const view = await app.get(`/api/public/chat/${token}`);
    assert.ok(view.body.messages.some((message) => message.sender_type === 'system' && /ready for pickup/i.test(message.body)));
  });

  it('keeps conversations inside their own tenant', async () => {
    const { threadId } = await bookAndAccept({ time: '10:00' });
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
});
