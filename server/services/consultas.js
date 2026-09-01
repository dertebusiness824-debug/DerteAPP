/**
 * Super Admin vehicle-API usage (Consultas) and the 31 Dec 18:00
 * peninsular annual close that writes shop history + user year summaries.
 */
import { query, queryAll, queryOne } from '../db/index.js';
import { utcFromZoned, zonedParts } from '../lib/time.js';
import { notifyUserPush } from './web-push.js';

export const PENINSULAR_TZ = 'Europe/Madrid';
export const THANK_YOU = 'Muchas gracias por hacernos parte de tu año';
export const YEAR_SUMMARY_TITLE = 'Consulta tu rendimiento anual';
export const YEAR_SUMMARY_TYPE = 'year_summary';

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function yearRange(year, timezone = PENINSULAR_TZ) {
  const start = utcFromZoned({ year, month: 1, day: 1, hour: 0, minute: 0 }, timezone);
  const end = utcFromZoned({ year: year + 1, month: 1, day: 1, hour: 0, minute: 0 }, timezone);
  return { start, end };
}

export function monthRange(year, month, timezone = PENINSULAR_TZ) {
  const start = utcFromZoned({ year, month, day: 1, hour: 0, minute: 0 }, timezone);
  const end =
    month === 12
      ? utcFromZoned({ year: year + 1, month: 1, day: 1, hour: 0, minute: 0 }, timezone)
      : utcFromZoned({ year, month: month + 1, day: 1, hour: 0, minute: 0 }, timezone);
  return { start, end };
}

/** True while the Madrid wall clock is 31 Dec 18:00–18:59. */
export function isAnnualCloseWindow(now = new Date(), timezone = PENINSULAR_TZ) {
  const parts = zonedParts(now, timezone);
  return parts.month === 12 && parts.day === 31 && parts.hour === 18;
}

/** Instant the annual close of `year` becomes due (31 Dec 18:00 peninsular). */
export function annualCloseAt(year, timezone = PENINSULAR_TZ) {
  return utcFromZoned({ year, month: 12, day: 31, hour: 18, minute: 0, second: 0 }, timezone);
}

/** Years whose 31 Dec 18:00 has already passed (current and previous). */
export function yearsDueForClose(now = new Date(), timezone = PENINSULAR_TZ) {
  const parts = zonedParts(now, timezone);
  const due = [];
  for (const year of [parts.year - 1, parts.year]) {
    if (now.getTime() >= annualCloseAt(year, timezone).getTime()) due.push(year);
  }
  return due;
}

function displayName(row) {
  return row.full_name || row.email || row.phone || 'Usuario';
}

export async function computeShopYearStats(shopId, year, timezone = PENINSULAR_TZ) {
  const { start, end } = yearRange(year, timezone);
  const from = start.toISOString();
  const to = end.toISOString();
  const [bookings, lookups, diagnostics] = await Promise.all([
    queryOne(
      `SELECT count(*) FILTER (WHERE status NOT IN ('cancelled', 'no_show'))::int AS scheduled,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM appointments
        WHERE shop_id = $1
          AND scheduled_at >= $2
          AND scheduled_at < $3`,
      [shopId, from, to],
    ),
    queryOne(
      `SELECT count(*)::int AS n
         FROM matriculas_lookups
        WHERE shop_id = $1
          AND created_at >= $2
          AND created_at < $3`,
      [shopId, from, to],
    ),
    queryOne(
      `SELECT count(*)::int AS n
         FROM diagnostic_queries
        WHERE shop_id = $1
          AND created_at >= $2
          AND created_at < $3`,
      [shopId, from, to],
    ),
  ]);
  return {
    shop_id: shopId,
    year,
    bookings_scheduled: bookings?.scheduled ?? 0,
    bookings_completed: bookings?.completed ?? 0,
    plate_lookups: lookups?.n ?? 0,
    diagnostic_queries: diagnostics?.n ?? 0,
  };
}

function groupLookupRows(rows) {
  const shops = new Map();
  const unassigned = [];
  let total = 0;
  for (const row of rows) {
    total += row.lookups;
    const entry = {
      user_id: row.user_id,
      user_name: row.user_name || 'Sin asignar',
      lookups: row.lookups,
    };
    if (!row.shop_id) {
      unassigned.push(entry);
      continue;
    }
    if (!shops.has(row.shop_id)) {
      shops.set(row.shop_id, {
        shop_id: row.shop_id,
        shop_name: row.shop_name || 'Taller',
        lookups: 0,
        users: [],
      });
    }
    const shop = shops.get(row.shop_id);
    shop.lookups += row.lookups;
    shop.users.push(entry);
  }
  return {
    shops: [...shops.values()].sort((a, b) => b.lookups - a.lookups || a.shop_name.localeCompare(b.shop_name)),
    unassigned,
    total_lookups: total,
  };
}

