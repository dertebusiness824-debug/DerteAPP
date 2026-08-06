-- ---------------------------------------------------------------------------
-- DerteApp initial schema
-- Multi-tenant control panel for auto repair shops.
-- Tenancy rule: every business row carries shop_id and is always filtered by it.
-- ---------------------------------------------------------------------------

CREATE TABLE shops (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  -- Public key embedded in the Hostinger snippet; identifies the tenant on
  -- unauthenticated endpoints. Rotatable without touching the shop id.
  public_key       TEXT NOT NULL UNIQUE,
  -- Hostinger Website Builder domain(s) allowed to call the public API (CORS).
  site_domains     TEXT[] NOT NULL DEFAULT '{}',
  site_url         TEXT,
  phone            TEXT,
  whatsapp_phone   TEXT,
  email            TEXT,
  address          TEXT,
  city             TEXT,
  country_code     TEXT,
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  -- Booking granularity and how many cars can be handled in the same slot.
  slot_minutes     INTEGER NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 5 AND 480),
  capacity         INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 100),
  -- Minimum notice (minutes) and how far ahead customers may book (days).
  min_notice_minutes INTEGER NOT NULL DEFAULT 60 CHECK (min_notice_minutes >= 0),
  booking_horizon_days INTEGER NOT NULL DEFAULT 60 CHECK (booking_horizon_days BETWEEN 1 AND 365),
  services         JSONB NOT NULL DEFAULT '[]'::jsonb,
  zadarma_sip      TEXT,
  zadarma_did      TEXT,
  settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX shops_status_idx ON shops (status);

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164, always stored with the leading "+" and country code. This is the
  -- login identity and the number surfaced in every chat header.
  phone          TEXT NOT NULL UNIQUE,
  password_hash  TEXT,
  full_name      TEXT NOT NULL,
  email          TEXT,
  role           TEXT NOT NULL CHECK (role IN ('shop_owner', 'super_admin')),
  whatsapp_phone TEXT,
  avatar_hue     INTEGER NOT NULL DEFAULT 210,
  locale         TEXT NOT NULL DEFAULT 'en',
  phone_verified_at TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_role_idx ON users (role);

-- A shop owner can hold several Hostinger sites; a shop can have staff members.
CREATE TABLE shop_members (
  shop_id    UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'mechanic')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, user_id)
);

CREATE INDEX shop_members_user_idx ON shop_members (user_id);

CREATE TABLE sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip         TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'reset')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX otp_codes_lookup_idx ON otp_codes (phone, purpose, created_at DESC);

-- Weekly opening hours. One row per weekday per shop (0 = Sunday .. 6 = Saturday).
CREATE TABLE business_hours (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_closed   BOOLEAN NOT NULL DEFAULT false,
  open_time   TIME,
  close_time  TIME,
  break_start TIME,
  break_end   TIME,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, weekday),
  CONSTRAINT business_hours_range_chk
    CHECK (is_closed OR (open_time IS NOT NULL AND close_time IS NOT NULL AND close_time > open_time)),
  CONSTRAINT business_hours_break_chk
    CHECK ((break_start IS NULL AND break_end IS NULL) OR (break_start IS NOT NULL AND break_end IS NOT NULL AND break_end > break_start))
);

-- Holidays, vacation days and one-off schedule overrides.
CREATE TABLE schedule_exceptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_closed  BOOLEAN NOT NULL DEFAULT true,
  open_time  TIME,
  close_time TIME,
  break_start TIME,
  break_end  TIME,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, exception_date),
  CONSTRAINT schedule_exceptions_range_chk
    CHECK (is_closed OR (open_time IS NOT NULL AND close_time IS NOT NULL AND close_time > open_time))
);

CREATE INDEX schedule_exceptions_shop_date_idx ON schedule_exceptions (shop_id, exception_date);

CREATE TABLE appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  reference        TEXT NOT NULL UNIQUE,
  customer_name    TEXT NOT NULL,
  customer_phone   TEXT NOT NULL,
  customer_email   TEXT,
  vehicle_make     TEXT,
  vehicle_model    TEXT,
  vehicle_year     INTEGER,
  vehicle_plate    TEXT,
  service_type     TEXT,
  notes            TEXT,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 1440),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'no_show')),
  price_estimate   NUMERIC(10, 2),
  source           TEXT NOT NULL DEFAULT 'hostinger'
                   CHECK (source IN ('hostinger', 'dashboard', 'phone', 'walk_in', 'api')),
  source_url       TEXT,
  accepted_at      TIMESTAMPTZ,
  accepted_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  completed_at     TIMESTAMPTZ,
  cancelled_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX appointments_shop_scheduled_idx ON appointments (shop_id, scheduled_at DESC);
