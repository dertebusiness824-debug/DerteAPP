-- Cal.com booking identifiers on appointments (Urgencias → reserva sync).

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS calcom_booking_uid TEXT,
  ADD COLUMN IF NOT EXISTS calcom_booking_id TEXT,
  ADD COLUMN IF NOT EXISTS calcom_last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS appointments_calcom_uid_idx
  ON appointments (calcom_booking_uid)
  WHERE calcom_booking_uid IS NOT NULL;
