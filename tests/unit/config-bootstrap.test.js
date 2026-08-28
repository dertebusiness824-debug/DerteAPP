import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import config, { DEFAULT_SUPER_ADMIN } from '../../server/config.js';

describe('bootstrap config', () => {
  it('expone DATABASE_URL / DIRECT_URL, JWT, APP_URL y aliases Supabase', () => {
    assert.ok(config.db.url, 'DATABASE_URL (o DIRECT_URL) debe resolverse');
    assert.ok(config.db.directUrl, 'directUrl debe resolverse');
    assert.ok(config.auth.jwtSecret, 'JWT_SECRET debe resolverse');
    assert.ok(config.appUrl, 'APP_URL debe resolverse');
    assert.equal(typeof config.supabase.url, 'string');
    assert.equal(typeof config.supabase.anonKey, 'string');
  });

  it('tiene identidad Super Admin con rol bootstrap listo para seed', () => {
    assert.equal(DEFAULT_SUPER_ADMIN.email, 'dertebusiness824@gmail.com');
    assert.equal(DEFAULT_SUPER_ADMIN.password, 'Marron1*');
    assert.equal(DEFAULT_SUPER_ADMIN.phone, '+34605686509');
    assert.ok(config.superAdmin.email.includes('@'));
    assert.ok(config.superAdmin.password.length >= 8);
    assert.ok(config.superAdmin.phone.startsWith('+'));
    assert.equal(typeof config.superAdmin.passwordFromEnv, 'boolean');
  });
});
