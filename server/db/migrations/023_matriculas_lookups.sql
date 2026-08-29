-- Official plate lookups (Matriculas.org) are a Super Admin tool.
-- Shop owners and customers never write to this table through the API;
-- the Express route is gated by requireSuperAdmin and, on Supabase, RLS
-- additionally refuses any role that is not super_admin.

CREATE TABLE IF NOT EXISTS matriculas_lookups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users (id) ON DELETE SET NULL,
  shop_id    UUID REFERENCES shops (id) ON DELETE SET NULL,
  plate      TEXT NOT NULL,
  found      BOOLEAN NOT NULL DEFAULT false,
  reason     TEXT,
  make       TEXT,
  model      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matriculas_lookups_recent_idx
  ON matriculas_lookups (created_at DESC);

ALTER TABLE matriculas_lookups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matriculas_lookups_super_admin_select ON matriculas_lookups;
DROP POLICY IF EXISTS matriculas_lookups_super_admin_insert ON matriculas_lookups;
DROP POLICY IF EXISTS matriculas_lookups_deny_update ON matriculas_lookups;
DROP POLICY IF EXISTS matriculas_lookups_deny_delete ON matriculas_lookups;

-- The Express app connects as the table owner and therefore bypasses RLS
-- (same as every other table here). requireSuperAdmin is the live gate.
-- These policies still apply to any non-owner role and to the matching
-- Supabase copy, so a shop-owner JWT cannot read or write the audit log.

CREATE POLICY matriculas_lookups_super_admin_select
  ON matriculas_lookups
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = matriculas_lookups.user_id
         AND u.role = 'super_admin'
         AND u.status = 'active'
    )
  );

CREATE POLICY matriculas_lookups_super_admin_insert
  ON matriculas_lookups
  FOR INSERT
  WITH CHECK (
    user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = user_id
         AND u.role = 'super_admin'
         AND u.status = 'active'
    )
  );

-- Lookups are an audit log: nobody rewrites or deletes them from the API.
CREATE POLICY matriculas_lookups_deny_update
  ON matriculas_lookups
  FOR UPDATE
  USING (false);

CREATE POLICY matriculas_lookups_deny_delete
  ON matriculas_lookups
  FOR DELETE
  USING (false);
