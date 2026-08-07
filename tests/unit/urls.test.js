import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHttpUrl } from '../../server/lib/urls.js';

describe('normalizeHttpUrl', () => {
  it('normaliza hosts bare a https', () => {
    assert.equal(normalizeHttpUrl('taller.example'), 'https://taller.example');
  });

  it('acepta http y https', () => {
    assert.equal(normalizeHttpUrl('https://panel.hostinger.com/sites/1'), 'https://panel.hostinger.com/sites/1');
    assert.equal(normalizeHttpUrl('http://localhost:8080/'), 'http://localhost:8080/');
  });

  it('limpia valores vacíos y omite undefined', () => {
    assert.equal(normalizeHttpUrl(''), null);
    assert.equal(normalizeHttpUrl(null), null);
    assert.equal(normalizeHttpUrl(undefined), undefined);
  });

  it('rechaza protocolos peligrosos', () => {
    assert.throws(() => normalizeHttpUrl('javascript:alert(1)'), (error) => error.status === 400);
  });
});
