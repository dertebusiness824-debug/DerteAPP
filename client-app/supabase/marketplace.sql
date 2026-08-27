-- =============================================================================
-- DerteApp Marketplace (PWA B2C) · esquema para Supabase — ADITIVO E IDEMPOTENTE
--
-- Pegar y ejecutar en: Supabase → SQL Editor → New query → Run.
-- Se puede re-ejecutar sin error.
--
-- REGLA DE ORO: este script NO modifica ninguna tabla del panel B2B.
--   · No añade ni borra columnas de `shops`, `appointments` o `urgencias`.
--   · Solo crea objetos nuevos con el prefijo `marketplace_`.
--   · Los únicos añadidos sobre tablas existentes son triggers de espejo
--     (`AFTER` + a prueba de excepciones) que copian datos hacia las tablas
--     nuevas. Si fallan, la escritura del panel B2B continúa intacta.
--   · La única relajación de una restricción existente es permitir el rol
--     'customer' en `profiles.role` (permisiva: nada de lo que ya funciona
--     cambia de comportamiento).
--
-- Para desinstalar por completo, ver `marketplace_uninstall.sql`.
--
-- Flujo de datos:
--   shops (B2B)          --trigger-->  marketplace_shop_listings   (lectura pública)
--   business_hours (B2B) --trigger-->  marketplace_shop_hours      (lectura pública)
--   appointments (B2B)   <--RPC-----   marketplace_create_booking  (cliente PWA)
--   appointments (B2B)   --trigger-->  marketplace_bookings.status (tiempo real)
--   urgencias (B2B)      <--RPC-----   marketplace_create_urgent_request
--   urgencias (B2B)      --trigger-->  marketplace_urgent_requests.status
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 0) Utilidades propias del marketplace
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

/* Identidad del cliente autenticado. Devuelve NULL fuera de Supabase Auth. */
CREATE OR REPLACE FUNCTION public.marketplace_current_customer()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN auth.uid();
EXCEPTION
  WHEN OTHERS THEN RETURN NULL;
END;
$$;

/* Permite el rol 'customer' en profiles (ampliación permisiva del CHECK). */
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RETURN;
  END IF;

  SELECT conname INTO v_constraint
    FROM pg_constraint
   WHERE conrelid = 'public.profiles'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%shop_owner%'
   LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_constraint);
  END IF;

  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('shop_owner', 'super_admin', 'customer'));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'marketplace: no se pudo ampliar profiles.role (%). Continuando.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Escaparate público de talleres (espejo de `shops`)
--
-- `shops` guarda credenciales (Zadarma, Retell, Google) y por eso nunca se
-- expone al público. Esta tabla replica solo las columnas publicables y añade
-- los campos propios del marketplace (geolocalización, rating, urgencias 24h).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketplace_shop_listings (
  shop_id              UUID PRIMARY KEY REFERENCES public.shops (id) ON DELETE CASCADE,

  -- Espejo de shops (lo mantiene el trigger; no editar a mano).
  name                 TEXT NOT NULL DEFAULT '',
  slug                 TEXT,
  public_key           TEXT,
  phone                TEXT,
  whatsapp_phone       TEXT,
  email                TEXT,
  address              TEXT,
  city                 TEXT,
  country_code         TEXT,
  timezone             TEXT NOT NULL DEFAULT 'Europe/Madrid',
  website_url          TEXT,
  slot_minutes         INTEGER NOT NULL DEFAULT 60,
  capacity             INTEGER NOT NULL DEFAULT 1,
  min_notice_minutes   INTEGER NOT NULL DEFAULT 60,
  booking_horizon_days INTEGER NOT NULL DEFAULT 60,
  services             JSONB NOT NULL DEFAULT '[]'::jsonb,
  shop_status          TEXT NOT NULL DEFAULT 'active',

  -- Campos propios del marketplace (el trigger no los sobrescribe salvo que
  -- lleguen dentro de shops.settings->'marketplace').
  is_listed            BOOLEAN NOT NULL DEFAULT true,
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,
  neighborhood         TEXT,
  headline             TEXT,
  description          TEXT,
  cover_image_url      TEXT,
  accepts_urgent_24h   BOOLEAN NOT NULL DEFAULT false,
  urgent_notes         TEXT,
  rating_avg           NUMERIC(3, 2) NOT NULL DEFAULT 0,
  rating_count         INTEGER NOT NULL DEFAULT 0,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_shop_listings_city_idx
  ON public.marketplace_shop_listings (lower(city)) WHERE is_listed;
CREATE INDEX IF NOT EXISTS marketplace_shop_listings_geo_idx
  ON public.marketplace_shop_listings (latitude, longitude) WHERE is_listed;
CREATE INDEX IF NOT EXISTS marketplace_shop_listings_urgent_idx
  ON public.marketplace_shop_listings (accepts_urgent_24h) WHERE is_listed;

DROP TRIGGER IF EXISTS marketplace_shop_listings_touch ON public.marketplace_shop_listings;
CREATE TRIGGER marketplace_shop_listings_touch
  BEFORE UPDATE ON public.marketplace_shop_listings
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_touch_updated_at();

-- Horario semanal publicable (espejo de business_hours cuando existe).
CREATE TABLE IF NOT EXISTS public.marketplace_shop_hours (
  shop_id     UUID NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_closed   BOOLEAN NOT NULL DEFAULT false,
  open_time   TIME,
  close_time  TIME,
  break_start TIME,
  break_end   TIME,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, weekday)
);

