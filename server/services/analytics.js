import { queryAll, queryOne } from '../db/index.js';
import { deviceFromUserAgent } from '../middleware/context.js';
import { formatPhone } from '../lib/phone.js';
import { utcFromZoned, zonedParts } from '../lib/time.js';

const clampDays = (days) => Math.min(Math.max(Number(days) || 30, 1), 365);

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Annual booking history for the shop dashboard (count + monthly breakdown). */
export async function shopYearlyHistory({ shopId, year, timezone = 'UTC' } = {}) {
  const nowParts = zonedParts(new Date(), timezone);
  const currentYear = nowParts.year;
  let targetYear = Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > currentYear + 1) {
    targetYear = currentYear;
  }

  const yearStart = utcFromZoned({ year: targetYear, month: 1, day: 1, hour: 0, minute: 0 }, timezone);
  const yearEnd = utcFromZoned({ year: targetYear + 1, month: 1, day: 1, hour: 0, minute: 0 }, timezone);

  const [summary, monthlyRows, yearRows] = await Promise.all([
    queryOne(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status IN ('pending', 'accepted', 'confirmed'))::int AS pending,
              count(*) FILTER (WHERE status IN ('accepted', 'confirmed'))::int AS accepted,
              count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE status IN ('cancelled', 'no_show'))::int AS cancelled
         FROM appointments
        WHERE shop_id = $1
          AND scheduled_at >= $2
          AND scheduled_at < $3`,
      [shopId, yearStart.toISOString(), yearEnd.toISOString()],
    ),
    queryAll(
      `SELECT EXTRACT(MONTH FROM (scheduled_at AT TIME ZONE $4))::int AS month,
              count(*)::int AS count
         FROM appointments
        WHERE shop_id = $1
          AND scheduled_at >= $2
          AND scheduled_at < $3
          AND status NOT IN ('cancelled', 'no_show')
        GROUP BY 1
        ORDER BY 1`,
      [shopId, yearStart.toISOString(), yearEnd.toISOString(), timezone],
    ),
    queryAll(
      `SELECT DISTINCT EXTRACT(YEAR FROM (scheduled_at AT TIME ZONE $2))::int AS year
         FROM appointments
        WHERE shop_id = $1
        ORDER BY 1 DESC`,
      [shopId, timezone],
    ),
  ]);

  const byMonth = new Map(monthlyRows.map((row) => [row.month, row.count]));
  const months = MONTH_LABELS.map((label, index) => ({
    month: index + 1,
    label,
    count: byMonth.get(index + 1) ?? 0,
  }));

  const availableYears = yearRows.map((row) => row.year).filter((value) => Number.isInteger(value));
  if (!availableYears.includes(targetYear)) availableYears.unshift(targetYear);
  if (!availableYears.includes(currentYear)) availableYears.unshift(currentYear);
  const years = [...new Set(availableYears)].sort((a, b) => b - a);

  // `pending` already counts confirmed/accepted/pending rows — do not double-count.
  const confirmedCount = summary?.pending ?? 0;
  const activeTotal =
    confirmedCount + (summary?.in_progress ?? 0) + (summary?.completed ?? 0);

  return {
    year: targetYear,
    current_year: currentYear,
    timezone,
    total: activeTotal,
    total_including_cancelled: summary?.total ?? 0,
    breakdown: {
      confirmed: confirmedCount,
      pending: 0,
      accepted: confirmedCount,
      in_progress: summary?.in_progress ?? 0,
      completed: summary?.completed ?? 0,
      cancelled: summary?.cancelled ?? 0,
    },
    months,
    available_years: years,
  };
}

export function recordSiteEvent({ shopId, eventType, path, referrer, userAgent, sessionId, ipHash, metadata = {} }) {
  return queryOne(
    `INSERT INTO site_events (shop_id, event_type, path, referrer, user_agent, device, session_id, ip_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      shopId,
      eventType,
      path ? String(path).slice(0, 500) : null,
      referrer ? String(referrer).slice(0, 500) : null,
      userAgent ? String(userAgent).slice(0, 400) : null,
      deviceFromUserAgent(userAgent),
      sessionId ? String(sessionId).slice(0, 64) : null,
      ipHash ?? null,
      metadata,
    ],
  );
}

