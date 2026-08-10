-- Urgent call intake from Retell (and future sources).
-- Active panel: last 24h. History: 24h–60d. Rows older than 60d are purged.

CREATE TABLE IF NOT EXISTS urgencias (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  call_log_id      UUID REFERENCES call_logs (id) ON DELETE SET NULL,
  external_ref     TEXT,
  is_urgent        BOOLEAN NOT NULL DEFAULT TRUE,
  customer_name    TEXT,
  customer_phone   TEXT NOT NULL,
  vehicle_make     TEXT,
  vehicle_model    TEXT,
  vehicle_plate    TEXT,
  reason           TEXT,
  summary          TEXT,
  transcript       TEXT,
  called_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  source           TEXT NOT NULL DEFAULT 'retell',
  raw              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT urgencias_external_ref_unique UNIQUE (external_ref)
);

CREATE INDEX IF NOT EXISTS urgencias_shop_created_idx
  ON urgencias (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS urgencias_shop_active_idx
  ON urgencias (shop_id, created_at DESC)
  WHERE is_urgent = TRUE;

DROP TRIGGER IF EXISTS urgencias_updated_at ON urgencias;
CREATE TRIGGER urgencias_updated_at BEFORE UPDATE ON urgencias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