-- Tarifas orientativas por servicio.
CREATE TABLE IF NOT EXISTS public.marketplace_shop_services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  price_from       NUMERIC(10, 2),
  price_to         NUMERIC(10, 2),
  currency         TEXT NOT NULL DEFAULT 'EUR',
  duration_minutes INTEGER,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, slug)
);

CREATE INDEX IF NOT EXISTS marketplace_shop_services_shop_idx
  ON public.marketplace_shop_services (shop_id, sort_order) WHERE is_active;

DROP TRIGGER IF EXISTS marketplace_shop_services_touch ON public.marketplace_shop_services;
CREATE TRIGGER marketplace_shop_services_touch
  BEFORE UPDATE ON public.marketplace_shop_services
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Sincronización shops → marketplace_shop_listings
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_sync_shop_listing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta JSONB := COALESCE(NEW.settings -> 'marketplace', '{}'::jsonb);
BEGIN
  INSERT INTO public.marketplace_shop_listings AS l (
    shop_id, name, slug, public_key, phone, whatsapp_phone, email,
    address, city, country_code, timezone, website_url,
    slot_minutes, capacity, min_notice_minutes, booking_horizon_days,
    services, shop_status,
    is_listed, latitude, longitude, neighborhood, headline, description,
    cover_image_url, accepts_urgent_24h, urgent_notes
  )
  VALUES (
    NEW.id, NEW.name, NEW.slug, NEW.public_key, NEW.phone, NEW.whatsapp_phone, NEW.email,
    NEW.address, NEW.city, NEW.country_code, COALESCE(NEW.timezone, 'Europe/Madrid'), NEW.website_url,
    NEW.slot_minutes, NEW.capacity, NEW.min_notice_minutes, NEW.booking_horizon_days,
    COALESCE(NEW.services, '[]'::jsonb), NEW.status,
    COALESCE((v_meta ->> 'is_listed')::boolean, true),
    (v_meta ->> 'latitude')::double precision,
    (v_meta ->> 'longitude')::double precision,
    NULLIF(v_meta ->> 'neighborhood', ''),
    NULLIF(v_meta ->> 'headline', ''),
    NULLIF(v_meta ->> 'description', ''),
    NULLIF(v_meta ->> 'cover_image_url', ''),
    COALESCE((v_meta ->> 'accepts_urgent_24h')::boolean, false),
    NULLIF(v_meta ->> 'urgent_notes', '')
  )
  ON CONFLICT (shop_id) DO UPDATE SET
    name                 = EXCLUDED.name,
    slug                 = EXCLUDED.slug,
    public_key           = EXCLUDED.public_key,
    phone                = EXCLUDED.phone,
    whatsapp_phone       = EXCLUDED.whatsapp_phone,
    email                = EXCLUDED.email,
    address              = EXCLUDED.address,
    city                 = EXCLUDED.city,
    country_code         = EXCLUDED.country_code,
    timezone             = EXCLUDED.timezone,
    website_url          = EXCLUDED.website_url,
    slot_minutes         = EXCLUDED.slot_minutes,
    capacity             = EXCLUDED.capacity,
    min_notice_minutes   = EXCLUDED.min_notice_minutes,
    booking_horizon_days = EXCLUDED.booking_horizon_days,
    services             = EXCLUDED.services,
    shop_status          = EXCLUDED.shop_status,
    -- Campos del marketplace: solo se tocan si shops.settings los trae.
    is_listed            = COALESCE((v_meta ->> 'is_listed')::boolean, l.is_listed),
    latitude             = COALESCE((v_meta ->> 'latitude')::double precision, l.latitude),
    longitude            = COALESCE((v_meta ->> 'longitude')::double precision, l.longitude),
    neighborhood         = COALESCE(NULLIF(v_meta ->> 'neighborhood', ''), l.neighborhood),
    headline             = COALESCE(NULLIF(v_meta ->> 'headline', ''), l.headline),
    description          = COALESCE(NULLIF(v_meta ->> 'description', ''), l.description),
    cover_image_url      = COALESCE(NULLIF(v_meta ->> 'cover_image_url', ''), l.cover_image_url),
    accepts_urgent_24h   = COALESCE((v_meta ->> 'accepts_urgent_24h')::boolean, l.accepts_urgent_24h),
    urgent_notes         = COALESCE(NULLIF(v_meta ->> 'urgent_notes', ''), l.urgent_notes),
    updated_at           = now();

  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    -- Nunca romper el alta/edición de un taller en el panel B2B.
    RAISE WARNING 'marketplace_sync_shop_listing: %', SQLERRM;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_sync_shop_listing_trg ON public.shops;
