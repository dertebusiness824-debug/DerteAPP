-- =============================================================================
-- Segundo escenario: proyecto de Supabase creado solo con `supabase/schema.sql`
-- (profiles / shops / shop_members / appointments), sin las tablas extra del
-- panel autoalojado (business_hours, urgencias, call_logs).
--
-- Aquí se comprueba que marketplace.sql degrada con elegancia: el catálogo y
-- las reservas funcionan, y la asistencia urgente se guarda igualmente aunque
-- no exista la tabla `urgencias` del panel.
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  ASSERT to_regclass('public.business_hours') IS NULL, 'este escenario asume que no hay business_hours';
  ASSERT to_regclass('public.urgencias') IS NULL, 'este escenario asume que no hay urgencias';
  ASSERT to_regclass('public.marketplace_shop_listings') IS NOT NULL, 'no se instaló el escaparate';
  ASSERT to_regclass('public.marketplace_shop_hours') IS NOT NULL, 'no se instaló la tabla de horarios';
  RAISE NOTICE 'OK · instalación sobre un Supabase recién creado';
END $$;

DO $$
DECLARE
  v_shop_id UUID;
  v_user_id UUID;
  v_listing public.marketplace_shop_listings;
  v_booking JSONB;
  v_urgent JSONB;
BEGIN
  INSERT INTO public.shops (name, slug, city, phone, timezone, capacity, min_notice_minutes, settings)
  VALUES ('Talleres Nervión', 'talleres-nervion', 'Sevilla', '+34954000001', 'Europe/Madrid', 1, 30,
          jsonb_build_object('marketplace', jsonb_build_object(
            'latitude', 37.3826, 'longitude', -5.9750, 'accepts_urgent_24h', true)))
  RETURNING id INTO v_shop_id;

  SELECT * INTO v_listing FROM public.marketplace_shop_listings WHERE shop_id = v_shop_id;
  ASSERT v_listing.city = 'Sevilla', 'el escaparate no se sincronizó';
  ASSERT v_listing.accepts_urgent_24h, 'no se propagó accepts_urgent_24h';

  -- El horario se puede publicar directamente en la tabla del marketplace.
  INSERT INTO public.marketplace_shop_hours (shop_id, weekday, is_closed, open_time, close_time)
  SELECT v_shop_id, d, false, '09:00'::time, '18:00'::time FROM generate_series(1, 5) d;
  ASSERT (SELECT count(*) FROM public.marketplace_shop_hours WHERE shop_id = v_shop_id) = 5,
    'no se pudo publicar el horario sin business_hours';

  INSERT INTO auth.users (email) VALUES ('sevilla@example.test') RETURNING id INTO v_user_id;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, false);
  PERFORM public.marketplace_ensure_customer('Ana Ruiz', '+34600222333', 'sevilla@example.test', 'Sevilla');

  v_booking := public.marketplace_create_booking(
    p_shop_id => v_shop_id,
    p_scheduled_at => date_trunc('hour', now() + interval '3 days'),
    p_customer_name => 'Ana Ruiz',
    p_customer_phone => '+34600222333',
    p_service_name => 'Neumáticos',
    p_vehicle_make => 'Renault',
    p_vehicle_model => 'Clio',
    p_vehicle_plate => '5678xyz'
  );

  ASSERT (SELECT count(*) FROM public.appointments WHERE id = (v_booking ->> 'appointment_id')::uuid) = 1,
    'la reserva no llegó a appointments';
  ASSERT (SELECT status FROM public.appointments WHERE id = (v_booking ->> 'appointment_id')::uuid) = 'confirmed',
    'estado inesperado en appointments';
  ASSERT (SELECT vehicle_plate FROM public.appointments WHERE id = (v_booking ->> 'appointment_id')::uuid) = '5678XYZ',
    'matrícula no normalizada';

  -- Sin tabla `urgencias`, la solicitud se guarda solo en el marketplace y lo
  -- avisa en la respuesta para que la app pueda ofrecer llamada telefónica.
  v_urgent := public.marketplace_create_urgent_request(
    p_shop_id => v_shop_id,
    p_customer_name => 'Ana Ruiz',
    p_customer_phone => '+34600222333',
    p_reason => 'Pinchazo en autovía'
  );
  ASSERT NOT (v_urgent ->> 'reached_b2b_panel')::boolean,
    'sin tabla urgencias reached_b2b_panel debería ser false';
  ASSERT (SELECT count(*) FROM public.marketplace_urgent_requests
           WHERE id = (v_urgent ->> 'request_id')::uuid) = 1,
    'la solicitud urgente no se guardó';

  RAISE NOTICE 'OK · reservas y urgencias sobre el esquema de Supabase';
END $$;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.profiles WHERE role = 'customer') = 0,
    'ningún perfil debería haber cambiado de rol';
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND pg_get_constraintdef(oid) ILIKE '%customer%'
  ), 'profiles.role debería aceptar el rol customer';
  RAISE NOTICE 'OK · profiles.role admite clientes finales';
END $$;

\echo ''
\echo ' Escenario Supabase puro: OK'
