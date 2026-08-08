-- Force every leftover pending/accepted booking to confirmed.
-- Idempotent: safe to re-run on every deploy.

UPDATE appointments
   SET status = 'confirmed',
       accepted_at = COALESCE(accepted_at, now())
 WHERE status IN ('pending', 'accepted');
