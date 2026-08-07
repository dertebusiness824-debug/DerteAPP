-- =============================================================================
-- DerteApp · esquema inicial para Supabase (PostgreSQL)
-- Pegar y ejecutar en: Supabase → SQL Editor → New query → Run
--
-- Incluye:
--   1) shops          (perfil + Google Calendar + Retell/Hostinger)
--   2) appointments   (citas/reservas por taller)
--   3) shop_members   (necesario para RLS multi-tenant)
--   4) profiles       (puente con auth.users de Supabase)
--   5) RLS + políticas
-- =============================================================================

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helper: updated_at automático
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 con auth.users de Supabase Auth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL DEFAULT '',
  email           TEXT,
  phone           TEXT UNIQUE,
  whatsapp_phone  TEXT,
  role            TEXT NOT NULL DEFAULT 'shop_owner'
                  CHECK (role IN ('shop_owner', 'super_admin')),
  locale          TEXT NOT NULL DEFAULT 'es',
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx
  ON public.profiles (lower(email)) WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Al registrar un usuario en Supabase Auth, crea su profile.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, ''), '@', 1), 'Usuario'),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'shop_owner')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 1) shops  (tiendas / talleres)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shops (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  public_key       TEXT NOT NULL UNIQUE DEFAULT ('dk_' || encode(gen_random_bytes(18), 'hex')),

  -- Perfil / contacto
  site_domains     TEXT[] NOT NULL DEFAULT '{}',
  site_url         TEXT,
  phone            TEXT,
  whatsapp_phone   TEXT,
  email            TEXT,
  address          TEXT,
  city             TEXT,
  country_code     TEXT,
  timezone         TEXT NOT NULL DEFAULT 'Europe/Madrid',

  -- Configuración de agenda
  slot_minutes         INTEGER NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 5 AND 480),
  capacity             INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 100),
  min_notice_minutes   INTEGER NOT NULL DEFAULT 60 CHECK (min_notice_minutes >= 0),
  booking_horizon_days INTEGER NOT NULL DEFAULT 60 CHECK (booking_horizon_days BETWEEN 1 AND 365),
  services             JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Integraciones telefonía / IA
  zadarma_sip      TEXT,
  zadarma_did      TEXT,
  retell_agent_id  TEXT,
  retell_did       TEXT,
  retell_api_key   TEXT,

  -- Google Calendar (OAuth por taller)
  google_calendar_id               TEXT,
  google_calendar_refresh_token    TEXT,          -- sensible: solo service_role / políticas estrictas
  google_calendar_access_token     TEXT,          -- sensible
  google_calendar_token_expiry     TIMESTAMPTZ,
  google_calendar_connected_email  TEXT,
  google_calendar_sync_enabled     BOOLEAN NOT NULL DEFAULT false,

  settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shops_status_idx ON public.shops (status);
CREATE INDEX IF NOT EXISTS shops_retell_agent_idx
  ON public.shops (retell_agent_id) WHERE retell_agent_id IS NOT NULL;

DROP TRIGGER IF EXISTS shops_set_updated_at ON public.shops;
CREATE TRIGGER shops_set_updated_at
  BEFORE UPDATE ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- shop_members  (relación usuario ↔ taller; base del RLS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_members (
  shop_id    UUID NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'owner'
             CHECK (role IN ('owner', 'manager', 'mechanic')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, user_id)
);

CREATE INDEX IF NOT EXISTS shop_members_user_idx ON public.shop_members (user_id);

-- ---------------------------------------------------------------------------
-- 2) appointments  (citas / reservas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  reference        TEXT NOT NULL UNIQUE DEFAULT (
                     'APT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
                   ),

  customer_name    TEXT NOT NULL,
  customer_phone   TEXT NOT NULL,
  customer_email   TEXT,
  vehicle_make     TEXT,
  vehicle_model    TEXT,
  vehicle_year     INTEGER,
  vehicle_plate    TEXT,
  service_type     TEXT,
  notes            TEXT,

  scheduled_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 1440),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'no_show')),
  price_estimate   NUMERIC(10, 2),
  source           TEXT NOT NULL DEFAULT 'hostinger'
                   CHECK (source IN ('hostinger', 'dashboard', 'phone', 'walk_in', 'api', 'retell')),
  source_url       TEXT,
  external_ref     TEXT,

  -- Enlace con el evento de Google Calendar
  google_event_id  TEXT,

  accepted_at      TIMESTAMPTZ,
  accepted_by      UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  completed_at     TIMESTAMPTZ,
  cancelled_reason TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointments_shop_scheduled_idx
  ON public.appointments (shop_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS appointments_shop_status_idx
  ON public.appointments (shop_id, status);
CREATE INDEX IF NOT EXISTS appointments_customer_phone_idx
  ON public.appointments (customer_phone);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_external_ref_idx
  ON public.appointments (external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_google_event_idx
  ON public.appointments (google_event_id) WHERE google_event_id IS NOT NULL;

DROP TRIGGER IF EXISTS appointments_set_updated_at ON public.appointments;
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 3) RLS — helpers + políticas
-- =============================================================================

-- ¿El usuario autenticado es Super Admin?
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.role = 'super_admin'
       AND p.status = 'active'
  );