/** Official plate lookups in a calendar month (or the whole year if month is omitted). */
export async function listMonthlyLookups({ year, month = null, timezone = PENINSULAR_TZ } = {}) {
  const nowParts = zonedParts(new Date(), timezone);
  let targetYear = Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > nowParts.year + 1) {
    targetYear = nowParts.year;
  }
  const targetMonth = Number(month);
  const useMonth = Number.isInteger(targetMonth) && targetMonth >= 1 && targetMonth <= 12;
  const { start, end } = useMonth ? monthRange(targetYear, targetMonth, timezone) : yearRange(targetYear, timezone);

  const [rows, yearRows] = await Promise.all([
    queryAll(
      `SELECT l.shop_id,
              s.name AS shop_name,
              l.user_id,
              COALESCE(u.full_name, u.email, u.phone, 'Sin asignar') AS user_name,
              count(*)::int AS lookups
         FROM matriculas_lookups l
         LEFT JOIN shops s ON s.id = l.shop_id
         LEFT JOIN users u ON u.id = l.user_id
        WHERE l.created_at >= $1
          AND l.created_at < $2
        GROUP BY l.shop_id, s.name, l.user_id, u.full_name, u.email, u.phone
        ORDER BY lookups DESC, s.name, user_name`,
      [start.toISOString(), end.toISOString()],
    ),
    queryAll(
      `SELECT DISTINCT EXTRACT(YEAR FROM (created_at AT TIME ZONE $1))::int AS year
         FROM matriculas_lookups
        ORDER BY 1 DESC`,
      [timezone],
    ),
  ]);

  const availableYears = [...new Set([targetYear, nowParts.year, ...yearRows.map((row) => row.year)])]
    .filter((value) => Number.isInteger(value))
    .sort((a, b) => b - a);

  return {
    year: targetYear,
    month: useMonth ? targetMonth : null,
    month_label: useMonth ? MONTH_LABELS[targetMonth - 1] : 'Año',
    timezone,
    period: { start: start.toISOString(), end: end.toISOString() },
    available_years: availableYears,
    months: MONTH_LABELS.map((label, index) => ({ month: index + 1, label })),
    ...groupLookupRows(rows),
  };
}

/** Live (or closed) annual rollup per shop: lookups + bookings + diagnostics. */
export async function listAnnualShopHistory({ year, timezone = PENINSULAR_TZ } = {}) {
  const nowParts = zonedParts(new Date(), timezone);
  let targetYear = Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > nowParts.year + 1) {
    targetYear = nowParts.year;
  }
  const { start, end } = yearRange(targetYear, timezone);
  const from = start.toISOString();
  const to = end.toISOString();

  const [shops, closes] = await Promise.all([
    queryAll(
      `SELECT s.id AS shop_id, s.name AS shop_name, s.timezone,
              COALESCE(a.scheduled, 0)::int AS bookings_scheduled,
              COALESCE(a.completed, 0)::int AS bookings_completed,
              COALESCE(l.lookups, 0)::int AS plate_lookups,
              COALESCE(d.queries, 0)::int AS diagnostic_queries
         FROM shops s
         LEFT JOIN (
           SELECT shop_id,
                  count(*) FILTER (WHERE status NOT IN ('cancelled', 'no_show'))::int AS scheduled,
                  count(*) FILTER (WHERE status = 'completed')::int AS completed
             FROM appointments
            WHERE scheduled_at >= $1 AND scheduled_at < $2
            GROUP BY shop_id
         ) a ON a.shop_id = s.id
         LEFT JOIN (
           SELECT shop_id, count(*)::int AS lookups
             FROM matriculas_lookups
            WHERE created_at >= $1 AND created_at < $2
            GROUP BY shop_id
         ) l ON l.shop_id = s.id
         LEFT JOIN (
           SELECT shop_id, count(*)::int AS queries
             FROM diagnostic_queries
            WHERE created_at >= $1 AND created_at < $2
            GROUP BY shop_id
         ) d ON d.shop_id = s.id
        WHERE s.status <> 'archived'
        ORDER BY plate_lookups DESC, s.name`,
      [from, to],
    ),
    queryAll(
      `SELECT shop_id, year, bookings_scheduled, bookings_completed,
              plate_lookups, diagnostic_queries, closed_at
         FROM shop_year_closes
        WHERE year = $1`,
      [targetYear],
    ),
  ]);

  const closed = new Map(closes.map((row) => [row.shop_id, row]));
  return {
    year: targetYear,
    timezone,
    shops: shops.map((shop) => {
      const snap = closed.get(shop.shop_id);
      if (!snap) {
        return { ...shop, closed: false, closed_at: null };
      }
      return {
        shop_id: shop.shop_id,
        shop_name: shop.shop_name,
        timezone: shop.timezone,
        bookings_scheduled: snap.bookings_scheduled,
        bookings_completed: snap.bookings_completed,
        plate_lookups: snap.plate_lookups,
        diagnostic_queries: snap.diagnostic_queries,
        closed: true,
        closed_at: snap.closed_at,
      };
    }),
  };
}

