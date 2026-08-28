-- =============================================================================
-- Asegura el Super Admin en profiles (Supabase).
--
-- Preferido: `npm run seed` desde la raíz del repo. Eso:
--   1) Crea/actualiza `public.users` con bcrypt (login del panel B2B)
--   2) Si hay SUPABASE_SERVICE_ROLE_KEY, crea/actualiza auth.users vía Admin API
--      (hash correcto) y deja profiles.role = 'super_admin'
--
-- Credenciales por defecto (sobreescribibles con SUPER_ADMIN_*):
--   email:    dertebusiness824@gmail.com
--   password: Marron1*
--   phone:    +34605686509
--
-- Este SQL NO escribe auth.users a mano (Supabase Auth gestiona el hash).
-- Solo corrige el rol en profiles si el usuario Auth ya existe.
-- =============================================================================

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
    FROM auth.users
   WHERE lower(email) = lower('dertebusiness824@gmail.com')
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'seed_super_admin: no hay auth.users con ese email. Ejecuta `npm run seed` con SUPABASE_SERVICE_ROLE_KEY para crearlo.';
    RETURN;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, phone, role, status, locale)
  VALUES (
    v_user_id,
    'Super Admin',
    'dertebusiness824@gmail.com',
    '+34605686509',
    'super_admin',
    'active',
    'es'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    role = 'super_admin',
    status = 'active';

  RAISE NOTICE 'seed_super_admin: profiles.role = super_admin para %', v_user_id;
END $$;