$$;

-- ¿El usuario pertenece a este taller?
CREATE OR REPLACE FUNCTION public.is_shop_member(p_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.shop_members m
     WHERE m.shop_id = p_shop_id
       AND m.user_id = auth.uid()
  );
$$;

-- ¿Es owner/manager del taller? (puede escribir configuración sensible)
CREATE OR REPLACE FUNCTION public.is_shop_manager(p_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.shop_members m
     WHERE m.shop_id = p_shop_id
       AND m.user_id = auth.uid()
       AND m.role IN ('owner', 'manager')
  )
  OR public.is_super_admin();
$$;

-- ---- profiles ----
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_update_own_or_admin
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.is_super_admin())
  WITH CHECK (id = auth.uid() OR public.is_super_admin());

-- ---- shops ----
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shops_select_member_or_admin ON public.shops;
CREATE POLICY shops_select_member_or_admin
  ON public.shops FOR SELECT
  TO authenticated
  USING (public.is_shop_member(id) OR public.is_super_admin());

DROP POLICY IF EXISTS shops_insert_admin ON public.shops;
CREATE POLICY shops_insert_admin
  ON public.shops FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS shops_update_manager_or_admin ON public.shops;
CREATE POLICY shops_update_manager_or_admin
  ON public.shops FOR UPDATE
  TO authenticated
  USING (public.is_shop_manager(id))
  WITH CHECK (public.is_shop_manager(id));

DROP POLICY IF EXISTS shops_delete_admin ON public.shops;
CREATE POLICY shops_delete_admin
  ON public.shops FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- ---- shop_members ----
ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_members_select_member_or_admin ON public.shop_members;
CREATE POLICY shop_members_select_member_or_admin
  ON public.shop_members FOR SELECT
  TO authenticated
  USING (public.is_shop_member(shop_id) OR public.is_super_admin());

DROP POLICY IF EXISTS shop_members_write_manager_or_admin ON public.shop_members;
CREATE POLICY shop_members_write_manager_or_admin
  ON public.shop_members FOR ALL
  TO authenticated
  USING (public.is_shop_manager(shop_id))
  WITH CHECK (public.is_shop_manager(shop_id));

-- ---- appointments ----
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_select_member_or_admin ON public.appointments;
CREATE POLICY appointments_select_member_or_admin
  ON public.appointments FOR SELECT
  TO authenticated
  USING (public.is_shop_member(shop_id) OR public.is_super_admin());

DROP POLICY IF EXISTS appointments_insert_member_or_admin ON public.appointments;
CREATE POLICY appointments_insert_member_or_admin
  ON public.appointments FOR INSERT
  TO authenticated
  WITH CHECK (public.is_shop_member(shop_id) OR public.is_super_admin());

DROP POLICY IF EXISTS appointments_update_member_or_admin ON public.appointments;
CREATE POLICY appointments_update_member_or_admin
  ON public.appointments FOR UPDATE
  TO authenticated
  USING (public.is_shop_member(shop_id) OR public.is_super_admin())
  WITH CHECK (public.is_shop_member(shop_id) OR public.is_super_admin());

DROP POLICY IF EXISTS appointments_delete_manager_or_admin ON public.appointments;
CREATE POLICY appointments_delete_manager_or_admin
  ON public.appointments FOR DELETE
  TO authenticated
  USING (public.is_shop_manager(shop_id));

-- ---------------------------------------------------------------------------
-- Nota de seguridad (tokens Google / Retell):
-- Las columnas google_calendar_*_token y retell_api_key quedan en `shops`.
-- Con RLS, solo miembros del taller o el Super Admin pueden leerlas vía anon key.
-- Para máxima seguridad, lee/escribe esos campos solo con SUPABASE_SERVICE_ROLE_KEY
-- desde el backend de DerteApp (server/lib/supabase.js → getSupabaseAdmin()).
-- ---------------------------------------------------------------------------

-- Listo. Comprueba en Table Editor: profiles, shops, shop_members, appointments
-- con RLS = Enabled.