CREATE TRIGGER marketplace_sync_shop_listing_trg
  AFTER INSERT OR UPDATE ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_sync_shop_listing();

-- Backfill de los talleres ya registrados.
INSERT INTO public.marketplace_shop_listings (
  shop_id, name, slug, public_key, phone, whatsapp_phone, email,
  address, city, country_code, timezone, website_url,
  slot_minutes, capacity, min_notice_minutes, booking_horizon_days,
  services, shop_status,
  is_listed, latitude, longitude, neighborhood, headline, description,
  cover_image_url, accepts_urgent_24h, urgent_notes
)
SELECT
  s.id, s.name, s.slug, s.public_key, s.phone, s.whatsapp_phone, s.email,
  s.address, s.city, s.country_code, COALESCE(s.timezone, 'Europe/Madrid'), s.website_url,
  s.slot_minutes, s.capacity, s.min_notice_minutes, s.booking_horizon_days,
  COALESCE(s.services, '[]'::jsonb), s.status,
  COALESCE((s.settings -> 'marketplace' ->> 'is_listed')::boolean, true),
  (s.settings -> 'marketplace' ->> 'latitude')::double precision,
  (s.settings -> 'marketplace' ->> 'longitude')::double precision,
  NULLIF(s.settings -> 'marketplace' ->> 'neighborhood', ''),
  NULLIF(s.settings -> 'marketplace' ->> 'headline', ''),
  NULLIF(s.settings -> 'marketplace' ->> 'description', ''),
  NULLIF(s.settings -> 'marketplace' ->> 'cover_image_url', ''),
  COALESCE((s.settings -> 'marketplace' ->> 'accepts_urgent_24h')::boolean, false),
  NULLIF(s.settings -> 'marketplace' ->> 'urgent_notes', '')
FROM public.shops s
ON CONFLICT (shop_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Sincronización business_hours → marketplace_shop_hours (si existe)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.business_hours') IS NULL THEN
    RAISE NOTICE 'marketplace: no existe business_hours; los horarios se gestionan en marketplace_shop_hours.';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.marketplace_sync_shop_hours()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.marketplace_shop_hours
       WHERE shop_id = OLD.shop_id AND weekday = OLD.weekday;
      RETURN NULL;
    END IF;

    INSERT INTO public.marketplace_shop_hours
      (shop_id, weekday, is_closed, open_time, close_time, break_start, break_end, updated_at)
    VALUES
      (NEW.shop_id, NEW.weekday, NEW.is_closed, NEW.open_time, NEW.close_time,
       NEW.break_start, NEW.break_end, now())
    ON CONFLICT (shop_id, weekday) DO UPDATE SET
      is_closed   = EXCLUDED.is_closed,
      open_time   = EXCLUDED.open_time,
      close_time  = EXCLUDED.close_time,
      break_start = EXCLUDED.break_start,
      break_end   = EXCLUDED.break_end,
      updated_at  = now();
    RETURN NULL;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'marketplace_sync_shop_hours: %', SQLERRM;
      RETURN NULL;
  END;
  $fn$;

  DROP TRIGGER IF EXISTS marketplace_sync_shop_hours_trg ON public.business_hours;
  CREATE TRIGGER marketplace_sync_shop_hours_trg
    AFTER INSERT OR UPDATE OR DELETE ON public.business_hours
    FOR EACH ROW EXECUTE FUNCTION public.marketplace_sync_shop_hours();

  INSERT INTO public.marketplace_shop_hours
    (shop_id, weekday, is_closed, open_time, close_time, break_start, break_end)
  SELECT shop_id, weekday, is_closed, open_time, close_time, break_start, break_end
    FROM public.business_hours
  ON CONFLICT (shop_id, weekday) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Clientes finales, vehículos y favoritos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketplace_customers (
  id            UUID PRIMARY KEY,
  full_name     TEXT NOT NULL DEFAULT '',
  email         TEXT,
  phone         TEXT,
  city          TEXT,
  avatar_hue    INTEGER NOT NULL DEFAULT 210,
  notify_email  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* En Supabase el id del cliente es el de auth.users. Fuera de Supabase la
   tabla funciona igual, solo sin la clave ajena. */
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'marketplace_customers_auth_user_fk'
          AND conrelid = 'public.marketplace_customers'::regclass
     )
  THEN
    ALTER TABLE public.marketplace_customers
      ADD CONSTRAINT marketplace_customers_auth_user_fk
      FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'marketplace: no se pudo enlazar marketplace_customers con auth.users (%).', SQLERRM;
END $$;

DROP TRIGGER IF EXISTS marketplace_customers_touch ON public.marketplace_customers;
CREATE TRIGGER marketplace_customers_touch
  BEFORE UPDATE ON public.marketplace_customers
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_vehicles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.marketplace_customers (id) ON DELETE CASCADE,
  make        TEXT NOT NULL,
  model       TEXT NOT NULL,
  year        INTEGER CHECK (year IS NULL OR year BETWEEN 1900 AND 2100),
  plate       TEXT NOT NULL,
  fuel        TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_vehicles_owner_idx
  ON public.marketplace_vehicles (owner_id, created_at DESC);

DROP TRIGGER IF EXISTS marketplace_vehicles_touch ON public.marketplace_vehicles;
CREATE TRIGGER marketplace_vehicles_touch
  BEFORE UPDATE ON public.marketplace_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_favorites (
  owner_id   UUID NOT NULL REFERENCES public.marketplace_customers (id) ON DELETE CASCADE,
  shop_id    UUID NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, shop_id)
);

