-- Platform sales leads captured by the Retell AI receptionist.
-- Super Admin CLIENTES: future workshop owners interested in DerteApp.

CREATE TABLE IF NOT EXISTS platform_leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref    TEXT UNIQUE,
  customer_name   TEXT,
  shop_name       TEXT,
  island          TEXT,
  customer_phone  TEXT,
  customer_email  TEXT,
  summary         TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'contacted', 'closed')),
  called_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_leads_status_idx
  ON platform_leads (status, called_at DESC NULLS LAST, created_at DESC);

ALTER TABLE platform_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_leads_super_admin_all ON platform_leads;

-- Express connects as the table owner and bypasses RLS.
-- These policies keep a shop-owner JWT from reading sales leads in Supabase.
CREATE POLICY platform_leads_super_admin_all
  ON platform_leads
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.role = 'super_admin'
         AND u.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.role = 'super_admin'
         AND u.status = 'active'
    )
  );
