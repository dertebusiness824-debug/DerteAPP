import config from '../config.js';
import { query, queryAll, queryOne } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { formatPhone, requirePhone } from '../lib/phone.js';
import { randomToken } from '../lib/ids.js';

const COMMISSION_AMOUNT = 50;
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';

export function referralCode() {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `COM-${suffix}`;
}

export function referralLink(code) {
  return `${config.appUrl.replace(/\/$/, '')}/register?ref=${encodeURIComponent(code)}`;
}

export function serializeSalesRep(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? null,
    phone_display: row.phone ? formatPhone(row.phone) : null,
    email: row.email ?? null,
    referral_code: row.referral_code,
    referral_link: referralLink(row.referral_code),
    total_commissions: Number(row.total_commissions ?? 0),
    status: row.status,
    notes: row.notes ?? null,
    pending_commissions: row.pending_commissions != null ? Number(row.pending_commissions) : undefined,
    shop_count: row.shop_count != null ? Number(row.shop_count) : undefined,
    created_at: row.created_at,
  };
}

export function serializeCommission(row) {
  return {
    id: row.id,
    sales_rep_id: row.sales_rep_id,
    sales_rep_name: row.sales_rep_name ?? null,
    shop_id: row.shop_id,
    shop_name: row.shop_name ?? null,
    amount: Number(row.amount ?? COMMISSION_AMOUNT),
    currency: row.currency ?? 'EUR',
    kind: row.kind,
    status: row.status,
    earned_at: row.earned_at,
    paid_at: row.paid_at ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
  };
}

async function uniqueReferralCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = referralCode();
    const existing = await queryOne('SELECT 1 FROM sales_reps WHERE referral_code = $1', [code]);
    if (!existing) return code;
  }
  return `COM-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`;
}

export async function listSalesReps({ status = null } = {}) {
  const rows = await queryAll(
    `SELECT r.*,
            (SELECT count(*)::int FROM shops s WHERE s.sales_rep_id = r.id) AS shop_count,
            (SELECT count(*)::int FROM sales_rep_commissions c
              WHERE c.sales_rep_id = r.id AND c.status = 'pending') AS pending_commissions
       FROM sales_reps r
      WHERE ($1::text IS NULL OR r.status = $1)
      ORDER BY r.name`,
    [status],
  );
  return rows.map(serializeSalesRep);
}

export async function getSalesRep(id) {
  const row = await queryOne(
    `SELECT r.*,
            (SELECT count(*)::int FROM shops s WHERE s.sales_rep_id = r.id) AS shop_count,
            (SELECT count(*)::int FROM sales_rep_commissions c
              WHERE c.sales_rep_id = r.id AND c.status = 'pending') AS pending_commissions
       FROM sales_reps r WHERE r.id = $1`,
    [id],
  );
  return row ? serializeSalesRep(row) : null;
}

export async function createSalesRep({ name, phone = null, email = null, notes = null }) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 2) throw badRequest('El nombre del comercial es obligatorio');

  let normalizedPhone = null;
  if (phone) normalizedPhone = requirePhone(phone, 'phone');

  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw badRequest('Introduce un correo electrónico válido');
  }

  const code = await uniqueReferralCode();
  const row = await queryOne(
    `INSERT INTO sales_reps (name, phone, email, referral_code, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [trimmed, normalizedPhone, normalizedEmail, code, notes ?? null],
  );
  return serializeSalesRep(row);
}

export async function updateSalesRep(id, patch = {}) {
  const current = await queryOne('SELECT * FROM sales_reps WHERE id = $1', [id]);
  if (!current) throw notFound('Comercial no encontrado');

  const fields = [];
  const values = [id];

  if (patch.name !== undefined) {
    const trimmed = String(patch.name ?? '').trim();
    if (trimmed.length < 2) throw badRequest('El nombre del comercial es obligatorio');
    values.push(trimmed);
    fields.push(`name = $${values.length}`);
  }
  if (patch.phone !== undefined) {
    values.push(patch.phone ? requirePhone(patch.phone, 'phone') : null);
    fields.push(`phone = $${values.length}`);
  }
  if (patch.email !== undefined) {
    const email = patch.email ? String(patch.email).trim().toLowerCase() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw badRequest('Introduce un correo electrónico válido');
    }
    values.push(email);
    fields.push(`email = $${values.length}`);
  }
  if (patch.status !== undefined) {
    if (!['active', 'suspended', 'archived'].includes(patch.status)) {
      throw badRequest('Estado de comercial no válido');
    }
    values.push(patch.status);
    fields.push(`status = $${values.length}`);
  }
  if (patch.notes !== undefined) {
    values.push(patch.notes || null);
    fields.push(`notes = $${values.length}`);
  }

  if (fields.length === 0) return serializeSalesRep(current);

  fields.push('updated_at = now()');
  const row = await queryOne(
    `UPDATE sales_reps SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values,
  );
  return getSalesRep(row.id);
}

/**
 * Creates a pending €50 commission when the shop has a sales rep and first payment.
 * Idempotent via UNIQUE (shop_id, kind).
 */
