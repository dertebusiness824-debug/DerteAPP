-- Ensure shop_members.user_id references public.users (Express auth),
-- not public.profiles (Supabase Auth). A mixed schema causes
-- "Referenced record does not exist" when creating owners from Super Admin.
DO $$
DECLARE
  referenced_table text;
BEGIN
  SELECT c.confrelid::regclass::text
    INTO referenced_table
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'shop_members'
     AND c.contype = 'f'
     AND c.conname = 'shop_members_user_id_fkey';

  IF referenced_table IS NULL THEN
    -- Constraint missing: add it when safe.
    IF to_regclass('public.users') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM shop_members m
           LEFT JOIN users u ON u.id = m.user_id
          WHERE u.id IS NULL
       )
    THEN
      ALTER TABLE shop_members
        ADD CONSTRAINT shop_members_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
  ELSIF referenced_table IS DISTINCT FROM 'users' THEN
    ALTER TABLE shop_members DROP CONSTRAINT shop_members_user_id_fkey;
    IF NOT EXISTS (
      SELECT 1
        FROM shop_members m
        LEFT JOIN users u ON u.id = m.user_id
       WHERE u.id IS NULL
    ) THEN
      ALTER TABLE shop_members
        ADD CONSTRAINT shop_members_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Same for shop_id → shops (idempotent safety).
DO $$
DECLARE
  referenced_table text;
BEGIN
  SELECT c.confrelid::regclass::text
    INTO referenced_table
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'shop_members'
     AND c.contype = 'f'
     AND c.conname = 'shop_members_shop_id_fkey';

  IF referenced_table IS NULL THEN
    IF to_regclass('public.shops') IS NOT NULL THEN
      ALTER TABLE shop_members
        ADD CONSTRAINT shop_members_shop_id_fkey
        FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE;
    END IF;
  ELSIF referenced_table IS DISTINCT FROM 'shops' THEN
    ALTER TABLE shop_members DROP CONSTRAINT shop_members_shop_id_fkey;
    ALTER TABLE shop_members
      ADD CONSTRAINT shop_members_shop_id_fkey
      FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE;
  END IF;
END $$;