-- ---------------------------------------------------------------------------
-- 5) Opiniones de clientes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketplace_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.marketplace_customers (id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT 'Cliente verificado',
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  service_tag TEXT,
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_reviews_shop_idx
  ON public.marketplace_reviews (shop_id, created_at DESC) WHERE status = 'published';

/* Mantiene rating_avg / rating_count del escaparate. */
CREATE OR REPLACE FUNCTION public.marketplace_refresh_shop_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop UUID := COALESCE(NEW.shop_id, OLD.shop_id);
BEGIN
  UPDATE public.marketplace_shop_listings l
     SET rating_avg = COALESCE(agg.avg_rating, 0),
         rating_count = COALESCE(agg.total, 0)
    FROM (
      SELECT round(avg(rating)::numeric, 2) AS avg_rating, count(*) AS total
        FROM public.marketplace_reviews
       WHERE shop_id = v_shop AND status = 'published'
    ) agg
   WHERE l.shop_id = v_shop;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_reviews_rating_trg ON public.marketplace_reviews;
CREATE TRIGGER marketplace_reviews_rating_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_refresh_shop_rating();

-- ---------------------------------------------------------------------------
-- 6) Reservas del marketplace (espejo con estado en tiempo real)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketplace_bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id   UUID UNIQUE REFERENCES public.appointments (id) ON DELETE SET NULL,
  shop_id          UUID NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES public.marketplace_customers (id) ON DELETE CASCADE,
  -- Copia del taller en el momento de reservar: el resguardo del cliente debe
  -- seguir siendo legible aunque el taller deje de estar publicado.
  shop_name        TEXT NOT NULL DEFAULT '',
  shop_phone       TEXT,
  shop_address     TEXT,
  timezone         TEXT NOT NULL DEFAULT 'Europe/Madrid',
  reference        TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  scheduled_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  service_name     TEXT,
  price_estimate   NUMERIC(10, 2),
  customer_name    TEXT NOT NULL DEFAULT '',
  customer_phone   TEXT NOT NULL DEFAULT '',
  vehicle_make     TEXT,
  vehicle_model    TEXT,
  vehicle_plate    TEXT,
  vehicle_year     INTEGER,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Actualización de instalaciones anteriores.
ALTER TABLE public.marketplace_bookings
  ADD COLUMN IF NOT EXISTS shop_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS shop_phone TEXT,
  ADD COLUMN IF NOT EXISTS shop_address TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Madrid';

