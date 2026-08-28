-- Ofertas y promociones por taller (gestionadas desde el panel de Super Admin).
-- La PWA de clientes las lee vía Supabase (RLS en marketplace.sql).

CREATE TABLE IF NOT EXISTS shop_promotions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  badge_label       TEXT,
  discount_percent  NUMERIC(5, 2),
  price_from        NUMERIC(10, 2),
  price_to          NUMERIC(10, 2),
  currency          TEXT NOT NULL DEFAULT 'EUR',
  service_name      TEXT,
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shop_promotions_discount_range
    CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  CONSTRAINT shop_promotions_title_len CHECK (char_length(trim(title)) BETWEEN 2 AND 120)
);

CREATE INDEX IF NOT EXISTS shop_promotions_shop_idx
  ON shop_promotions (shop_id, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS shop_promotions_active_idx
  ON shop_promotions (shop_id)
  WHERE is_active;

CREATE OR REPLACE FUNCTION shop_promotions_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shop_promotions_touch ON shop_promotions;
CREATE TRIGGER shop_promotions_touch
  BEFORE UPDATE ON shop_promotions
  FOR EACH ROW EXECUTE FUNCTION shop_promotions_touch_updated_at();
