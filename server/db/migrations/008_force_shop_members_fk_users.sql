-- Force shop_members foreign keys onto Express tables (users/shops).
-- A Supabase-imported schema may have pointed user_id at public.profiles,
-- which makes Super Admin owner creation fail with PostgreSQL 23503
-- ("Referenced record does not exist" / "reference code does not exist").

ALTER TABLE IF EXISTS shop_members DROP CONSTRAINT IF EXISTS shop_members_user_id_fkey;
ALTER TABLE IF EXISTS shop_members DROP CONSTRAINT IF EXISTS shop_members_shop_id_fkey;

-- Drop memberships that cannot resolve to a local users row.
DELETE FROM shop_members m
 WHERE to_regclass('public.users') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id);

DELETE FROM shop_members m
 WHERE to_regclass('public.shops') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM shops s WHERE s.id = m.shop_id);

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL AND to_regclass('public.shop_members') IS NOT NULL THEN
    ALTER TABLE shop_members
      ADD CONSTRAINT shop_members_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.shops') IS NOT NULL AND to_regclass('public.shop_members') IS NOT NULL THEN
    ALTER TABLE shop_members
      ADD CONSTRAINT shop_members_shop_id_fkey
      FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE;
  END IF;
END $$;
