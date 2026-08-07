import { query } from '../db/index.js';
import { renewExpiringCalendarWatches } from './google-calendar.js';

/**
 * Housekeeping for rows that only matter while they are fresh. Without this,
 * `sessions` and `otp_codes` grow forever on a long-running instance.
 */
export async function purgeExpired() {
  const [sessions, otps, notifications] = await Promise.all([
    query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days'
             OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`),
    query(`DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'`),
    query(`DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < now() - interval '30 days'`),
  ]);

  return {
    sessions: sessions.rowCount,
    otp_codes: otps.rowCount,
    notifications: notifications.rowCount,
  };
}

/** Starts the periodic sweep and returns a stop function. */
export function startMaintenance({ intervalMs = 12 * 60 * 60_000 } = {}) {
  const run = async () => {
    try {
      const removed = await purgeExpired();
      const total = removed.sessions + removed.otp_codes + removed.notifications;
      if (total > 0) console.log(`[maintenance] purged ${total} expired rows`, removed);
    } catch (error) {
      console.error(`[maintenance] sweep failed: ${error.message}`);
    }

    try {
      const watches = await renewExpiringCalendarWatches();
      if (watches.renewed > 0) {
        console.log(`[maintenance] renewed ${watches.renewed}/${watches.checked} Google Calendar watches`);
      }
    } catch (error) {
      console.error(`[maintenance] google calendar watch renewal failed: ${error.message}`);
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