CREATE INDEX IF NOT EXISTS marketplace_bookings_customer_idx
  ON public.marketplace_bookings (customer_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_bookings_shop_idx
  ON public.marketplace_bookings (shop_id, scheduled_at DESC);

DROP TRIGGER IF EXISTS marketplace_bookings_touch ON public.marketplace_bookings;
CREATE TRIGGER marketplace_bookings_touch
  BEFORE UPDATE ON public.marketplace_bookings
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_urgent_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  urgencia_id    UUID,
  shop_id        UUID NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES public.marketplace_customers (id) ON DELETE CASCADE,
  shop_name      TEXT NOT NULL DEFAULT '',
  shop_phone     TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  title          TEXT NOT NULL DEFAULT 'Solicitud de servicio urgente',
  reason         TEXT,
  location_text  TEXT,
  customer_name  TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  vehicle_make   TEXT,
  vehicle_model  TEXT,
  vehicle_plate  TEXT,
  accepted_at    TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.marketplace_urgent_requests
  ADD COLUMN IF NOT EXISTS shop_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS shop_phone TEXT;

CREATE INDEX IF NOT EXISTS marketplace_urgent_requests_customer_idx
  ON public.marketplace_urgent_requests (customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_urgent_requests_urgencia_idx
  ON public.marketplace_urgent_requests (urgencia_id) WHERE urgencia_id IS NOT NULL;

DROP TRIGGER IF EXISTS marketplace_urgent_requests_touch ON public.marketplace_urgent_requests;
CREATE TRIGGER marketplace_urgent_requests_touch
  BEFORE UPDATE ON public.marketplace_urgent_requests
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7) Triggers de espejo: el estado del panel B2B llega al cliente
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_mirror_appointment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.marketplace_bookings
     SET status = NEW.status,
         scheduled_at = NEW.scheduled_at,
         duration_minutes = NEW.duration_minutes,
         service_name = COALESCE(NEW.service_type, service_name),
         price_estimate = COALESCE(NEW.price_estimate, price_estimate),
         updated_at = now()
   WHERE appointment_id = NEW.id;
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'marketplace_mirror_appointment_status: %', SQLERRM;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_mirror_appointment_trg ON public.appointments;
CREATE TRIGGER marketplace_mirror_appointment_trg
  AFTER UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_mirror_appointment_status();

DO $$
BEGIN
  IF to_regclass('public.urgencias') IS NULL THEN
    RAISE NOTICE 'marketplace: no existe urgencias; las solicitudes urgentes solo se guardan en marketplace_urgent_requests.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'urgencias' AND column_name = 'status'
  ) THEN
    RAISE NOTICE 'marketplace: urgencias sin columna status (falta la migración 018); no se instala el espejo.';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.marketplace_mirror_urgencia_status()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
  BEGIN
    UPDATE public.marketplace_urgent_requests
       SET status = NEW.status,
           accepted_at = NEW.accepted_at,
           cancelled_at = NEW.cancelled_at,
           updated_at = now()
     WHERE urgencia_id = NEW.id;
    RETURN NULL;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'marketplace_mirror_urgencia_status: %', SQLERRM;
      RETURN NULL;
  END;
  $fn$;

  DROP TRIGGER IF EXISTS marketplace_mirror_urgencia_trg ON public.urgencias;
  CREATE TRIGGER marketplace_mirror_urgencia_trg
    AFTER UPDATE ON public.urgencias
    FOR EACH ROW EXECUTE FUNCTION public.marketplace_mirror_urgencia_status();
END $$;

