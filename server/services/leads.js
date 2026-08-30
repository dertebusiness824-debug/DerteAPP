/**
 * Super Admin CLIENTES: platform sales leads from the Retell receptionist.
 */
import { queryAll, queryOne } from '../db/index.js';
import { channels, hub } from '../lib/events.js';
import { formatPhone, telLink, whatsappLink } from '../lib/phone.js';

const FOLLOW_UP_MINUTES = 40;
const FOLLOW_UP_SOON_MINUTES = 20;

function followUpState(calledAt) {
  if (!calledAt) return { minutes_since_call: null, follow_up_state: 'ok', follow_up_minutes: FOLLOW_UP_MINUTES };
  const then = new Date(calledAt).getTime();
  if (Number.isNaN(then)) {
    return { minutes_since_call: null, follow_up_state: 'ok', follow_up_minutes: FOLLOW_UP_MINUTES };
  }
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  let state = 'ok';
  if (minutes >= FOLLOW_UP_MINUTES) state = 'overdue';
  else if (minutes >= FOLLOW_UP_SOON_MINUTES) state = 'soon';
  return { minutes_since_call: minutes, follow_up_state: state, follow_up_minutes: FOLLOW_UP_MINUTES };
}

function publishLead(type, lead) {
  if (!lead) return;
  hub.publish(channels.admin(), { type, lead });
}

const externalRef = (callId) => (callId ? `retell:${callId}` : null);

export function serializeLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    customer_name: row.customer_name || null,
    shop_name: row.shop_name || null,
    island: row.island || null,
    customer_phone: row.customer_phone || null,
    customer_phone_display: row.customer_phone ? formatPhone(row.customer_phone) : null,
    customer_tel_link: telLink(row.customer_phone),
    customer_whatsapp_link: whatsappLink(row.customer_phone),
    customer_email: row.customer_email || null,
    summary: row.summary || null,
    notes: row.notes || null,
    status: row.status,
    called_at: row.called_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    can_contact: row.status === 'pending',
    can_close: row.status !== 'closed',
    ...followUpState(row.called_at || row.created_at),
  };
}

/**
 * Always INSERT. Same Retell call_id is ignored (no field update) so
 * call_ended + call_analyzed do not create two rows. Never looks up by phone.
 */
export async function insertPlatformLead({
  callId,
  customerName,
  shopName,
  island,
  customerPhone,
  customerEmail,
  summary,
  notes,
  calledAt,
} = {}) {
  const ref = externalRef(callId);
  if (!ref) return { lead: null, created: false };

  const row = await queryOne(
    `INSERT INTO platform_leads
       (external_ref, customer_name, shop_name, island, customer_phone, customer_email, summary, notes, status, called_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
     ON CONFLICT (external_ref) DO NOTHING
     RETURNING *`,
    [
      ref,
      customerName || null,
      shopName || null,
      island || null,
      customerPhone || null,
      customerEmail || null,
      summary || null,
      notes || null,
      calledAt || null,
    ],
  );
  if (row) {
    const created = serializeLead(row);
    publishLead('platform_lead_upserted', created);
    return { lead: created, created: true };
  }

  const existing = await queryOne('SELECT * FROM platform_leads WHERE external_ref = $1', [ref]);
  return { lead: serializeLead(existing), created: false };
}

export async function listPlatformLeads({ scope = 'active', limit = 80 } = {}) {
  const statuses = scope === 'history' ? ['contacted', 'closed'] : ['pending'];
  const rows = await queryAll(
    `SELECT * FROM platform_leads
      WHERE status = ANY($1::text[])
      ORDER BY COALESCE(called_at, created_at) DESC
      LIMIT $2`,
    [statuses, limit],
  );
  return rows.map(serializeLead);
}

export async function countPendingLeads() {
  const row = await queryOne(`SELECT count(*)::int AS n FROM platform_leads WHERE status = 'pending'`);
  return row?.n ?? 0;
}

export async function getPlatformLead(id) {
  const row = await queryOne('SELECT * FROM platform_leads WHERE id = $1', [id]);
  return serializeLead(row);
}

export async function setLeadStatus(id, status) {
  const row = await queryOne(
    `UPDATE platform_leads SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status],
  );
  const updated = serializeLead(row);
  publishLead('platform_lead_updated', updated);
  return updated;
}
