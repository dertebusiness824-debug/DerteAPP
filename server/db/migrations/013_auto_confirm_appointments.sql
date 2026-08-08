-- Auto-confirm bookings: every appointment is stored as "confirmed".
-- Backfill legacy pending/accepted rows so the owner panel starts clean.

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;

UPDATE appointments
   SET status = 'confirmed',
       accepted_at = COALESCE(accepted_at, now())
 WHERE status IN ('pending', 'accepted');

ALTER TABLE appointments
  ALTER COLUMN status SET DEFAULT 'confirmed';

-- Keep pending/accepted in the CHECK only as legacy aliases (app writes confirmed).
ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN (
    'confirmed',
    'pending',
    'accepted',
    'in_progress',
    'completed',
    'cancelled',
    'no_show'
  ));
