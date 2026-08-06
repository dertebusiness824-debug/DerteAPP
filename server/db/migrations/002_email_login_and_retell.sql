-- ---------------------------------------------------------------------------
-- 1. Email as an alternative sign-in identifier (the Super Admin signs in with
--    an email address rather than a phone number).
-- 2. Retell AI voice receptionist: per-tenant routing plus an idempotency key
--    so a finished call becomes exactly one booking in the calendar.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX users_email_unique_idx ON users (lower(email)) WHERE email IS NOT NULL;

-- Which Retell agent / inbound number belongs to which shop.
ALTER TABLE shops ADD COLUMN retell_agent_id TEXT;
ALTER TABLE shops ADD COLUMN retell_did TEXT;

CREATE INDEX shops_retell_agent_idx ON shops (retell_agent_id) WHERE retell_agent_id IS NOT NULL;

-- Provider reference (e.g. `retell:<call_id>`). Retell sends call_ended and
-- call_analyzed for the same call, so ingestion must be idempotent.
ALTER TABLE appointments ADD COLUMN external_ref TEXT;

CREATE UNIQUE INDEX appointments_external_ref_idx
  ON appointments (external_ref) WHERE external_ref IS NOT NULL;

-- Bookings taken by the AI phone receptionist get their own source, so the
-- analytics breakdown can show how many jobs it brings in.
ALTER TABLE appointments DROP CONSTRAINT appointments_source_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_source_check
  CHECK (source IN ('hostinger', 'dashboard', 'phone', 'walk_in', 'api', 'retell'));