export async function getUserYearSummary({ userId, year } = {}) {
  const nowParts = zonedParts(new Date(), PENINSULAR_TZ);
  let targetYear = Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > nowParts.year + 1) {
    targetYear = nowParts.year;
  }

  const stored = await queryOne(
    `SELECT id, user_id, year, message, payload, notified_at, created_at
       FROM user_year_summaries
      WHERE user_id = $1 AND year = $2`,
    [userId, targetYear],
  );
  if (stored) {
    return {
      year: stored.year,
      message: stored.message,
      notified_at: stored.notified_at,
      closed: true,
      ...stored.payload,
    };
  }

  const memberships = await queryAll(
    `SELECT s.id AS shop_id, s.name AS shop_name, s.timezone
       FROM shop_members m
       JOIN shops s ON s.id = m.shop_id
      WHERE m.user_id = $1
        AND s.status <> 'archived'
      ORDER BY m.is_primary DESC, s.name`,
    [userId],
  );

  const shops = [];
  for (const shop of memberships) {
    const stats = await computeShopYearStats(shop.shop_id, targetYear, shop.timezone || PENINSULAR_TZ);
    shops.push({
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      ...stats,
    });
  }

  const totals = shops.reduce(
    (acc, shop) => ({
      bookings_scheduled: acc.bookings_scheduled + shop.bookings_scheduled,
      bookings_completed: acc.bookings_completed + shop.bookings_completed,
      plate_lookups: acc.plate_lookups + shop.plate_lookups,
      diagnostic_queries: acc.diagnostic_queries + shop.diagnostic_queries,
    }),
    { bookings_scheduled: 0, bookings_completed: 0, plate_lookups: 0, diagnostic_queries: 0 },
  );

  return {
    year: targetYear,
    message: THANK_YOU,
    notified_at: null,
    closed: false,
    shops,
    totals,
  };
}

async function notifyYearSummary(userId, year, shopId = null) {
  const link = `/rendimiento?year=${year}`;
  await query(
    `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
     SELECT $1, $2, $3, $4, $5, $6
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications
         WHERE user_id = $1 AND type = $3 AND link = $6
      )`,
    [userId, shopId, YEAR_SUMMARY_TYPE, YEAR_SUMMARY_TITLE, THANK_YOU, link],
  );
  await notifyUserPush(userId, {
    title: YEAR_SUMMARY_TITLE,
    body: THANK_YOU,
    url: link,
    tag: `year-summary-${year}`,
  });
}

/**
 * Consolidates one calendar year: shop snapshots, per-user summaries,
 * in-app notification and Web Push. Idempotent per year.
 */
