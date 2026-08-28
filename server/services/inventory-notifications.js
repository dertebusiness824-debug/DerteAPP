/**
 * Delivery of the two inventory reminders.
 *
 * A reminder lands in three places at once, so it reaches the owner whichever
 * way they use the app:
 *   1. a `notifications` row  → the in-app list
 *   2. a Web Push message     → the phone, even with the PWA closed
 *   3. `shop_inventory_state` → bookkeeping, so it is never sent twice
 *
 * Everything is per shop and decided in the shop's own timezone. The owner's
 * `reminders_enabled = false` switch suppresses all of it.
 */
import { queryAll, queryOne, query } from '../db/index.js';
import {
  dueReminders,
  isReminderFriday,
  MONTHLY_REMINDER_DAY,
  shopCalendar,
} from '../lib/inventory-reminders.js';
import { notifyShopPush } from './web-push.js';

export const INVENTORY_REMINDER_LINK = '/inventario';

export const REMINDER_COPY = {
  fortnightly: {
    type: 'inventory.reminder.biweekly',
    title: 'Toca revisar el inventario',
    body: 'Repasa neumáticos, aceites y recambios y actualiza las cantidades que hayan cambiado.',
  },
  monthly: {
    type: 'inventory.reminder.monthly',
    title: 'Inventario sin actualizar',
    body: 'Recuerda que este mes no has actualizado tu inventario.',
  },
};

/** Owners and staff of a shop — everyone who can act on the reminder. */
const shopRecipients = (shopId) =>
  queryAll(`SELECT user_id FROM shop_members WHERE shop_id = $1`, [shopId]);

async function insertNotifications({ shopId, kind }) {
  const copy = REMINDER_COPY[kind];
  const members = await shopRecipients(shopId);
  if (!members.length) return 0;

  const { rowCount } = await query(
    `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
     SELECT unnest($1::uuid[]), $2, $3, $4, $5, $6`,
    [
      members.map((member) => member.user_id),
      shopId,
      copy.type,
      copy.title,
      copy.body,
      INVENTORY_REMINDER_LINK,
    ],
  );
  return rowCount;
}

/**
 * How many movements the shop logged in the current month, in its own timezone.
 * This is what makes "you have not updated your inventory" a fact.
 */
async function changesThisMonth(shopId, timeZone) {
  const row = await queryOne(
    `SELECT count(*)::int AS total
       FROM inventory_movements
      WHERE shop_id = $1
        AND date_trunc('month', created_at AT TIME ZONE $2)
            = date_trunc('month', now() AT TIME ZONE $2)`,
    [shopId, timeZone],
  );
  return row?.total ?? 0;
}

/**
 * What the owner's screens should show right now, without sending anything.
 * The in-app banner reads this, so it appears even if push is not granted.
 */
export async function pendingReminders({ shopId, timeZone = 'Europe/Madrid', now = new Date() }) {
  const state = await queryOne(`SELECT * FROM shop_inventory_state WHERE shop_id = $1`, [shopId]);
  const changes = await changesThisMonth(shopId, timeZone);
  const { today, day_of_month: dayOfMonth, month_key: monthKey } = shopCalendar(now, timeZone);
  const enabled = state ? state.reminders_enabled !== false : true;

  return {
    reminders_enabled: enabled,
    // The banner is a status, not an alert: unlike the push it ignores the
    // "already sent this month" bookkeeping and stays up while the month is
    // still empty, so a dismissed notification does not hide the fact.
    monthly_due: enabled && changes === 0 && dayOfMonth >= MONTHLY_REMINDER_DAY,
    fortnightly_due: enabled && isReminderFriday(today),
    changes_this_month: changes,
    last_change_at: state?.last_change_at ?? null,
    today,
    month_key: monthKey,
  };
}

/** Sends whatever one shop is owed and records it. Never throws. */
export async function runShopReminders({ shopId, timeZone = 'Europe/Madrid', now = new Date() }) {
  const state = await queryOne(`SELECT * FROM shop_inventory_state WHERE shop_id = $1`, [shopId]);
  const changes = await changesThisMonth(shopId, timeZone);
  const due = dueReminders({ now, timeZone, state, changesThisMonth: changes });

  const sent = [];

  if (due.fortnightly) {
    await insertNotifications({ shopId, kind: 'fortnightly' });
    await notifyShopPush(shopId, {
      title: REMINDER_COPY.fortnightly.title,
      body: REMINDER_COPY.fortnightly.body,
      url: INVENTORY_REMINDER_LINK,
      tag: 'inventory-biweekly',
    }).catch((error) => console.warn(`[inventory] push failed: ${error.message}`));
    await query(
      `INSERT INTO shop_inventory_state (shop_id, last_biweekly_notified_on)
       VALUES ($1, $2::date)
       ON CONFLICT (shop_id) DO UPDATE
          SET last_biweekly_notified_on = $2::date, updated_at = now()`,
      [shopId, due.today],
    );
    sent.push('fortnightly');
  }

  if (due.monthly) {
    await insertNotifications({ shopId, kind: 'monthly' });
    await notifyShopPush(shopId, {
      title: REMINDER_COPY.monthly.title,
      body: REMINDER_COPY.monthly.body,
      url: INVENTORY_REMINDER_LINK,
      tag: 'inventory-monthly',
    }).catch((error) => console.warn(`[inventory] push failed: ${error.message}`));
    await query(
      `INSERT INTO shop_inventory_state (shop_id, last_monthly_notified_month)
       VALUES ($1, $2)
       ON CONFLICT (shop_id) DO UPDATE
          SET last_monthly_notified_month = $2, updated_at = now()`,
      [shopId, due.month_key],
    );
    sent.push('monthly');
  }

  return { shop_id: shopId, sent, reason: due.reason ?? null };
}

/** Sweeps every active shop. Called by the maintenance loop. */
export async function runInventoryReminders({ now = new Date() } = {}) {
  const shops = await queryAll(
    `SELECT s.id, s.timezone
       FROM shops s
       LEFT JOIN shop_inventory_state st ON st.shop_id = s.id
      WHERE s.status = 'active'
        AND coalesce(st.reminders_enabled, true) = true`,
  );

  let notified = 0;
  for (const shop of shops) {
    try {
      const result = await runShopReminders({
        shopId: shop.id,
        timeZone: shop.timezone || 'Europe/Madrid',
        now,
      });
      if (result.sent.length) notified += 1;
    } catch (error) {
      console.error(`[inventory] reminder failed for shop ${shop.id}: ${error.message}`);
    }
  }

  return { shops: shops.length, notified };
}
