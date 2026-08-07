-- Sales reps / affiliates: attribution on shops + €50 first-payment commissions.

CREATE TABLE IF NOT EXISTS sales_reps (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  phone              TEXT,
  email              TEXT,
  referral_code      TEXT NOT NULL UNIQUE,
  total_commissions  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended', 'archived')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_reps_status_idx ON sales_reps (status, name);

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES sales_reps (id) ON DELETE SET NULL;

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS first_payment_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS shops_sales_rep_idx
  ON shops (sales_rep_id)
  WHERE sales_rep_id IS NOT NULL;

-- One first-payment commission per shop (€ 50 when the first fee is marked paid.
CREATE TABLE IF NOT EXISTS sales_rep_commissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_rep_id    UUID NOT NULL REFERENCES sales_reps (id) ON DELETE CASCADE,
  shop_id         UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  amount          NUMERIC(12, 2) NOT NULL DEFAULT 50.00,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  kind            TEXT NOT NULL DEFAULT 'first_payment'
                  CHECK (kind IN ('first_payment')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'cancelled')),
  earned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ,
  paid_by         UUID REFERENCES users (id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, kind)
);

CREATE INDEX IF NOT EXISTS sales_rep_commissions_status_idx
  ON sales_rep_commissions (status, earned_at DESC);

CREATE INDEX IF NOT EXISTS sales_rep_commissions_rep_idx
  ON sales_rep_commissions (sales_rep_id, status);
