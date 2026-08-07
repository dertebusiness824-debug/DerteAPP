-- Bidirectional Google Calendar sync: push watches + anti-loop markers.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_watch_channel_id TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_watch_resource_id TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_watch_expiration TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_sync_token TEXT;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS google_last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS shops_google_watch_channel_idx
  ON shops (google_calendar_watch_channel_id)
  WHERE google_calendar_watch_channel_id IS NOT NULL;

-- Allow bookings that originate from a Google Calendar event.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_source_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_source_check
  CHECK (source IN ('hostinger', 'dashboard', 'phone', 'walk_in', 'api', 'retell', 'google'));