/** Everything the shop owner's Analytics tab needs, in one round of queries. */
export async function shopAnalytics({ shopId, days = 30 }) {
  const window = clampDays(days);
  const params = [shopId, String(window)];

  const [appointments, statusBreakdown, daily, traffic, trafficDaily, topServices, calls, chat] = await Promise.all([
    queryOne(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status IN ('pending', 'accepted', 'confirmed'))::int AS pending,
              count(*) FILTER (WHERE status IN ('accepted', 'confirmed'))::int   AS accepted,
              count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
              count(*) FILTER (WHERE status = 'completed')::int  AS completed,
              count(*) FILTER (WHERE status = 'cancelled')::int  AS cancelled,
              count(*) FILTER (WHERE status = 'no_show')::int    AS no_show,
              COALESCE(sum(price_estimate) FILTER (WHERE status = 'completed'), 0) AS completed_value,
              COALESCE(round(avg(EXTRACT(EPOCH FROM (accepted_at - created_at)) / 60)
                       FILTER (WHERE accepted_at IS NOT NULL)), 0)::int AS avg_response_minutes
         FROM appointments
        WHERE shop_id = $1 AND created_at > now() - ($2 || ' days')::interval`,
      params,
    ),
    queryAll(
      `SELECT source, count(*)::int AS count
         FROM appointments
        WHERE shop_id = $1 AND created_at > now() - ($2 || ' days')::interval
        GROUP BY source ORDER BY count DESC`,
      params,
    ),
    queryAll(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              count(*)::int AS bookings,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM appointments
        WHERE shop_id = $1 AND created_at > now() - ($2 || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    queryOne(
      `SELECT count(*) FILTER (WHERE event_type = 'pageview')::int      AS pageviews,
              count(DISTINCT session_id) FILTER (WHERE event_type = 'pageview')::int AS visitors,
              count(*) FILTER (WHERE event_type = 'form_view')::int     AS form_views,
              count(*) FILTER (WHERE event_type = 'form_submit')::int   AS form_submits,
              count(*) FILTER (WHERE event_type = 'call_click')::int    AS call_clicks,
              count(*) FILTER (WHERE event_type = 'whatsapp_click')::int AS whatsapp_clicks,
              count(*) FILTER (WHERE event_type = 'schedule_check')::int AS schedule_checks,
              count(*) FILTER (WHERE device = 'mobile')::int            AS mobile_hits,
              count(*) FILTER (WHERE device = 'desktop')::int           AS desktop_hits
         FROM site_events
        WHERE shop_id = $1 AND created_at > now() - ($2 || ' days')::interval`,
      params,
    ),
    queryAll(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              count(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews,
              count(DISTINCT session_id) FILTER (WHERE event_type = 'pageview')::int AS visitors
         FROM site_events
        WHERE shop_id = $1 AND created_at > now() - ($2 || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    queryAll(
      `SELECT COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service, count(*)::int AS count
         FROM appointments
        WHERE shop_id = $1 AND created_at > now() - ($2 || ' days')::interval
        GROUP BY 1 ORDER BY count DESC LIMIT 8`,
      params,
    ),
    queryOne(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE direction = 'in')::int  AS inbound,
              count(*) FILTER (WHERE direction = 'out')::int AS outbound,
              count(*) FILTER (WHERE status IN ('no_answer', 'busy', 'failed'))::int AS missed,
              COALESCE(sum(duration_seconds), 0)::int AS total_seconds
         FROM call_logs
        WHERE shop_id = $1 AND started_at > now() - ($2 || ' days')::interval`,
      params,
    ),
    queryOne(
      `SELECT count(DISTINCT t.id)::int AS threads,
              count(m.id)::int         AS messages,
              count(m.id) FILTER (WHERE m.sender_type = 'shop')::int AS from_shop
         FROM chat_threads t
         LEFT JOIN chat_messages m
           ON m.thread_id = t.id AND m.created_at > now() - ($2 || ' days')::interval
        WHERE t.shop_id = $1`,
      params,
    ),
  ]);

  const conversion = traffic.form_views > 0 ? Number(((traffic.form_submits / traffic.form_views) * 100).toFixed(1)) : 0;

  return {
    window_days: window,
    appointments,
    sources: statusBreakdown,
    daily,
    traffic: { ...traffic, form_conversion_rate: conversion },
    traffic_daily: trafficDaily,
    top_services: topServices,
    calls,
    chat,
  };
}

