import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

/**
 * Lightweight unit coverage for data-cache helpers.
 * Network fetchers are stubbed via ensure* after injecting peeks.
 */
describe('data-cache keys and peek semantics', () => {
  it('exports stable cache key builders', async () => {
    const { cacheKeys, STALE_MS } = await import('../../public/js/data-cache.js');
    assert.equal(cacheKeys.appointments('shop-1'), 'appointments:shop-1');
    assert.equal(cacheKeys.urgencias('shop-1', 'active'), 'urgencias:shop-1:active');
    assert.equal(cacheKeys.urgencias('shop-1', 'history'), 'urgencias:shop-1:history');
    assert.ok(STALE_MS >= 10_000);
  });

  it('set/peek appointments round-trips', async () => {
    const mod = await import('../../public/js/data-cache.js');
    const shopId = '11111111-1111-1111-1111-111111111111';
    assert.equal(mod.peekAppointments(shopId), null);
    mod.setAppointmentsCache(shopId, [{ id: 'a1', customer_name: 'Ana' }]);
    const rows = mod.peekAppointments(shopId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].customer_name, 'Ana');
    mod.patchAppointmentInCache(shopId, { id: 'a1', status: 'cancelled' });
    assert.equal(mod.peekAppointments(shopId)[0].status, 'cancelled');
    mod.patchAppointmentInCache(shopId, { id: 'a2', customer_name: 'Bob' });
    assert.equal(mod.peekAppointments(shopId).length, 2);
  });

  it('urgencias patch/remove keep scopes in sync', async () => {
    const mod = await import('../../public/js/data-cache.js');
    const shopId = '22222222-2222-2222-2222-222222222222';
    mod.setUrgenciasCache(shopId, 'active', [
      { id: 'u1', status: 'pending', customer_name: 'Luis' },
    ]);
    mod.patchUrgenciaInCache(shopId, { id: 'u1', status: 'pending', customer_name: 'Luis M' });
    assert.equal(mod.peekUrgencias(shopId, 'active')[0].customer_name, 'Luis M');
    mod.removeUrgenciaFromCache(shopId, 'u1');
    assert.equal(mod.peekUrgencias(shopId, 'active').length, 0);
  });
});
