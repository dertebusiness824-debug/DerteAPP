-- =============================================================================
-- DerteApp Marketplace · desinstalación limpia
--
-- Elimina TODO lo que instaló `marketplace.sql` y deja el panel B2B como estaba.
-- No toca `shops`, `appointments`, `urgencias` ni `business_hours`: solo quita
-- los triggers de espejo y los objetos con prefijo `marketplace_`.
-- =============================================================================

-- 1) Triggers añadidos sobre las tablas del panel B2B.
DROP TRIGGER IF EXISTS marketplace_sync_shop_listing_trg ON public.shops;
DROP TRIGGER IF EXISTS marketplace_mirror_appointment_trg ON public.appointments;

DO $$
BEGIN
  IF to_regclass('public.business_hours') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS marketplace_sync_shop_hours_trg ON public.business_hours;
  END IF;
  IF to_regclass('public.urgencias') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS marketplace_mirror_urgencia_trg ON public.urgencias;
  END IF;
END $$;

-- 2) RPC (declaran tipos compuestos de las tablas, así que van antes).
DROP FUNCTION IF EXISTS public.marketplace_create_booking(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, NUMERIC
);
DROP FUNCTION IF EXISTS public.marketplace_cancel_booking(UUID);
DROP FUNCTION IF EXISTS public.marketplace_create_urgent_request(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);
DROP FUNCTION IF EXISTS public.marketplace_ensure_customer(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.marketplace_slot_load(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

-- 3) Tablas del marketplace (se llevan consigo sus políticas y triggers).
-- 3) Tablas del marketplace (se llevan consigo sus políticas y triggers).
-- Primero quitamos políticas de shop_promotions que dependen del escaparate.
DO $$
BEGIN
  IF to_regclass('public.shop_promotions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "shop_promotions_public_read" ON public.shop_promotions';
    EXECUTE 'DROP POLICY IF EXISTS "shop_promotions_super_admin_all" ON public.shop_promotions';
  END IF;
END $$;

DROP TABLE IF EXISTS public.marketplace_urgent_requests;
DROP TABLE IF EXISTS public.marketplace_bookings;
DROP TABLE IF EXISTS public.marketplace_reviews;
DROP TABLE IF EXISTS public.marketplace_favorites;
DROP TABLE IF EXISTS public.marketplace_vehicles;
DROP TABLE IF EXISTS public.marketplace_customers;
DROP TABLE IF EXISTS public.marketplace_shop_services;
DROP TABLE IF EXISTS public.marketplace_shop_hours;
DROP TABLE IF EXISTS public.marketplace_shop_listings;
-- Las ofertas viven en `shop_promotions` (migración B2B 021). No las borramos
-- aquí para no romper el panel de Super Admin; el uninstall solo limpia el
-- espejo marketplace_*.

-- 4) Funciones de sincronización y utilidades.
DROP FUNCTION IF EXISTS public.marketplace_sync_shop_listing();
DROP FUNCTION IF EXISTS public.marketplace_sync_shop_hours();
DROP FUNCTION IF EXISTS public.marketplace_mirror_appointment_status();
DROP FUNCTION IF EXISTS public.marketplace_mirror_urgencia_status();
DROP FUNCTION IF EXISTS public.marketplace_refresh_shop_rating();
DROP FUNCTION IF EXISTS public.marketplace_current_customer();
DROP FUNCTION IF EXISTS public.marketplace_touch_updated_at();
-- `shop_promotions` y su trigger se quedan: pertenecen al panel B2B (migración 021).

-- El rol 'customer' de profiles.role se deja permitido a propósito: revertirlo
-- rompería a cualquier cliente final ya registrado. Para revertirlo a mano:
--   ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
--   ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
--     CHECK (role IN ('shop_owner', 'super_admin'));