/** Today's numbers for the shop owner's home screen. */
export function shopToday({ shopId, dayStart, dayEnd }) {
  return queryOne(
    `SELECT
       (SELECT count(*)::int FROM appointments
         WHERE shop_id = $1 AND scheduled_at >= $2 AND scheduled_at < $3
           AND status IN ('confirmed', 'completed', 'in_progress'))               AS today_total,
       (SELECT count(*)::int FROM appointments
         WHERE shop_id = $1 AND scheduled_at >= $2 AND scheduled_at < $3
           AND status = 'confirmed')                                              AS confirmed_today,
       (SELECT count(*)::int FROM appointments
         WHERE shop_id = $1 AND scheduled_at >= $2 AND scheduled_at < $3
           AND status = 'completed')                                              AS completed_today,
       (SELECT count(*)::int FROM urgencias
         WHERE shop_id = $1 AND status = 'pending')                               AS pending_urgencias,
       (SELECT count(*)::int FROM appointments
         WHERE shop_id = $1 AND scheduled_at >= $2 AND scheduled_at < $3
           AND status IN ('pending', 'accepted', 'confirmed', 'in_progress'))     AS pending_bookings_today,
       (SELECT count(*)::int FROM appointments
         WHERE shop_id = $1 AND status = 'completed')                             AS completed_total,
       (SELECT count(*)::int FROM appointments
         WHERE shop_id = $1 AND status = 'in_progress')                           AS in_progress,
       (SELECT count(*)::int FROM appointments
         WHERE shop_id = $1 AND scheduled_at >= $3
           AND status IN ('confirmed', 'in_progress'))                            AS upcoming,
       (SELECT COALESCE(sum(unread_for_shop), 0)::int FROM chat_threads
         WHERE shop_id = $1)                                                      AS unread_messages,
       (SELECT count(*)::int FROM call_logs
         WHERE shop_id = $1 AND started_at >= $2 AND started_at < $3)             AS calls_today,
       (SELECT count(*)::int FROM call_logs
         WHERE shop_id = $1 AND started_at >= $2 AND started_at < $3
           AND status IN ('no_answer', 'busy', 'failed'))                         AS missed_calls_today,
       (SELECT count(*)::int FROM site_events
         WHERE shop_id = $1 AND created_at >= $2 AND created_at < $3
           AND event_type = 'pageview')                                           AS site_views_today`,
    [shopId, dayStart, dayEnd],
  );
}

