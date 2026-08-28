-- ---------------------------------------------------------------------------
-- Taller modules: vehicle identification, AI diagnostics and inventory.
-- Tenancy rule holds: every table carries shop_id and is filtered by it.
-- ---------------------------------------------------------------------------

-- Vehicles identified by plate, photo or manual entry.
CREATE TABLE IF NOT EXISTS shop_vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  -- Uppercase, no separators, so "1234 BCD" and "1234bcd" are the same car.
  plate         TEXT,
  make          TEXT,
  model         TEXT,
  -- Exact commercial version ("1.6 TDI Style DSG"), which is what a mechanic needs.
  version       TEXT,
  year          INTEGER CHECK (year IS NULL OR year BETWEEN 1900 AND 2100),
  fuel          TEXT,
  engine        TEXT,
  power_hp      INTEGER CHECK (power_hp IS NULL OR power_hp BETWEEN 1 AND 2000),
  body          TEXT,
  specs         JSONB NOT NULL DEFAULT '{}'::jsonb,
  photo_url     TEXT,
  identified_by TEXT NOT NULL DEFAULT 'manual'
                CHECK (identified_by IN ('plate', 'photo', 'manual', 'catalog', 'history')),
  confidence    NUMERIC(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  customer_name  TEXT,
  customer_phone TEXT,
  notes         TEXT,
  created_by    UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shop_vehicles_identity_chk
    CHECK (plate IS NOT NULL OR make IS NOT NULL OR model IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_vehicles_plate_unique_idx
  ON shop_vehicles (shop_id, plate) WHERE plate IS NOT NULL;
CREATE INDEX IF NOT EXISTS shop_vehicles_shop_recent_idx
  ON shop_vehicles (shop_id, updated_at DESC);

-- Diagnostic assistant history ("¿Cuál es el motivo de la consulta?").
CREATE TABLE IF NOT EXISTS diagnostic_queries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  vehicle_id    UUID REFERENCES shop_vehicles (id) ON DELETE SET NULL,
  prompt        TEXT NOT NULL,
  vehicle_label TEXT,
  mileage_km    INTEGER CHECK (mileage_km IS NULL OR mileage_km >= 0),
  -- 'ai' when an external model answered, 'local' for the built-in rule base.
  provider      TEXT NOT NULL DEFAULT 'local' CHECK (provider IN ('ai', 'local')),
  model         TEXT,
  causes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by    UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diagnostic_queries_shop_recent_idx
  ON diagnostic_queries (shop_id, created_at DESC);

-- Spare parts and consumables (tyres, wheels, oils, filters, …).
CREATE TABLE IF NOT EXISTS inventory_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'other',
  brand        TEXT,
  -- Tyre size, oil viscosity, part reference… whatever identifies the variant.
  spec         TEXT,
  quantity     NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit         TEXT NOT NULL DEFAULT 'ud',
  min_quantity NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  price        NUMERIC(10, 2) CHECK (price IS NULL OR price >= 0),
  photo_url    TEXT,
  notes        TEXT,
  -- True while the row still is exactly what the Super Admin preloaded.
  preloaded    BOOLEAN NOT NULL DEFAULT false,
  created_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_items_name_len CHECK (char_length(btrim(name)) BETWEEN 2 AND 120)
);

-- Keeps the Super Admin preload idempotent and blocks accidental duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_unique_idx
  ON inventory_items (shop_id, lower(btrim(name)), lower(coalesce(btrim(spec), '')));
CREATE INDEX IF NOT EXISTS inventory_items_shop_category_idx
  ON inventory_items (shop_id, category, name);
CREATE INDEX IF NOT EXISTS inventory_items_low_stock_idx
  ON inventory_items (shop_id) WHERE quantity <= min_quantity;

-- Every add / remove, so "this month nothing changed" is a fact, not a guess.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id            BIGSERIAL PRIMARY KEY,
  shop_id       UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  item_id       UUID REFERENCES inventory_items (id) ON DELETE SET NULL,
  -- Denormalised so a deleted item still reads sensibly in the log.
  item_name     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('create', 'add', 'remove', 'adjust', 'delete', 'preload')),
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'photo', 'preload')),
  delta         NUMERIC(10, 2) NOT NULL DEFAULT 0,
  quantity_after NUMERIC(10, 2),
  actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_shop_recent_idx
  ON inventory_movements (shop_id, created_at DESC);

-- Reminder bookkeeping + the owner's kill switch for the whole system.
CREATE TABLE IF NOT EXISTS shop_inventory_state (
  shop_id                     UUID PRIMARY KEY REFERENCES shops (id) ON DELETE CASCADE,
  reminders_enabled           BOOLEAN NOT NULL DEFAULT true,
  last_change_at              TIMESTAMPTZ,
  -- Fortnightly Friday nudge: the date we last sent one.
  last_biweekly_notified_on   DATE,
  -- Monthly "nothing changed" nudge, as YYYY-MM so one month sends once.
  last_monthly_notified_month TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Loyalty counters read every booking a phone number has in one shop, so the
-- per-customer history stays a single index lookup instead of a shop-wide scan.
CREATE INDEX IF NOT EXISTS appointments_shop_customer_idx
  ON appointments (shop_id, customer_phone);

DROP TRIGGER IF EXISTS shop_vehicles_updated_at ON shop_vehicles;
CREATE TRIGGER shop_vehicles_updated_at BEFORE UPDATE ON shop_vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS inventory_items_updated_at ON inventory_items;
CREATE TRIGGER inventory_items_updated_at BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS shop_inventory_state_updated_at ON shop_inventory_state;
CREATE TRIGGER shop_inventory_state_updated_at BEFORE UPDATE ON shop_inventory_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