CREATE INDEX appointments_shop_status_idx ON appointments (shop_id, status);
CREATE INDEX appointments_customer_phone_idx ON appointments (customer_phone);

CREATE TABLE chat_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  -- 'customer' = shop owner <-> car owner (opened when an appointment is accepted)
  -- 'support'  = shop owner <-> Super Admin (one per shop)
  kind            TEXT NOT NULL CHECK (kind IN ('customer', 'support')),
  appointment_id  UUID REFERENCES appointments (id) ON DELETE SET NULL,
  customer_name   TEXT,
  customer_phone  TEXT,
  subject         TEXT,
  -- Unguessable token used to build the public customer chat link.
  access_token    TEXT UNIQUE,
  token_expires_at TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_for_shop  INTEGER NOT NULL DEFAULT 0,
  unread_for_other INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chat_threads_support_unique_idx ON chat_threads (shop_id) WHERE kind = 'support';
CREATE UNIQUE INDEX chat_threads_appointment_unique_idx ON chat_threads (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX chat_threads_shop_recent_idx ON chat_threads (shop_id, last_message_at DESC NULLS LAST);

CREATE TABLE chat_messages (
  id             BIGSERIAL PRIMARY KEY,
  thread_id      UUID NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  -- 'shop' (owner/staff), 'customer' (public link), 'admin' (Super Admin), 'system'
  sender_type    TEXT NOT NULL CHECK (sender_type IN ('shop', 'customer', 'admin', 'system')),
  sender_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  sender_name    TEXT NOT NULL,
  -- Denormalised so the number stays visible in the transcript even if a
  -- profile changes later.
  sender_phone   TEXT,
  body           TEXT NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_thread_idx ON chat_messages (thread_id, id);

CREATE TABLE call_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID REFERENCES shops (id) ON DELETE CASCADE,
  appointment_id   UUID REFERENCES appointments (id) ON DELETE SET NULL,
  user_id          UUID REFERENCES users (id) ON DELETE SET NULL,
  provider         TEXT NOT NULL DEFAULT 'zadarma',
  external_id      TEXT,
  pbx_call_id      TEXT,
  direction        TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out', 'internal')),
  caller_phone     TEXT,
  callee_phone     TEXT,
  sip              TEXT,
  status           TEXT NOT NULL DEFAULT 'started'
                   CHECK (status IN ('started', 'ringing', 'answered', 'completed', 'failed', 'busy', 'no_answer', 'cancelled')),
  disposition      TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  billable_seconds INTEGER NOT NULL DEFAULT 0,
  cost             NUMERIC(10, 4),
  recording_url    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at      TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  raw              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX call_logs_provider_external_idx
  ON call_logs (provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX call_logs_shop_started_idx ON call_logs (shop_id, started_at DESC);

-- Lightweight web analytics collected by the Hostinger embed snippet.
CREATE TABLE site_events (
  id         BIGSERIAL PRIMARY KEY,
  shop_id    UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
             CHECK (event_type IN ('pageview', 'form_view', 'form_submit', 'booking_created',
                                   'call_click', 'whatsapp_click', 'schedule_check', 'custom')),
  path       TEXT,
  referrer   TEXT,
  user_agent TEXT,
  device     TEXT CHECK (device IN ('mobile', 'tablet', 'desktop', 'unknown')),
  session_id TEXT,
  -- Hashed, never the raw IP: analytics only needs uniqueness, not identity.
  ip_hash    TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX site_events_shop_created_idx ON site_events (shop_id, created_at DESC);
CREATE INDEX site_events_type_idx ON site_events (shop_id, event_type, created_at DESC);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  shop_id    UUID REFERENCES shops (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  shop_id       UUID REFERENCES shops (id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_shop_idx ON audit_log (shop_id, created_at DESC);

-- Keep updated_at honest without repeating the logic in every query.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shops_updated_at BEFORE UPDATE ON shops
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER chat_threads_updated_at BEFORE UPDATE ON chat_threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER call_logs_updated_at BEFORE UPDATE ON call_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