-- ---------------------------------------------------------------------------
-- 8) RPC · carga de huecos ocupados (agregado, sin datos personales)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_slot_load(
  p_shop_id UUID,
  p_from    TIMESTAMPTZ,
  p_to      TIMESTAMPTZ
)
RETURNS TABLE (slot_start TIMESTAMPTZ, booked BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.scheduled_at AS slot_start, count(*) AS booked
    FROM public.appointments a
    JOIN public.marketplace_shop_listings l ON l.shop_id = a.shop_id AND l.is_listed
   WHERE a.shop_id = p_shop_id
     AND a.scheduled_at >= p_from
     AND a.scheduled_at < p_to
     AND a.status NOT IN ('cancelled', 'no_show')
   GROUP BY a.scheduled_at;
$$;

-- ---------------------------------------------------------------------------
-- 9) RPC · alta de cliente (perfil propio)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_ensure_customer(
  p_full_name TEXT DEFAULT NULL,
  p_phone     TEXT DEFAULT NULL,
  p_email     TEXT DEFAULT NULL,
  p_city      TEXT DEFAULT NULL
)
RETURNS public.marketplace_customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public.marketplace_current_customer();
  v_row public.marketplace_customers;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING HINT = 'Inicia sesión para continuar';
  END IF;

  INSERT INTO public.marketplace_customers AS c (id, full_name, phone, email, city)
  VALUES (v_uid, COALESCE(NULLIF(p_full_name, ''), ''), NULLIF(p_phone, ''), NULLIF(p_email, ''), NULLIF(p_city, ''))
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(p_full_name, ''), c.full_name),
    phone     = COALESCE(NULLIF(p_phone, ''), c.phone),
    email     = COALESCE(NULLIF(p_email, ''), c.email),
    city      = COALESCE(NULLIF(p_city, ''), c.city),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10) RPC · crear reserva (inyecta en `appointments` del panel B2B)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_create_booking(
  p_shop_id          UUID,
  p_scheduled_at     TIMESTAMPTZ,
  p_customer_name    TEXT,
  p_customer_phone   TEXT,
  p_service_name     TEXT DEFAULT NULL,
  p_customer_email   TEXT DEFAULT NULL,
  p_vehicle_make     TEXT DEFAULT NULL,
  p_vehicle_model    TEXT DEFAULT NULL,
  p_vehicle_plate    TEXT DEFAULT NULL,
  p_vehicle_year     INTEGER DEFAULT NULL,
  p_notes            TEXT DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT NULL,
  p_price_estimate   NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := public.marketplace_current_customer();
  v_listing   public.marketplace_shop_listings;
  v_duration  INTEGER;
  v_booked    INTEGER;
  v_reference TEXT;
  v_status    TEXT;
  v_apt_id    UUID;
  v_booking   public.marketplace_bookings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING HINT = 'Inicia sesión para reservar';
  END IF;

  IF length(coalesce(trim(p_customer_name), '')) < 2 THEN
    RAISE EXCEPTION 'invalid_name' USING HINT = 'Indica tu nombre completo';
  END IF;
  IF length(coalesce(trim(p_customer_phone), '')) < 6 THEN
    RAISE EXCEPTION 'invalid_phone' USING HINT = 'Indica un teléfono de contacto válido';
  END IF;

  SELECT * INTO v_listing
    FROM public.marketplace_shop_listings
   WHERE shop_id = p_shop_id AND is_listed AND shop_status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_unavailable' USING HINT = 'Este taller no acepta reservas online ahora mismo';
  END IF;

  v_duration := GREATEST(COALESCE(p_duration_minutes, v_listing.slot_minutes), 5);

  IF p_scheduled_at < now() + make_interval(mins => v_listing.min_notice_minutes) THEN
    RAISE EXCEPTION 'too_soon'
      USING HINT = format('Este taller necesita al menos %s minutos de antelación', v_listing.min_notice_minutes);
  END IF;

  IF p_scheduled_at > now() + make_interval(days => v_listing.booking_horizon_days) THEN
    RAISE EXCEPTION 'too_far' USING HINT = 'Esa fecha está fuera del calendario del taller';
  END IF;

  SELECT count(*) INTO v_booked
    FROM public.appointments
   WHERE shop_id = p_shop_id
     AND scheduled_at = p_scheduled_at
     AND status NOT IN ('cancelled', 'no_show');

  IF v_booked >= v_listing.capacity THEN
    RAISE EXCEPTION 'slot_taken' USING HINT = 'Ese hueco acaba de ocuparse. Elige otra hora.';
  END IF;

  -- `reference` no tiene default en el esquema del panel: se genera aquí.
  v_reference := 'APT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  -- El panel B2B guarda las reservas como 'confirmed' (migración 013). En
  -- bases anteriores ese estado no existe todavía, así que se usa 'pending'.
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.appointments'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%confirmed%'
         ) THEN 'confirmed' ELSE 'pending' END
    INTO v_status;

  INSERT INTO public.appointments (
    shop_id, reference, customer_name, customer_phone, customer_email,
    vehicle_make, vehicle_model, vehicle_year, vehicle_plate,
    service_type, notes, scheduled_at, duration_minutes,
    status, price_estimate, source, source_url, accepted_at
  )
  VALUES (
    p_shop_id, v_reference, trim(p_customer_name), trim(p_customer_phone), NULLIF(p_customer_email, ''),
    NULLIF(p_vehicle_make, ''), NULLIF(p_vehicle_model, ''), p_vehicle_year, NULLIF(upper(p_vehicle_plate), ''),
    NULLIF(p_service_name, ''),
    trim(both E'\n' from COALESCE(p_notes, '') || E'\n' || 'Reserva creada desde el marketplace DerteApp (app de clientes).'),
    p_scheduled_at, v_duration,
    v_status, p_price_estimate, 'api', 'derteapp://marketplace',
    CASE WHEN v_status = 'confirmed' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_apt_id;

  INSERT INTO public.marketplace_bookings (
    appointment_id, shop_id, customer_id, shop_name, shop_phone, shop_address, timezone,
    reference, status, scheduled_at, duration_minutes,
    service_name, price_estimate, customer_name, customer_phone,
    vehicle_make, vehicle_model, vehicle_plate, vehicle_year, notes
  )
  VALUES (
    v_apt_id, p_shop_id, v_uid, v_listing.name,
    COALESCE(v_listing.phone, v_listing.whatsapp_phone), v_listing.address, v_listing.timezone,
    v_reference, v_status, p_scheduled_at, v_duration,
    NULLIF(p_service_name, ''), p_price_estimate, trim(p_customer_name), trim(p_customer_phone),
    NULLIF(p_vehicle_make, ''), NULLIF(p_vehicle_model, ''), NULLIF(upper(p_vehicle_plate), ''),
    p_vehicle_year, NULLIF(p_notes, '')
  )
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'appointment_id', v_apt_id,
    'reference', v_reference,
    'status', v_booking.status,
    'scheduled_at', v_booking.scheduled_at,
    'shop_name', v_listing.name,
    'shop_phone', v_listing.phone,
    'shop_address', v_listing.address,
    'timezone', v_listing.timezone
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 11) RPC · cancelar reserva propia
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_cancel_booking(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := public.marketplace_current_customer();
  v_booking public.marketplace_bookings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING HINT = 'Inicia sesión para gestionar tus citas';
  END IF;

  SELECT * INTO v_booking
    FROM public.marketplace_bookings
   WHERE id = p_booking_id AND customer_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found' USING HINT = 'No encontramos esa cita';
  END IF;

  IF v_booking.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'booking_not_cancellable' USING HINT = 'Esa cita ya está cerrada';
  END IF;

  IF v_booking.appointment_id IS NOT NULL THEN
    UPDATE public.appointments
       SET status = 'cancelled',
           cancelled_reason = 'Cancelada por el cliente desde el marketplace'
     WHERE id = v_booking.appointment_id;
  END IF;

  UPDATE public.marketplace_bookings
     SET status = 'cancelled', updated_at = now()
   WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status);