export async function ensureFirstPaymentCommission(shop) {
  if (!shop?.sales_rep_id || !shop?.first_payment_at) {
    return { created: false, reason: 'not_eligible' };
  }

  const existing = await queryOne(
    `SELECT * FROM sales_rep_commissions WHERE shop_id = $1 AND kind = 'first_payment'`,
    [shop.id],
  );
  if (existing) return { created: false, reason: 'exists', commission: serializeCommission(existing) };

  const row = await queryOne(
    `INSERT INTO sales_rep_commissions (sales_rep_id, shop_id, amount, earned_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (shop_id, kind) DO NOTHING
     RETURNING *`,
    [shop.sales_rep_id, shop.id, COMMISSION_AMOUNT, shop.first_payment_at],
  );

  if (!row) {
    const again = await queryOne(
      `SELECT * FROM sales_rep_commissions WHERE shop_id = $1 AND kind = 'first_payment'`,
      [shop.id],
    );
    return { created: false, reason: 'race', commission: again ? serializeCommission(again) : null };
  }

  console.log('[sales-reps] commission created', {
    shopId: shop.id,
    salesRepId: shop.sales_rep_id,
    amount: COMMISSION_AMOUNT,
  });
  return { created: true, commission: serializeCommission(row) };
}

export async function assignShopSalesRep(shopId, salesRepId) {
  if (salesRepId) {
    const rep = await queryOne(`SELECT id FROM sales_reps WHERE id = $1 AND status = 'active'`, [salesRepId]);
    if (!rep) throw badRequest('Comercial no encontrado o inactivo', { code: 'sales_rep_invalid' });
  }

  const shop = await queryOne(
    `UPDATE shops SET sales_rep_id = $2 WHERE id = $1 RETURNING *`,
    [shopId, salesRepId || null],
  );
  if (!shop) throw notFound('Taller no encontrado');

  await ensureFirstPaymentCommission(shop);
  return shop;
}

export async function setShopFirstPayment(shopId, { paid = true } = {}) {
  const shop = await queryOne(
    `UPDATE shops
        SET first_payment_at = CASE WHEN $2::bool THEN COALESCE(first_payment_at, now()) ELSE NULL END
      WHERE id = $1
      RETURNING *`,
    [shopId, paid],
  );
  if (!shop) throw notFound('Taller no encontrado');

  if (paid) {
    await ensureFirstPaymentCommission(shop);
  } else {
    await query(
      `DELETE FROM sales_rep_commissions
        WHERE shop_id = $1 AND kind = 'first_payment' AND status = 'pending'`,
      [shopId],
    );
  }
  return shop;
}

export async function listCommissions({ status = 'pending', salesRepId = null } = {}) {
  const rows = await queryAll(
    `SELECT c.*, r.name AS sales_rep_name, s.name AS shop_name
       FROM sales_rep_commissions c
       JOIN sales_reps r ON r.id = c.sales_rep_id
       JOIN shops s ON s.id = c.shop_id
      WHERE ($1::text IS NULL OR c.status = $1)
        AND ($2::uuid IS NULL OR c.sales_rep_id = $2)
      ORDER BY
        CASE c.status WHEN 'pending' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END,
        c.earned_at DESC`,
    [status, salesRepId],
  );
  return rows.map(serializeCommission);
}

export async function markCommissionPaid(commissionId, { actorUserId = null } = {}) {
  const current = await queryOne('SELECT * FROM sales_rep_commissions WHERE id = $1', [commissionId]);
  if (!current) throw notFound('Comisión no encontrada');
  if (current.status === 'paid') {
    return serializeCommission({
      ...current,
      sales_rep_name: (await queryOne('SELECT name FROM sales_reps WHERE id = $1', [current.sales_rep_id]))?.name,
      shop_name: (await queryOne('SELECT name FROM shops WHERE id = $1', [current.shop_id]))?.name,
    });
  }
  if (current.status !== 'pending') {
    throw conflict('Solo se pueden marcar como pagadas las comisiones pendientes', {
      code: 'commission_not_pending',
    });
  }

  const row = await queryOne(
    `UPDATE sales_rep_commissions
        SET status = 'paid', paid_at = now(), paid_by = $2
      WHERE id = $1
      RETURNING *`,
    [commissionId, actorUserId],
  );

  await query(
    `UPDATE sales_reps
        SET total_commissions = total_commissions + $2,
            updated_at = now()
      WHERE id = $1`,
    [row.sales_rep_id, row.amount],
  );

  const enriched = await queryOne(
    `SELECT c.*, r.name AS sales_rep_name, s.name AS shop_name
       FROM sales_rep_commissions c
       JOIN sales_reps r ON r.id = c.sales_rep_id
       JOIN shops s ON s.id = c.shop_id
      WHERE c.id = $1`,
    [row.id],
  );
  return serializeCommission(enriched);
}

export async function loadSalesRepOptions() {
  return queryAll(
    `SELECT id, name, referral_code
       FROM sales_reps
      WHERE status = 'active'
      ORDER BY name`,
  );
}

export { COMMISSION_AMOUNT };
