import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { queryOne } from '../../server/db/index.js';
import {
  closeDatabase,
  createOwner,
  createSuperAdmin,
  resetDatabase,
  startTestServer,
} from '../helpers/harness.js';

let app;
let admin;

before(async () => {
  await resetDatabase();
  app = await startTestServer();
});

after(async () => {
  await app.close();
  await closeDatabase();
});

beforeEach(async () => {
  admin = await createSuperAdmin(app);
});

describe('Sales reps and commissions', () => {
  it('creates a sales rep with a unique referral code and link', async () => {
    const response = await app.post(
      '/api/admin/sales-reps',
      { name: 'Ana Comercial', phone: '+34600111001', email: 'ana.rep@example.com' },
      { token: admin.token },
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.sales_rep.name, 'Ana Comercial');
    assert.match(response.body.sales_rep.referral_code, /^COM-/);
    assert.match(response.body.sales_rep.referral_link, /register\?ref=COM-/);
    assert.equal(response.body.sales_rep.total_commissions, 0);
  });

  it('lists sales rep options for shop assignment', async () => {
    await app.post('/api/admin/sales-reps', { name: 'Luis Afiliado' }, { token: admin.token });
    const response = await app.get('/api/admin/sales-reps/options', { token: admin.token });
    assert.equal(response.status, 200);
    assert.ok(response.body.options.some((row) => row.name === 'Luis Afiliado'));
  });

  it('assigns a sales rep to a shop and creates a pending €50 commission when first payment is paid', async () => {
    const rep = await app.post(
      '/api/admin/sales-reps',
      { name: 'Marta Venta' },
      { token: admin.token },
    );
    assert.equal(rep.status, 201);
    const repId = rep.body.sales_rep.id;

    const owner = await createOwner(app, { shop_name: 'Taller Comisión' });
    const shopId = owner.shop.id;

    const updated = await app.patch(
      `/api/shops/${shopId}`,
      { sales_rep_id: repId, first_payment_paid: true },
      { token: admin.token },
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.shop.sales_rep_id, repId);
    assert.equal(updated.body.shop.first_payment_paid, true);
    assert.equal(updated.body.shop.sales_rep.name, 'Marta Venta');

    const commissions = await app.get('/api/admin/commissions?status=pending', { token: admin.token });
    assert.equal(commissions.status, 200);
    const mine = commissions.body.commissions.find((row) => row.shop_id === shopId);
    assert.ok(mine);
    assert.equal(mine.amount, 50);
    assert.equal(mine.status, 'pending');
    assert.equal(mine.sales_rep_id, repId);

    const paid = await app.post(`/api/admin/commissions/${mine.id}/pay`, {}, { token: admin.token });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.commission.status, 'paid');

    const refreshed = await queryOne('SELECT total_commissions FROM sales_reps WHERE id = $1', [repId]);
    assert.equal(Number(refreshed.total_commissions), 50);
  });

  it('keeps shop owners away from sales-rep admin APIs', async () => {
    const owner = await createOwner(app, { shop_name: 'Sin acceso comercial' });
    const response = await app.get('/api/admin/sales-reps', { token: owner.token });
    assert.equal(response.status, 403);
  });

  it('passes sales_rep_id when creating a shop via adminCreateUser', async () => {
    const rep = await app.post('/api/admin/sales-reps', { name: 'Onboarding Rep' }, { token: admin.token });
    const repId = rep.body.sales_rep.id;
    const suffix = String(Date.now()).slice(-6);

    const created = await app.post(
      '/api/admin/users',
      {
        email: `owner.rep.${suffix}@example.com`,
        password: 'OwnerPass12',
        full_name: 'Dueño Referido',
        phone: `+34611${suffix}`,
        shop_name: `Taller Ref ${suffix}`,
        create_shop: true,
        sales_rep_id: repId,
      },
      { token: admin.token },
    );
    assert.equal(created.status, 201);
    const shop = await queryOne('SELECT sales_rep_id FROM shops WHERE id = $1', [created.body.shop.id]);
    assert.equal(shop.sales_rep_id, repId);
  });
});
