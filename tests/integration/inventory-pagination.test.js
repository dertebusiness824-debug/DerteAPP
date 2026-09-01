/**
 * Inventory list is paginated so the PWA never paints hundreds of rows at once.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDatabase,
  createOwner,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';

describe('inventory pagination', () => {
  let client;

  before(async () => {
    await resetDatabase();
    client = await startTestServer();
  });

  after(async () => {
    await client.close();
    await closeDatabase();
  });

  it('returns has_more and respects limit/offset', async () => {
    const owner = await createOwner(client);
    for (let index = 0; index < 8; index += 1) {
      const created = await client.post(
        '/api/workshop/inventory',
        {
          shop_id: owner.shop.id,
          name: `Filtro ${String(index).padStart(2, '0')}`,
          category: 'filters',
          quantity: 1,
        },
        { token: owner.token },
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));
    }

    const first = await client.get(
      `/api/workshop/inventory?shop_id=${owner.shop.id}&limit=5&offset=0`,
      { token: owner.token },
    );
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 5);
    assert.equal(first.body.limit, 5);
    assert.equal(first.body.offset, 0);
    assert.equal(first.body.has_more, true);
    assert.equal(first.body.total, 8);

    const second = await client.get(
      `/api/workshop/inventory?shop_id=${owner.shop.id}&limit=5&offset=5`,
      { token: owner.token },
    );
    assert.equal(second.status, 200);
    assert.equal(second.body.items.length, 3);
    assert.equal(second.body.has_more, false);
    assert.equal(second.body.total, 8);
  });
});