/** Super Admin master dashboard: totals plus a per-tenant table. */
export async function globalOverview({ days = 30 } = {}) {
  const window = clampDays(days);
  const params = [String(window)];

  const [totals, perShop, timeline, alerts] = await Promise.all([
    queryOne(
      `SELECT
         (SELECT count(*)::int FROM shops WHERE status = 'active')                AS active_shops,
         (SELECT count(*)::int FROM shops WHERE status = 'suspended')             AS suspended_shops,
         (SELECT count(*)::int FROM users WHERE role = 'shop_owner')              AS shop_owners,
         (SELECT count(*)::int FROM appointments
           WHERE created_at > now() - ($1 || ' days')::interval)                  AS bookings,
         (SELECT count(*)::int FROM appointments
           WHERE status IN ('confirmed', 'accepted', 'pending'))                  AS pending_bookings,
         (SELECT count(*)::int FROM appointments
           WHERE status = 'completed' AND created_at > now() - ($1 || ' days')::interval) AS completed_bookings,
         (SELECT count(*)::int FROM call_logs
           WHERE started_at > now() - ($1 || ' days')::interval)                  AS calls,
         (SELECT count(*)::int FROM site_events
           WHERE event_type = 'pageview' AND created_at > now() - ($1 || ' days')::interval) AS pageviews,
         (SELECT count(DISTINCT session_id)::int FROM site_events
           WHERE event_type = 'pageview' AND created_at > now() - ($1 || ' days')::interval) AS visitors,
         (SELECT COALESCE(sum(unread_for_other), 0)::int FROM chat_threads
           WHERE kind = 'support')                                                AS support_unread`,
      params,
    ),
    queryAll(
      `SELECT s.id, s.name, s.slug, s.status, s.timezone, s.site_url, s.phone,
              u.full_name AS owner_name, u.phone AS owner_phone,
              COALESCE(a.bookings, 0)::int        AS bookings,
              COALESCE(a.pending, 0)::int         AS pending,
              COALESCE(a.completed, 0)::int       AS completed,
              COALESCE(e.pageviews, 0)::int       AS pageviews,
              COALESCE(e.visitors, 0)::int        AS visitors,
              COALESCE(c.calls, 0)::int           AS calls,
              COALESCE(c.missed, 0)::int          AS missed_calls,
              COALESCE(t.unread, 0)::int          AS support_unread,
              a.last_booking_at
         FROM shops s
         LEFT JOIN shop_members m ON m.shop_id = s.id AND m.role = 'owner' AND m.is_primary
         LEFT JOIN users u ON u.id = m.user_id
         LEFT JOIN (
           SELECT shop_id,
                  count(*) AS bookings,
                  count(*) FILTER (WHERE status IN ('confirmed', 'accepted', 'pending')) AS pending,
                  count(*) FILTER (WHERE status = 'completed') AS completed,
                  max(created_at) AS last_booking_at
             FROM appointments
            WHERE created_at > now() - ($1 || ' days')::interval
            GROUP BY shop_id
         ) a ON a.shop_id = s.id
         LEFT JOIN (
           SELECT shop_id,
                  count(*) FILTER (WHERE event_type = 'pageview') AS pageviews,
                  count(DISTINCT session_id) FILTER (WHERE event_type = 'pageview') AS visitors
             FROM site_events
            WHERE created_at > now() - ($1 || ' days')::interval
            GROUP BY shop_id
         ) e ON e.shop_id = s.id
         LEFT JOIN (
           SELECT shop_id, count(*) AS calls,
                  count(*) FILTER (WHERE status IN ('no_answer', 'busy', 'failed')) AS missed
             FROM call_logs
            WHERE started_at > now() - ($1 || ' days')::interval
            GROUP BY shop_id
         ) c ON c.shop_id = s.id
         LEFT JOIN (
           SELECT shop_id, sum(unread_for_other) AS unread
             FROM chat_threads WHERE kind = 'support' GROUP BY shop_id
         ) t ON t.shop_id = s.id
        WHERE s.status <> 'archived'
        ORDER BY bookings DESC, s.name`,
      params,
    ),
    queryAll(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS bookings
         FROM appointments
        WHERE created_at > now() - ($1 || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    queryAll(
      `SELECT s.id, s.name,
              0::int AS stale_pending
         FROM shops s
         LEFT JOIN appointments a ON a.shop_id = s.id
        WHERE s.status = 'active'
        GROUP BY s.id, s.name
       HAVING false
        ORDER BY stale_pending DESC LIMIT 10`,
    ),
  ]);

  return {
    window_days: window,
    totals,
    shops: perShop.map((row) => ({
      ...row,
      owner_phone_display: row.owner_phone ? formatPhone(row.owner_phone) : null,
    })),
    timeline,
    alerts,
  };
}
