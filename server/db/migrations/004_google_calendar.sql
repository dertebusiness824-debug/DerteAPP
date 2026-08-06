-- Google Calendar sync: per-shop OAuth / calendar id + event link on appointments.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_refresh_token TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_access_token TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_token_expiry TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_connected_email TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_calendar_sync_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS google_event_id TEXT;

CREATE INDEX IF NOT EXISTS appointments_google_event_idx
  ON appointments (google_event_id) WHERE google_event_id IS NOT NULL;
