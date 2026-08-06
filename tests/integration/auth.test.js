import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDatabase, createOwner, resetDatabase, startTestServer, testPhone } from '../helpers/harness.js';

let app;

before(async () => {
  await resetDatabase();
  app = await startTestServer();
});

after(async () => {
  await app.close();
  await closeDatabase();
});

describe('phone number registration', () => {
  it('creates an owner, their shop and a live session', async () => {
    const phone = testPhone();
    const response = await app.post('/api/auth/register', {
      phone,
      password: 'GoodPass123',
      full_name: 'Marco Ruiz',
      shop_name: 'Derte Auto Centre',
      timezone: 'Europe/Madrid',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.user.phone, phone);
    assert.equal(response.body.user.role, 'shop_owner');
    assert.equal(response.body.user.shops.length, 1);
    assert.equal(response.body.user.shops[0].name, 'Derte Auto Centre');
    assert.ok(response.body.token);

    // The session cookie is httpOnly so the token is not readable from JS.
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /derte_session=/);
    assert.match(cookie, /HttpOnly/i);
  });

  it('normalises the phone number on the way in', async () => {
    const response = await app.post('/api/auth/register', {
      phone: '+34 611 22 33 44',
      password: 'GoodPass123',
      full_name: 'Spaced Owner',
      shop_name: 'Spaced Garage',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.phone, '+34611223344');
  });

  it('rejects a number without a country code', async () => {
    const response = await app.post('/api/auth/register', {
      phone: '611998877',
      password: 'GoodPass123',
      full_name: 'No Country',
      shop_name: 'No Country Garage',
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /country code/i);
  });

  it('rejects a weak password', async () => {
    const weak = await app.post('/api/auth/register', {
      phone: testPhone(),
      password: 'abcdefgh',
      full_name: 'Weak Pass',
      shop_name: 'Weak Garage',
    });
    assert.equal(weak.status, 400);
    assert.match(weak.body.error.message, /letter and one number/i);
  });

  it('will not register the same number twice', async () => {
    const phone = testPhone();
    const payload = { phone, password: 'GoodPass123', full_name: 'First', shop_name: 'First Garage' };
    assert.equal((await app.post('/api/auth/register', payload)).status, 201);
    const second = await app.post('/api/auth/register', { ...payload, full_name: 'Second' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'phone_taken');
  });
});

describe('sign in', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const owner = await createOwner(app);

    const ok = await app.post('/api/auth/login', { phone: owner.phone, password: owner.password });
    assert.equal(ok.status, 200);

    const bad = await app.post('/api/auth/login', { phone: owner.phone, password: 'WrongPass123' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'invalid_credentials');
  });

  it('gives the same answer for an unknown number as for a wrong password', async () => {
    const unknown = await app.post('/api/auth/login', { phone: testPhone(), password: 'GoodPass123' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.code, 'invalid_credentials');
  });

  it('signs in with a one-time passcode', async () => {
    const owner = await createOwner(app);
    const request = await app.post('/api/auth/otp/request', { phone: owner.phone, purpose: 'login' });
    assert.equal(request.status, 200);
    assert.ok(request.body.debug_code, 'OTP_DEBUG should expose the code in tests');

    const wrong = await app.post('/api/auth/otp/login', { phone: owner.phone, code: '000000' });
    assert.equal(wrong.status, 400);

    const login = await app.post('/api/auth/otp/login', { phone: owner.phone, code: request.body.debug_code });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.phone_verified, true);
  });

  it('does not reveal whether an unknown number has an account', async () => {
    const response = await app.post('/api/auth/otp/request', { phone: testPhone(), purpose: 'login' });
    assert.equal(response.status, 200);
    assert.equal(response.body.sent, true);
    assert.equal(response.body.debug_code, undefined);
  });

  it('will not reuse a passcode', async () => {
    const owner = await createOwner(app);
    const { body } = await app.post('/api/auth/otp/request', { phone: owner.phone, purpose: 'login' });
    assert.equal((await app.post('/api/auth/otp/login', { phone: owner.phone, code: body.debug_code })).status, 200);
    const replay = await app.post('/api/auth/otp/login', { phone: owner.phone, code: body.debug_code });
    assert.equal(replay.status, 400);
  });
});

describe('session lifecycle', () => {
  it('exposes the owner profile with a tappable number', async () => {
    const owner = await createOwner(app);
    const response = await app.get('/api/auth/me', { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.phone, owner.phone);
    // The registered number is public by design and must be call-ready.
    assert.equal(response.body.contact.tel_link, `tel:${owner.phone}`);
    assert.ok(response.body.contact.phone_display.startsWith('+'));
    assert.ok(response.body.contact.whatsapp_link.includes(owner.phone.slice(1)));
  });

  it('rejects requests without a token', async () => {
    assert.equal((await app.get('/api/auth/me')).status, 401);
    assert.equal((await app.get('/api/auth/me', { token: 'not-a-jwt' })).status, 401);
  });

  it('invalidates the token on sign out', async () => {
    const owner = await createOwner(app);
    assert.equal((await app.post('/api/auth/logout', {}, { token: owner.token })).status, 200);
    assert.equal((await app.get('/api/auth/me', { token: owner.token })).status, 401);
  });

  it('revokes every session when the password changes', async () => {
    const owner = await createOwner(app);
    const changed = await app.post(
      '/api/auth/password',
      { current_password: owner.password, new_password: 'BrandNew123' },
      { token: owner.token },
    );
    assert.equal(changed.status, 200);
    assert.ok(changed.body.token);
    // Old token is dead, the freshly issued one works.
    assert.equal((await app.get('/api/auth/me', { token: owner.token })).status, 401);
    assert.equal((await app.get('/api/auth/me', { token: changed.body.token })).status, 200);
    assert.equal((await app.post('/api/auth/login', { phone: owner.phone, password: 'BrandNew123' })).status, 200);
  });

  it('resets a forgotten password with a passcode', async () => {
    const owner = await createOwner(app);
    const { body } = await app.post('/api/auth/otp/request', { phone: owner.phone, purpose: 'reset' });
    const reset = await app.post('/api/auth/password/reset', {
      phone: owner.phone,
      code: body.debug_code,
      new_password: 'ResetPass123',
    });
    assert.equal(reset.status, 200);
    assert.equal((await app.post('/api/auth/login', { phone: owner.phone, password: 'ResetPass123' })).status, 200);
  });

  it('updates the profile without touching the login number', async () => {
    const owner = await createOwner(app);
    const response = await app.patch('/api/auth/me', { full_name: 'Renamed Owner' }, { token: owner.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.full_name, 'Renamed Owner');
    assert.equal(response.body.user.phone, owner.phone);
  });
});