export async function closeAnnualYear({ year, now = new Date(), force = false } = {}) {
  const targetYear = Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2100) {
    return { ran: false, reason: 'invalid_year' };
  }
  if (!force && now.getTime() < annualCloseAt(targetYear).getTime()) {
    return { ran: false, reason: 'too_early', year: targetYear };
  }

  const claimed = await queryOne(
    `INSERT INTO annual_close_runs (year)
     VALUES ($1)
     ON CONFLICT (year) DO NOTHING
     RETURNING year`,
    [targetYear],
  );
  if (!claimed) {
    return { ran: false, reason: 'already_closed', year: targetYear };
  }

  const yearEnd = yearRange(targetYear).end;
  const shops = await queryAll(
    `SELECT id, name, timezone
       FROM shops
      WHERE status <> 'archived'
        AND created_at < $1
      ORDER BY name`,
    [yearEnd.toISOString()],
  );

  const shopStats = [];
  for (const shop of shops) {
    const stats = await computeShopYearStats(shop.id, targetYear, shop.timezone || PENINSULAR_TZ);
    await query(
      `INSERT INTO shop_year_closes
         (shop_id, year, bookings_scheduled, bookings_completed, plate_lookups, diagnostic_queries)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (shop_id, year) DO UPDATE
         SET bookings_scheduled = EXCLUDED.bookings_scheduled,
             bookings_completed = EXCLUDED.bookings_completed,
             plate_lookups = EXCLUDED.plate_lookups,
             diagnostic_queries = EXCLUDED.diagnostic_queries,
             closed_at = now()`,
      [
        shop.id,
        targetYear,
        stats.bookings_scheduled,
        stats.bookings_completed,
        stats.plate_lookups,
        stats.diagnostic_queries,
      ],
    );
    shopStats.push({ ...stats, shop_name: shop.name });
  }

  const members = await queryAll(
    `SELECT m.user_id, m.shop_id, m.is_primary, u.full_name, u.email, u.phone, u.role
       FROM shop_members m
       JOIN users u ON u.id = m.user_id
       JOIN shops s ON s.id = m.shop_id
      WHERE u.status = 'active'
        AND s.status <> 'archived'
        AND s.created_at < $1
        AND u.role <> 'super_admin'`,
    [yearEnd.toISOString()],
  );

  const byUser = new Map();
  for (const member of members) {
    if (!byUser.has(member.user_id)) {
      byUser.set(member.user_id, {
        user_id: member.user_id,
        name: displayName(member),
        shops: [],
        primary_shop_id: member.is_primary ? member.shop_id : null,
      });
    }
    const bucket = byUser.get(member.user_id);
    const stats = shopStats.find((row) => row.shop_id === member.shop_id);
    if (stats) bucket.shops.push(stats);
    if (member.is_primary) bucket.primary_shop_id = member.shop_id;
  }

  let usersNotified = 0;
  for (const user of byUser.values()) {
    const totals = user.shops.reduce(
      (acc, shop) => ({
        bookings_scheduled: acc.bookings_scheduled + shop.bookings_scheduled,
        bookings_completed: acc.bookings_completed + shop.bookings_completed,
        plate_lookups: acc.plate_lookups + shop.plate_lookups,
        diagnostic_queries: acc.diagnostic_queries + shop.diagnostic_queries,
      }),
      { bookings_scheduled: 0, bookings_completed: 0, plate_lookups: 0, diagnostic_queries: 0 },
    );
    const payload = { shops: user.shops, totals };
    await query(
      `INSERT INTO user_year_summaries (user_id, year, message, payload, notified_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (user_id, year) DO UPDATE
         SET payload = EXCLUDED.payload,
             message = EXCLUDED.message,
             notified_at = COALESCE(user_year_summaries.notified_at, now())`,
      [user.user_id, targetYear, THANK_YOU, JSON.stringify(payload)],
    );
    await notifyYearSummary(user.user_id, targetYear, user.primary_shop_id);
    usersNotified += 1;
  }

  await query(
    `UPDATE annual_close_runs
        SET finished_at = now(),
            shops_closed = $2,
            users_notified = $3
      WHERE year = $1`,
    [targetYear, shopStats.length, usersNotified],
  );

  return {
    ran: true,
    year: targetYear,
    shops_closed: shopStats.length,
    users_notified: usersNotified,
  };
}

export async function maybeRunAnnualClose({ now = new Date(), force = false } = {}) {
  const years = force
    ? [zonedParts(now, PENINSULAR_TZ).year]
    : yearsDueForClose(now);
  const results = [];
  for (const year of years) {
    results.push(await closeAnnualYear({ year, now, force }));
  }
  return { years, results };
}

export async function resetAnnualCloseForTests(year) {
  if (!year) return;
  await query(`DELETE FROM annual_close_runs WHERE year = $1`, [year]);
  await query(`DELETE FROM shop_year_closes WHERE year = $1`, [year]);
  await query(`DELETE FROM user_year_summaries WHERE year = $1`, [year]);
  await query(`DELETE FROM notifications WHERE type = $1 AND link = $2`, [
    YEAR_SUMMARY_TYPE,
    `/rendimiento?year=${year}`,
  ]);
}
