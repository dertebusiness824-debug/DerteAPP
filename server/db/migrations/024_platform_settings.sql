-- Platform-wide secrets the Super Admin can set from Ajustes.
-- Matriculas.org is one key for the whole product, never per shop.

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_super_admin_select ON platform_settings;
DROP POLICY IF EXISTS platform_settings_super_admin_write ON platform_settings;
DROP POLICY IF EXISTS platform_settings_super_admin_update ON platform_settings;
DROP POLICY IF EXISTS platform_settings_deny_delete ON platform_settings;

-- Express connects as the table owner and therefore bypasses RLS
-- (same as every other table here). requireSuperAdmin is the live gate.
-- These policies still apply to any non-owner role and to the matching
-- Supabase copy, so a shop-owner JWT cannot read or write the API key.

CREATE POLICY platform_settings_super_admin_select
  ON platform_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = platform_settings.updated_by
         AND u.role = 'super_admin'
         AND u.status = 'active'
    )
  );

CREATE POLICY platform_settings_super_admin_write
  ON platform_settings
  FOR INSERT
  WITH CHECK (
    updated_by IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = updated_by
         AND u.role = 'super_admin'
         AND u.status = 'active'
    )
  );

CREATE POLICY platform_settings_super_admin_update
  ON platform_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.role = 'super_admin'
         AND u.status = 'active'
         AND u.id = platform_settings.updated_by
    )
  )
  WITH CHECK (
    updated_by IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = updated_by
         AND u.role = 'super_admin'
         AND u.status = 'active'
    )
  );

CREATE POLICY platform_settings_deny_delete
  ON platform_settings
  FOR DELETE
  USING (false);