END;
$$;

-- ---------------------------------------------------------------------------
-- 12) RPC · asistencia urgente (entra en el panel de Urgencias del taller)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketplace_create_urgent_request(
  p_shop_id        UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT,
  p_reason         TEXT DEFAULT NULL,
  p_location_text  TEXT DEFAULT NULL,
  p_vehicle_make   TEXT DEFAULT NULL,
  p_vehicle_model  TEXT DEFAULT NULL,
  p_vehicle_plate  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := public.marketplace_current_customer();
  v_listing   public.marketplace_shop_listings;
  v_urgencia  UUID := NULL;
  v_request   public.marketplace_urgent_requests;
  v_title     TEXT := 'Solicitud de servicio urgente';
  v_reason    TEXT := COALESCE(NULLIF(trim(p_reason), ''), 'Consulta urgente');
  v_summary   TEXT;
  v_has_urg   BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING HINT = 'Inicia sesión para pedir asistencia urgente';
  END IF;
  IF length(coalesce(trim(p_customer_phone), '')) < 6 THEN
    RAISE EXCEPTION 'invalid_phone' USING HINT = 'Necesitamos un teléfono para que el taller te llame';
  END IF;

  SELECT * INTO v_listing
    FROM public.marketplace_shop_listings
   WHERE shop_id = p_shop_id AND is_listed AND shop_status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_unavailable' USING HINT = 'Este taller no está disponible ahora mismo';
  END IF;

  v_summary := format(
    'El cliente solicitó atención urgente desde la app de clientes. Vehículo: %s. Motivo: %s.%s',
    NULLIF(trim(concat_ws(' ', p_vehicle_make, p_vehicle_model, p_vehicle_plate)), ''),
    v_reason,
    CASE WHEN NULLIF(trim(p_location_text), '') IS NULL THEN ''
         ELSE ' Ubicación: ' || trim(p_location_text) || '.' END
  );

  SELECT to_regclass('public.urgencias') IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'urgencias' AND column_name = 'status'
         )
    INTO v_has_urg;

  IF v_has_urg THEN
    INSERT INTO public.urgencias (
      shop_id, external_ref, is_urgent, title, status,
      customer_name, customer_phone, vehicle_make, vehicle_model, vehicle_plate,
      reason, summary, called_at, source, raw
    )
    VALUES (
      p_shop_id, 'mkt_' || replace(gen_random_uuid()::text, '-', ''), TRUE, v_title, 'pending',
      NULLIF(trim(p_customer_name), ''), trim(p_customer_phone),
      NULLIF(p_vehicle_make, ''), NULLIF(p_vehicle_model, ''), NULLIF(upper(p_vehicle_plate), ''),
      v_reason, v_summary, now(), 'marketplace',
      jsonb_build_object(
        'origin', 'marketplace',
        'customer_id', v_uid,
        'location_text', NULLIF(trim(p_location_text), '')
      )
    )
    RETURNING id INTO v_urgencia;
  END IF;

  INSERT INTO public.marketplace_urgent_requests (
    urgencia_id, shop_id, customer_id, shop_name, shop_phone,
    status, title, reason, location_text,
    customer_name, customer_phone, vehicle_make, vehicle_model, vehicle_plate
  )
  VALUES (
    v_urgencia, p_shop_id, v_uid, v_listing.name,
    COALESCE(v_listing.phone, v_listing.whatsapp_phone),
    'pending', v_title, v_reason, NULLIF(trim(p_location_text), ''),
    COALESCE(NULLIF(trim(p_customer_name), ''), ''), trim(p_customer_phone),
    NULLIF(p_vehicle_make, ''), NULLIF(p_vehicle_model, ''), NULLIF(upper(p_vehicle_plate), '')
  )
  RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'urgencia_id', v_urgencia,
    'status', v_request.status,
    'shop_name', v_listing.name,
    'shop_phone', COALESCE(v_listing.phone, v_listing.whatsapp_phone),
    'reached_b2b_panel', v_urgencia IS NOT NULL
  );
END;
$$;

-- =============================================================================
-- 13) RLS
-- =============================================================================

ALTER TABLE public.marketplace_shop_listings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_shop_hours     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_shop_services  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_customers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_vehicles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_favorites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_bookings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_urgent_requests ENABLE ROW LEVEL SECURITY;

-- Catálogo público (solo talleres publicados y activos).
DROP POLICY IF EXISTS "marketplace_listings_public_read" ON public.marketplace_shop_listings;
CREATE POLICY "marketplace_listings_public_read"
  ON public.marketplace_shop_listings FOR SELECT
  USING (is_listed AND shop_status = 'active');

