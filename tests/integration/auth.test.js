import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDatabase,
  createOwner,
  resetDatabase,
  startTestServer,
  testEmail,
  testPhone,
} from '../helpers/harness.js';

let app;

before(async () => {
  await resetDatabase();
  app = await startTestServer();
});

after(async () => {
  await app.close();
  await closeDatabase();
});

describe('registro por correo y contraseña', () => {
  it('crea un dueño, su taller y una sesión', async () => {
    const email = testEmail();
    const phone = testPhone();
    const response = await app.post('/api/auth/register', {
      email,
      phone,
      password: 'GoodPass123',
      full_name: 'Marco Ruiz',
      shop_name: 'Derte Auto Centre',
      timezone: 'Europe/Madrid',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.user.email, email);
    assert.equal(response.body.user.phone, phone);
    assert.equal(response.body.user.role, 'shop_owner');
    assert.equal(response.body.user.shops.length, 1);
    assert.equal(response.body.user.shops[0].name, 'Derte Auto Centre');
    assert.ok(response.body.token);

    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /derte_session=/);
    assert.match(cookie, /HttpOnly/i);
  });

  it('normaliza el teléfono de contacto', async () => {
    const response = await app.post('/api/auth/register', {
      email: testEmail(),
      phone: '+34 611 22 33 44',
      password: 'GoodPass123',
      full_name: 'Spaced Owner',
      shop_name: 'Spaced Garage',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.phone, '+34611223344');
  });

  it('exige correo electrónico', async () => {
    const response = await app.post('/api/auth/register', {
      phone: testPhone(),
      password: 'GoodPass123',
      full_name: 'No Email',
      shop_name: 'No Email Garage',
    });
    assert.equal(response.status, 400);
  });

  it('rechaza una contraseña débil', async () => {
    const weak = await app.post('/api/auth/register', {
      email: testEmail(),
      phone: testPhone(),
      password: 'abcdefgh',
      full_name: 'Weak Pass',
      shop_name: 'Weak Garage',
    });
    assert.equal(weak.status, 400);
    assert.match(weak.body.error.message, /letra y un número/i);
  });

  it('no registra el mismo correo dos veces', async () => {
    const email = testEmail();
    const payload = {
      email,
      phone: testPhone(),
      password: 'GoodPass123',
      full_name: 'First',
      shop_name: 'First Garage',
    };
    assert.equal((await app.post('/api/auth/register', payload)).status, 201);
    const second = await app.post('/api/auth/register', {
      ...payload,
      phone: testPhone(),
      full_name: 'Second',
      shop_name: 'Second Garage',
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'email_taken');
  });
});

describe('inicio de sesión', () => {
  it('acepta correo y contraseña correctos', async () => {
    const owner = await createOwner(app);

    const ok = await app.post('/api/auth/login', { email: owner.email, password: owner.password });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
    assert.equal(ok.body.user.role, 'shop_owner');

    const bad = await app.post('/api/auth/login', { email: owner.email, password: 'WrongPass123' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'invalid_credentials');
    assert.match(bad.body.error.message, /correo o contraseña/i);
  });

  it('da la misma respuesta ante un correo desconocido', async () => {
    const unknown = await app.post('/api/auth/login', {
      email: 'nobody@gmail.com',
      password: 'GoodPass123',
    });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.code, 'invalid_credentials');
  });

  it('deja entrar al Super Admin con email y Marron1*', async () => {
    const { ensureSuperAdmin } = await import('../../server/db/seed.js');
    await ensureSuperAdmin();
    const response = await app.post('/api/auth/login', {
      email: process.env.SUPER_ADMIN_EMAIL,
      password: process.env.SUPER_ADMIN_PASSWORD,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.role, 'super_admin');
    assert.equal(response.body.user.email, process.env.SUPER_ADMIN_EMAIL);

    const me = await app.get('/api/auth/me', { token: response.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, 'super_admin');
  });

  it('no deja que un bearer de taller pise la cookie de Super Admin', async () => {
    const owner = await createOwner(app);
    const { ensureSuperAdmin } = await import('../../server/db/seed.js');
    await ensureSuperAdmin();
    const adminLogin = await app.post('/api/auth/login', {
      email: process.env.SUPER_ADMIN_EMAIL,
      password: process.env.SUPER_ADMIN_PASSWORD,
    });
    assert.equal(adminLogin.status, 200);
    const rawCookie = adminLogin.headers.getSetCookie?.()?.[0] ?? adminLogin.headers.get('set-cookie');
    assert.ok(rawCookie);
    const cookie = String(rawCookie).split(';')[0];

    const fused = await app.get('/api/auth/me', { token: owner.token, cookie });
    assert.equal(fused.status, 200);
    assert.equal(fused.body.user.role, 'super_admin');
    assert.equal(fused.body.user.email, process.env.SUPER_ADMIN_EMAIL);

    const mockFused = await app.get('/api/auth/me', { token: 'mock-token', cookie });
    assert.equal(mockFused.status, 200);
    assert.equal(mockFused.body.user.role, 'super_admin');
  });
});

describe('Google Sign-In', () => {
  it('expone si hay Client ID configurado', async () => {
    const config = await app.get('/api/auth/google/config');
    assert.equal(config.status, 200);
    assert.equal(typeof config.body.configured, 'boolean');
  });

  it('registra y entra con una credencial de prueba', async () => {
    const email = testEmail();
    const phone = testPhone();
    const credential = `test:${JSON.stringify({
      sub: `google-sub-${email}`,
      email,
      name: 'Google Owner',
      email_verified: true,
    })}`;

    const incomplete = await app.post('/api/auth/google', { credential });
    assert.equal(incomplete.status, 202);
    assert.equal(incomplete.body.needs_registration, true);
    assert.equal(incomplete.body.profile.email, email);

    const created = await app.post('/api/auth/google', {
      credential,
      shop_name: 'Google Garage',
      phone,
      full_name: 'Google Owner',
      password: 'GoodPass123',
      timezone: 'Europe/Madrid',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.email, email);
    assert.equal(created.body.user.google_linked, true);

    const again = await app.post('/api/auth/google', { credential });
    assert.equal(again.status, 200);
    assert.equal(again.body.user.email, email);
  });
});

describe('ciclo de sesión', () => {
  it('expone el perfil con el número para llamar', async () => {
    const owner = await createOwner(app);
    const me = await app.get('/api/auth/me', { token: owner.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, owner.email);
    assert.equal(me.body.contact.tel_link, `tel:${owner.phone}`);
  });

  it('rechaza peticiones sin token', async () => {
    assert.equal((await app.get('/api/auth/me')).status, 401);
  });

  it('invalida el token al cerrar sesión', async () => {
    const owner = await createOwner(app);
    assert.equal((await app.post('/api/auth/logout', {}, { token: owner.token })).status, 200);
    assert.equal((await app.get('/api/auth/me', { token: owner.token })).status, 401);
  });

  it('revoca todas las sesiones al cambiar la contraseña', async () => {
    const owner = await createOwner(app);
    const other = await app.post('/api/auth/login', { email: owner.email, password: owner.password });
    assert.equal(other.status, 200);

    const changed = await app.post(
      '/api/auth/password',
      { current_password: owner.password, new_password: 'NewPass456' },
      { token: owner.token },
    );
    assert.equal(changed.status, 200);

    assert.equal((await app.get('/api/auth/me', { token: owner.token })).status, 401);
    assert.equal((await app.get('/api/auth/me', { token: other.body.token })).status, 401);

    const fresh = await app.post('/api/auth/login', { email: owner.email, password: 'NewPass456' });
    assert.equal(fresh.status, 200);
  });

  it('actualiza el perfil sin tocar el correo de acceso', async () => {
    const owner = await createOwner(app);
    const patched = await app.patch(
      '/api/auth/me',
      { full_name: 'Nombre Nuevo' },
      { token: owner.token },
    );
    assert.equal(patched.status, 200);
    assert.equal(patched.body.user.full_name, 'Nombre Nuevo');
    assert.equal(patched.body.user.email, owner.email);
  });
});
