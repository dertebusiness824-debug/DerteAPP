-- Super Admin «Consultas» + cierre anual de rendimiento (31 dic 18:00 peninsular).

CREATE TABLE IF NOT EXISTS shop_year_closes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  year                 INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  bookings_scheduled   INTEGER NOT NULL DEFAULT 0,
  bookings_completed   INTEGER NOT NULL DEFAULT 0,
  plate_lookups        INTEGER NOT NULL DEFAULT 0,
  diagnostic_queries   INTEGER NOT NULL DEFAULT 0,
  closed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, year)
);

CREATE INDEX IF NOT EXISTS shop_year_closes_year_idx
  ON shop_year_closes (year DESC, shop_id);

CREATE TABLE IF NOT EXISTS user_year_summaries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  year         INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  message      TEXT NOT NULL DEFAULT 'Muchas gracias por hacernos parte de tu año',
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  notified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, year)
);

CREATE INDEX IF NOT EXISTS user_year_summaries_user_idx
  ON user_year_summaries (user_id, year DESC);

CREATE TABLE IF NOT EXISTS annual_close_runs (
  year          INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 2100),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  shops_closed  INTEGER NOT NULL DEFAULT 0,
  users_notified INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS matriculas_lookups_shop_created_idx
  ON matriculas_lookups (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS matriculas_lookups_user_created_idx
  ON matriculas_lookups (user_id, created_at DESC);