DROP POLICY IF EXISTS "marketplace_hours_public_read" ON public.marketplace_shop_hours;
CREATE POLICY "marketplace_hours_public_read"
  ON public.marketplace_shop_hours FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.marketplace_shop_listings l
     WHERE l.shop_id = marketplace_shop_hours.shop_id AND l.is_listed AND l.shop_status = 'active'
  ));

DROP POLICY IF EXISTS "marketplace_services_public_read" ON public.marketplace_shop_services;
CREATE POLICY "marketplace_services_public_read"
  ON public.marketplace_shop_services FOR SELECT
  USING (is_active AND EXISTS (
    SELECT 1 FROM public.marketplace_shop_listings l
     WHERE l.shop_id = marketplace_shop_services.shop_id AND l.is_listed AND l.shop_status = 'active'
  ));

DROP POLICY IF EXISTS "marketplace_reviews_public_read" ON public.marketplace_reviews;
CREATE POLICY "marketplace_reviews_public_read"
  ON public.marketplace_reviews FOR SELECT
  USING (status = 'published');

DROP POLICY IF EXISTS "marketplace_reviews_insert_own" ON public.marketplace_reviews;
CREATE POLICY "marketplace_reviews_insert_own"
  ON public.marketplace_reviews FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = public.marketplace_current_customer());

-- Datos personales: cada cliente solo ve y edita lo suyo.
DROP POLICY IF EXISTS "marketplace_customers_own" ON public.marketplace_customers;
CREATE POLICY "marketplace_customers_own"
  ON public.marketplace_customers FOR ALL
  TO authenticated
  USING (id = public.marketplace_current_customer())
  WITH CHECK (id = public.marketplace_current_customer());

DROP POLICY IF EXISTS "marketplace_vehicles_own" ON public.marketplace_vehicles;
CREATE POLICY "marketplace_vehicles_own"
  ON public.marketplace_vehicles FOR ALL
  TO authenticated
  USING (owner_id = public.marketplace_current_customer())
  WITH CHECK (owner_id = public.marketplace_current_customer());

DROP POLICY IF EXISTS "marketplace_favorites_own" ON public.marketplace_favorites;
CREATE POLICY "marketplace_favorites_own"
  ON public.marketplace_favorites FOR ALL
  TO authenticated
  USING (owner_id = public.marketplace_current_customer())
  WITH CHECK (owner_id = public.marketplace_current_customer());

-- Reservas: lectura propia (el alta y la cancelación pasan por los RPC).
DROP POLICY IF EXISTS "marketplace_bookings_read_own" ON public.marketplace_bookings;
CREATE POLICY "marketplace_bookings_read_own"
  ON public.marketplace_bookings FOR SELECT
  TO authenticated
  USING (customer_id = public.marketplace_current_customer());

DROP POLICY IF EXISTS "marketplace_urgent_read_own" ON public.marketplace_urgent_requests;
CREATE POLICY "marketplace_urgent_read_own"
  ON public.marketplace_urgent_requests FOR SELECT
  TO authenticated
  USING (customer_id = public.marketplace_current_customer());

-- =============================================================================
-- 14) Grants (roles de Supabase) y Realtime
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT SELECT ON public.marketplace_shop_listings, public.marketplace_shop_hours,
                    public.marketplace_shop_services, public.marketplace_reviews TO anon;
    GRANT EXECUTE ON FUNCTION public.marketplace_slot_load(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON public.marketplace_shop_listings, public.marketplace_shop_hours,
                    public.marketplace_shop_services TO authenticated;
    GRANT SELECT, INSERT ON public.marketplace_reviews TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_customers,
                    public.marketplace_vehicles, public.marketplace_favorites TO authenticated;
    GRANT SELECT ON public.marketplace_bookings, public.marketplace_urgent_requests TO authenticated;
    GRANT EXECUTE ON FUNCTION public.marketplace_slot_load(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.marketplace_ensure_customer(TEXT, TEXT, TEXT, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.marketplace_create_booking(
      UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, NUMERIC
    ) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.marketplace_cancel_booking(UUID) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.marketplace_create_urgent_request(
      UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
    ) TO authenticated;
  END IF;
END $$;

/* Realtime: el catálogo y el estado de las citas del cliente. REPLICA IDENTITY
   FULL para que los filtros por customer_id funcionen también en los UPDATE. */
ALTER TABLE public.marketplace_bookings REPLICA IDENTITY FULL;
ALTER TABLE public.marketplace_urgent_requests REPLICA IDENTITY FULL;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'marketplace: no existe la publicación supabase_realtime; omitido.';
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'marketplace_shop_listings',
    'marketplace_bookings',
    'marketplace_urgent_requests',
    'marketplace_reviews'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END $$;

-- Listo. Comprueba en Table Editor: marketplace_shop_listings (con RLS activo)
-- ya debería contener una fila por cada taller registrado en derteapp.
