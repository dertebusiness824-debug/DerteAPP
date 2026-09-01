-- ---------------------------------------------------------------------------
-- Performance: indexed DID routing, trigram search, loyalty-friendly lookups.
-- ---------------------------------------------------------------------------

-- Digit-only generated columns so inbound DID matching can use a btree index
-- instead of regexp_replace(...) on every shops row at call time.
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS retell_did_digits TEXT
    GENERATED ALWAYS AS (regexp_replace(COALESCE(retell_did, ''), '[^0-9]', '', 'g')) STORED;

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS zadarma_did_digits TEXT
    GENERATED ALWAYS AS (regexp_replace(COALESCE(zadarma_did, ''), '[^0-9]', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS shops_retell_did_digits_idx
  ON shops (retell_did_digits) WHERE retell_did_digits <> '';

CREATE INDEX IF NOT EXISTS shops_zadarma_did_digits_idx
  ON shops (zadarma_did_digits) WHERE zadarma_did_digits <> '';

-- Trigram indexes for ILIKE '%term%' on the large searchable tables.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS inventory_items_name_trgm_idx
  ON inventory_items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS inventory_items_spec_trgm_idx
  ON inventory_items USING gin (spec gin_trgm_ops);
CREATE INDEX IF NOT EXISTS inventory_items_brand_trgm_idx
  ON inventory_items USING gin (brand gin_trgm_ops);

CREATE INDEX IF NOT EXISTS appointments_customer_name_trgm_idx
  ON appointments USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS appointments_customer_phone_trgm_idx
  ON appointments USING gin (customer_phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS appointments_reference_trgm_idx
  ON appointments USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS appointments_vehicle_plate_trgm_idx
  ON appointments USING gin (vehicle_plate gin_trgm_ops);

CREATE INDEX IF NOT EXISTS shops_name_trgm_idx
  ON shops USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shops_slug_trgm_idx
  ON shops USING gin (slug gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shops_site_url_trgm_idx
  ON shops USING gin (site_url gin_trgm_ops);

CREATE INDEX IF NOT EXISTS shop_vehicles_plate_trgm_idx
  ON shop_vehicles USING gin (plate gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shop_vehicles_make_trgm_idx
  ON shop_vehicles USING gin (make gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shop_vehicles_model_trgm_idx
  ON shop_vehicles USING gin (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shop_vehicles_customer_name_trgm_idx
  ON shop_vehicles USING gin (customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_full_name_trgm_idx
  ON users USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_phone_trgm_idx
  ON users USING gin (phone gin_trgm_ops);
