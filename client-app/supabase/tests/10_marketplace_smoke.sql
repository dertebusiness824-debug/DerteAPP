-- =============================================================================
-- Prueba funcional del esquema del marketplace contra un PostgreSQL real.
-- Cada bloque falla con ASSERT si el comportamiento no es el esperado.
-- Lanzar con `client-app/scripts/verify-sql.sh` (crea un clúster temporal).
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

-- --- Datos de partida: un taller B2B y su horario ---------------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_listing public.marketplace_shop_listings;
BEGIN
  INSERT INTO public.shops (
    name, slug, public_key, phone, whatsapp_phone, email, address, city,
    country_code, timezone, slot_minutes, capacity, min_notice_minutes,
    booking_horizon_days, services, settings, status
  )
  VALUES (
    'Taller Central Chamberí', 'taller-central-chamberi', 'dk_test_chamberi',
    '+34910000001', '+34600000001', 'hola@chamberi.test',
    'Calle de Bravo Murillo 12', 'Madrid', 'ES', 'Europe/Madrid',
    60, 2, 60, 60,
    '[{"name":"Cambio de aceite"},{"name":"Pastillas de freno"}]'::jsonb,
    jsonb_build_object('marketplace', jsonb_build_object(
      'latitude', 40.4378, 'longitude', -3.7036,
      'neighborhood', 'Chamberí',
      'headline', 'Mecánica rápida y diagnosis',
      'accepts_urgent_24h', true
    )),
    'active'
  )
  RETURNING id INTO v_shop_id;

  SELECT * INTO v_listing FROM public.marketplace_shop_listings WHERE shop_id = v_shop_id;

  ASSERT v_listing.shop_id IS NOT NULL, 'el trigger no creó el escaparate del taller';
  ASSERT v_listing.name = 'Taller Central Chamberí', 'nombre no sincronizado';
  ASSERT v_listing.city = 'Madrid', 'ciudad no sincronizada';
  ASSERT v_listing.latitude = 40.4378 AND v_listing.longitude = -3.7036, 'geolocalización no sincronizada';
  ASSERT v_listing.neighborhood = 'Chamberí', 'barrio no sincronizado';
  ASSERT v_listing.accepts_urgent_24h, 'no se propagó accepts_urgent_24h';
  ASSERT v_listing.is_listed IS FALSE OR v_listing.is_listed IS TRUE, 'is_listed debe existir';
  -- Sin flag explícito, el taller nace oculto: el Super Admin lo publica a mano.
  ASSERT NOT v_listing.is_listed, 'sin is_listed explícito el taller debería nacer oculto';
  ASSERT jsonb_array_length(v_listing.services) = 2, 'servicios no sincronizados';

  -- Lo publicamos para el resto de la suite.
  UPDATE public.shops
     SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb),
           '{marketplace,is_listed}',
           'true'::jsonb,
           true
         )
   WHERE id = v_shop_id;

  ASSERT (SELECT is_listed FROM public.marketplace_shop_listings WHERE shop_id = v_shop_id),
    'tras publicar, is_listed debería ser true';

  RAISE NOTICE 'OK · shops → marketplace_shop_listings';
END $$;

-- --- Edición en el panel B2B: el escaparate se actualiza -------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_listing public.marketplace_shop_listings;
BEGIN
  SELECT id INTO v_shop_id FROM public.shops WHERE slug = 'taller-central-chamberi';

  UPDATE public.marketplace_shop_listings
     SET description = 'Descripción escrita en el marketplace'
   WHERE shop_id = v_shop_id;

  UPDATE public.shops
     SET name = 'Taller Central Chamberí 24h', phone = '+34910000099'
   WHERE id = v_shop_id;

  SELECT * INTO v_listing FROM public.marketplace_shop_listings WHERE shop_id = v_shop_id;

  ASSERT v_listing.name = 'Taller Central Chamberí 24h', 'el nombre editado no llegó al escaparate';
  ASSERT v_listing.phone = '+34910000099', 'el teléfono editado no llegó al escaparate';
  ASSERT v_listing.description = 'Descripción escrita en el marketplace',
    'la sincronización pisó un campo propio del marketplace';

  RAISE NOTICE 'OK · edición B2B → escaparate (sin pisar campos del marketplace)';
END $$;

-- --- Horario semanal -------------------------------------------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_rows INTEGER;
  v_monday public.marketplace_shop_hours;
BEGIN
  SELECT id INTO v_shop_id FROM public.shops WHERE slug = 'taller-central-chamberi';

  INSERT INTO public.business_hours (shop_id, weekday, is_closed, open_time, close_time, break_start, break_end)
  SELECT v_shop_id, d, false, '08:00'::time, '19:00'::time, '13:30'::time, '15:00'::time
    FROM generate_series(1, 5) d
  UNION ALL SELECT v_shop_id, 6, false, '09:00'::time, '14:00'::time, NULL::time, NULL::time
  UNION ALL SELECT v_shop_id, 0, true, NULL::time, NULL::time, NULL::time, NULL::time;

  SELECT count(*) INTO v_rows FROM public.marketplace_shop_hours WHERE shop_id = v_shop_id;
  ASSERT v_rows = 7, format('se esperaban 7 días de horario publicados, hay %s', v_rows);

  SELECT * INTO v_monday FROM public.marketplace_shop_hours WHERE shop_id = v_shop_id AND weekday = 1;
  ASSERT v_monday.open_time = '08:00'::time AND v_monday.close_time = '19:00'::time, 'horario del lunes incorrecto';
  ASSERT v_monday.break_start = '13:30'::time, 'descanso del lunes incorrecto';

  UPDATE public.business_hours SET close_time = '20:00' WHERE shop_id = v_shop_id AND weekday = 1;
  SELECT * INTO v_monday FROM public.marketplace_shop_hours WHERE shop_id = v_shop_id AND weekday = 1;
  ASSERT v_monday.close_time = '20:00'::time, 'el cambio de horario no se sincronizó';

  RAISE NOTICE 'OK · business_hours → marketplace_shop_hours';
END $$;

-- --- Cliente final autenticado ---------------------------------------------
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES ('conductora@example.test') RETURNING id INTO v_user_id;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, false);

  PERFORM public.marketplace_ensure_customer('Lucía Fernández', '+34600111222', 'conductora@example.test', 'Madrid');

  ASSERT EXISTS (
    SELECT 1 FROM public.marketplace_customers
     WHERE id = v_user_id AND full_name = 'Lucía Fernández' AND city = 'Madrid'
  ), 'marketplace_ensure_customer no creó el perfil';

  -- Segunda llamada: no duplica y respeta los datos ya guardados.
  PERFORM public.marketplace_ensure_customer(NULL, NULL, NULL, NULL);
  ASSERT (SELECT count(*) FROM public.marketplace_customers) = 1, 'el perfil se duplicó';
  ASSERT (SELECT full_name FROM public.marketplace_customers WHERE id = v_user_id) = 'Lucía Fernández',
    'la segunda llamada borró el nombre';

  RAISE NOTICE 'OK · marketplace_ensure_customer';
END $$;

-- --- Reserva: entra en `appointments` del panel B2B ------------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_slot TIMESTAMPTZ := date_trunc('hour', now() + interval '2 days');
  v_result JSONB;
  v_apt public.appointments;
  v_booking public.marketplace_bookings;
BEGIN
  SELECT id INTO v_shop_id FROM public.shops WHERE slug = 'taller-central-chamberi';

  v_result := public.marketplace_create_booking(
    p_shop_id => v_shop_id,
    p_scheduled_at => v_slot,
    p_customer_name => 'Lucía Fernández',
    p_customer_phone => '+34600111222',
    p_service_name => 'Cambio de aceite y filtros',
    p_customer_email => 'conductora@example.test',
    p_vehicle_make => 'Seat',
    p_vehicle_model => 'León',
    p_vehicle_plate => '1234abc',
    p_vehicle_year => 2019,
    p_notes => 'Ruido al frenar en frío'
  );

  ASSERT v_result ->> 'reference' LIKE 'APT-%', 'la reserva no devolvió referencia';

  SELECT * INTO v_apt FROM public.appointments WHERE id = (v_result ->> 'appointment_id')::uuid;
  ASSERT v_apt.shop_id = v_shop_id, 'la cita no quedó asociada al taller';
  ASSERT v_apt.status = 'confirmed', format('estado inesperado en el panel: %s', v_apt.status);
  ASSERT v_apt.source = 'api', format('origen inesperado: %s', v_apt.source);
  ASSERT v_apt.customer_phone = '+34600111222', 'teléfono no guardado';
  ASSERT v_apt.vehicle_plate = '1234ABC', 'la matrícula debería normalizarse a mayúsculas';
  ASSERT v_apt.vehicle_make = 'Seat' AND v_apt.vehicle_model = 'León', 'vehículo no guardado';
  ASSERT v_apt.service_type = 'Cambio de aceite y filtros', 'servicio no guardado';
  ASSERT v_apt.notes LIKE '%Ruido al frenar en frío%', 'notas del cliente perdidas';
  ASSERT v_apt.notes LIKE '%marketplace%', 'falta la traza de origen en las notas';
  ASSERT v_apt.duration_minutes = 60, 'duración por defecto incorrecta';

  SELECT * INTO v_booking FROM public.marketplace_bookings WHERE appointment_id = v_apt.id;
  ASSERT v_booking.status = 'confirmed', 'el espejo del cliente no refleja el estado';
  ASSERT v_booking.reference = v_apt.reference, 'referencias descuadradas';
  ASSERT v_booking.shop_name = 'Taller Central Chamberí 24h', 'falta el nombre del taller en el resguardo';
  ASSERT v_booking.shop_phone = '+34910000099', 'falta el teléfono del taller en el resguardo';
  ASSERT v_booking.timezone = 'Europe/Madrid', 'falta la zona horaria en el resguardo';

  RAISE NOTICE 'OK · marketplace_create_booking → appointments';
END $$;

-- --- Reglas de disponibilidad ---------------------------------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_slot TIMESTAMPTZ := date_trunc('hour', now() + interval '2 days');
  v_failed BOOLEAN;
BEGIN
  SELECT id INTO v_shop_id FROM public.shops WHERE slug = 'taller-central-chamberi';

  -- Capacidad 2: la segunda reserva en el mismo hueco entra…
  PERFORM public.marketplace_create_booking(
    v_shop_id, v_slot, 'Lucía Fernández', '+34600111222', 'Revisión pre-ITV'
  );

  -- …y la tercera se rechaza.
  v_failed := false;
  BEGIN
    PERFORM public.marketplace_create_booking(
      v_shop_id, v_slot, 'Lucía Fernández', '+34600111222', 'Neumáticos'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM = 'slot_taken', format('se esperaba slot_taken, llegó %s', SQLERRM);
  END;
  ASSERT v_failed, 'el hueco lleno debería rechazarse (capacity = 2)';

  -- Antelación mínima (60 min).
  v_failed := false;
  BEGIN
    PERFORM public.marketplace_create_booking(
      v_shop_id, now() + interval '10 minutes', 'Lucía Fernández', '+34600111222', 'Urgente'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM = 'too_soon', format('se esperaba too_soon, llegó %s', SQLERRM);
  END;
  ASSERT v_failed, 'debería exigirse la antelación mínima del taller';

  -- Horizonte de reservas (60 días).
  v_failed := false;
  BEGIN
    PERFORM public.marketplace_create_booking(
      v_shop_id, now() + interval '200 days', 'Lucía Fernández', '+34600111222', 'Revisión'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM = 'too_far', format('se esperaba too_far, llegó %s', SQLERRM);
  END;
  ASSERT v_failed, 'debería respetarse el horizonte de reservas';

  -- Teléfono inválido.
  v_failed := false;
  BEGIN
    PERFORM public.marketplace_create_booking(
      v_shop_id, v_slot + interval '1 day', 'Lucía Fernández', '123', 'Revisión'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM = 'invalid_phone', format('se esperaba invalid_phone, llegó %s', SQLERRM);
  END;
  ASSERT v_failed, 'debería validarse el teléfono';

  RAISE NOTICE 'OK · reglas de capacidad, antelación, horizonte y validación';
END $$;

-- --- Taller no publicado ---------------------------------------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_failed BOOLEAN := false;
BEGIN
  INSERT INTO public.shops (name, slug, public_key, city, status, settings)
  VALUES ('Taller Privado', 'taller-privado', 'dk_test_privado', 'Madrid', 'active',
          jsonb_build_object('marketplace', jsonb_build_object('is_listed', false)))
  RETURNING id INTO v_shop_id;

  ASSERT NOT (SELECT is_listed FROM public.marketplace_shop_listings WHERE shop_id = v_shop_id),
    'is_listed=false debería respetarse';

  BEGIN
    PERFORM public.marketplace_create_booking(
      v_shop_id, now() + interval '3 days', 'Lucía Fernández', '+34600111222', 'Revisión'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM = 'shop_unavailable', format('se esperaba shop_unavailable, llegó %s', SQLERRM);
  END;
  ASSERT v_failed, 'un taller no publicado no debería aceptar reservas';

  RAISE NOTICE 'OK · talleres no publicados fuera del marketplace';
END $$;

-- --- Huecos ocupados (RPC de disponibilidad) -------------------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_slot TIMESTAMPTZ := date_trunc('hour', now() + interval '2 days');
  v_booked BIGINT;
BEGIN
  SELECT id INTO v_shop_id FROM public.shops WHERE slug = 'taller-central-chamberi';

  SELECT booked INTO v_booked
    FROM public.marketplace_slot_load(v_shop_id, now(), now() + interval '30 days')
   WHERE slot_start = v_slot;

  ASSERT v_booked = 2, format('marketplace_slot_load devolvió %s reservas, se esperaban 2', v_booked);

  RAISE NOTICE 'OK · marketplace_slot_load';
END $$;

-- --- El taller cambia el estado: el cliente lo ve en tiempo real -----------
DO $$
DECLARE
  v_booking public.marketplace_bookings;
BEGIN
  SELECT * INTO v_booking FROM public.marketplace_bookings ORDER BY created_at LIMIT 1;

  UPDATE public.appointments SET status = 'in_progress' WHERE id = v_booking.appointment_id;
  SELECT * INTO v_booking FROM public.marketplace_bookings WHERE id = v_booking.id;
  ASSERT v_booking.status = 'in_progress', 'el espejo no reflejó in_progress';

  UPDATE public.appointments SET status = 'completed', completed_at = now() WHERE id = v_booking.appointment_id;
  SELECT * INTO v_booking FROM public.marketplace_bookings WHERE id = v_booking.id;
  ASSERT v_booking.status = 'completed', 'el espejo no reflejó completed';

  -- El taller también puede mover la hora.
  UPDATE public.appointments
     SET scheduled_at = scheduled_at + interval '1 hour'
   WHERE id = v_booking.appointment_id;
  ASSERT (SELECT scheduled_at FROM public.marketplace_bookings WHERE id = v_booking.id)
         = (SELECT scheduled_at FROM public.appointments WHERE id = v_booking.appointment_id),
    'el espejo no reflejó el cambio de hora';

  RAISE NOTICE 'OK · appointments → marketplace_bookings (estado en tiempo real)';
END $$;

-- --- Cancelación por el cliente -------------------------------------------
DO $$
DECLARE
  v_booking public.marketplace_bookings;
  v_result JSONB;
  v_failed BOOLEAN := false;
BEGIN
  SELECT * INTO v_booking
    FROM public.marketplace_bookings WHERE status NOT IN ('completed', 'cancelled') LIMIT 1;

  v_result := public.marketplace_cancel_booking(v_booking.id);
  ASSERT v_result ->> 'status' = 'cancelled', 'la cancelación no devolvió el estado';
  ASSERT (SELECT status FROM public.appointments WHERE id = v_booking.appointment_id) = 'cancelled',
    'la cita del panel B2B no se canceló';
  ASSERT (SELECT cancelled_reason FROM public.appointments WHERE id = v_booking.appointment_id) IS NOT NULL,
    'falta el motivo de cancelación';

  -- Cancelar una cita ya cerrada falla.
  BEGIN
    PERFORM public.marketplace_cancel_booking(v_booking.id);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM = 'booking_not_cancellable', format('se esperaba booking_not_cancellable, llegó %s', SQLERRM);
  END;
  ASSERT v_failed, 'no debería poder cancelarse dos veces';

  RAISE NOTICE 'OK · marketplace_cancel_booking';
END $$;

-- --- Asistencia urgente → panel de Urgencias del taller --------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_result JSONB;
  v_urg RECORD;
  v_request public.marketplace_urgent_requests;
BEGIN
  SELECT id INTO v_shop_id FROM public.shops WHERE slug = 'taller-central-chamberi';

  v_result := public.marketplace_create_urgent_request(
    p_shop_id => v_shop_id,
    p_customer_name => 'Lucía Fernández',
    p_customer_phone => '+34600111222',
    p_reason => 'No arranca, luz del motor encendida',
    p_location_text => 'Calle Alcalá 200, Madrid',
    p_vehicle_make => 'Seat',
    p_vehicle_model => 'León',
    p_vehicle_plate => '1234abc'
  );

  ASSERT (v_result ->> 'reached_b2b_panel')::boolean, 'la urgencia no llegó a la tabla urgencias';

  SELECT * INTO v_urg FROM public.urgencias WHERE id = (v_result ->> 'urgencia_id')::uuid;
  ASSERT v_urg.shop_id = v_shop_id, 'urgencia sin taller';
  ASSERT v_urg.status = 'pending', 'la urgencia debería nacer pendiente';
  ASSERT v_urg.is_urgent, 'la urgencia debería marcarse como urgente';
  ASSERT v_urg.source = 'marketplace', format('origen inesperado: %s', v_urg.source);
  ASSERT v_urg.customer_phone = '+34600111222', 'teléfono de la urgencia perdido';
  ASSERT v_urg.reason = 'No arranca, luz del motor encendida', 'motivo de la urgencia perdido';
  ASSERT v_urg.summary LIKE '%Calle Alcalá 200%', 'la ubicación no llegó al resumen';
  ASSERT v_urg.title = 'Solicitud de servicio urgente', 'título inesperado';
  ASSERT v_urg.raw ->> 'origin' = 'marketplace', 'falta la traza de origen';

  SELECT * INTO v_request FROM public.marketplace_urgent_requests WHERE urgencia_id = v_urg.id;
  ASSERT v_request.status = 'pending', 'el espejo del cliente no está pendiente';
  ASSERT v_request.shop_name = 'Taller Central Chamberí 24h', 'falta el nombre del taller en la solicitud';

  -- El taller la acepta desde su panel.
  UPDATE public.urgencias SET status = 'accepted', accepted_at = now() WHERE id = v_urg.id;
  SELECT * INTO v_request FROM public.marketplace_urgent_requests WHERE urgencia_id = v_urg.id;
  ASSERT v_request.status = 'accepted', 'el cliente no ve la aceptación';
  ASSERT v_request.accepted_at IS NOT NULL, 'falta la marca de aceptación';

  RAISE NOTICE 'OK · marketplace_create_urgent_request → urgencias (y vuelta)';
END $$;

-- --- Opiniones y valoración media -----------------------------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_customer UUID;
  v_listing public.marketplace_shop_listings;
BEGIN
  SELECT id INTO v_shop_id FROM public.shops WHERE slug = 'taller-central-chamberi';
  SELECT id INTO v_customer FROM public.marketplace_customers LIMIT 1;

  INSERT INTO public.marketplace_reviews (shop_id, customer_id, author_name, rating, comment)
  VALUES (v_shop_id, v_customer, 'Lucía F.', 5, 'Rapidísimos y muy claros con el precio'),
         (v_shop_id, v_customer, 'Marcos R.', 4, 'Buen trato, el coche listo en el día');

  SELECT * INTO v_listing FROM public.marketplace_shop_listings WHERE shop_id = v_shop_id;
  ASSERT v_listing.rating_count = 2, format('rating_count = %s', v_listing.rating_count);
  ASSERT v_listing.rating_avg = 4.50, format('rating_avg = %s', v_listing.rating_avg);

  UPDATE public.marketplace_reviews SET status = 'hidden' WHERE rating = 4;
  SELECT * INTO v_listing FROM public.marketplace_shop_listings WHERE shop_id = v_shop_id;
  ASSERT v_listing.rating_count = 1, 'ocultar una opinión debería recalcular la media';
  ASSERT v_listing.rating_avg = 5.00, format('rating_avg tras ocultar = %s', v_listing.rating_avg);

  RAISE NOTICE 'OK · opiniones y valoración media';
END $$;

-- --- RLS: qué ve el público y qué ve cada cliente --------------------------
DO $$
DECLARE
  v_other_user UUID;
  v_other_customer UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES ('otro@example.test') RETURNING id INTO v_other_user;
  INSERT INTO public.marketplace_customers (id, full_name) VALUES (v_other_user, 'Otro Cliente')
  RETURNING id INTO v_other_customer;

  INSERT INTO public.marketplace_bookings
    (shop_id, customer_id, status, scheduled_at, customer_name, customer_phone)
  SELECT id, v_other_customer, 'confirmed', now() + interval '5 days', 'Otro Cliente', '+34600999888'
    FROM public.shops WHERE slug = 'taller-central-chamberi';
END $$;

-- Público anónimo: ve el escaparate, no los datos personales.
SET ROLE anon;
DO $$
DECLARE
  v_visible INTEGER;
  v_denied BOOLEAN := false;
BEGIN
  SELECT count(*) INTO v_visible FROM public.marketplace_shop_listings;
  ASSERT v_visible = 1, format('anon debería ver 1 taller publicado, ve %s', v_visible);

  SELECT count(*) INTO v_visible FROM public.marketplace_shop_hours;
  ASSERT v_visible = 7, format('anon debería ver el horario publicado, ve %s filas', v_visible);

  BEGIN
    PERFORM count(*) FROM public.marketplace_customers;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  ASSERT v_denied, 'anon no debería poder leer marketplace_customers';

  RAISE NOTICE 'OK · RLS para anon (escaparate público, datos personales cerrados)';
END $$;
RESET ROLE;

-- Cliente autenticado: solo sus reservas.
SET ROLE authenticated;
DO $$
DECLARE
  v_mine INTEGER;
  v_others INTEGER;
BEGIN
  SELECT count(*) INTO v_mine FROM public.marketplace_bookings;
  SELECT count(*) INTO v_others
    FROM public.marketplace_bookings
   WHERE customer_id <> public.marketplace_current_customer();

  ASSERT v_others = 0, 'un cliente no debería ver reservas de otros';
  ASSERT v_mine >= 2, format('el cliente debería ver sus reservas, ve %s', v_mine);

  ASSERT (SELECT count(*) FROM public.marketplace_customers) = 1,
    'un cliente solo debería ver su propio perfil';

  RAISE NOTICE 'OK · RLS para authenticated (aislamiento entre clientes)';
END $$;
RESET ROLE;

-- --- Las tablas del panel B2B siguen intactas ------------------------------
DO $$
DECLARE
  v_cols TEXT[];
BEGIN
  SELECT array_agg(column_name ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'shops' AND column_name LIKE 'marketplace%';
  ASSERT v_cols IS NULL, 'el marketplace no debe añadir columnas a shops';

  SELECT array_agg(column_name ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name LIKE 'marketplace%';
  ASSERT v_cols IS NULL, 'el marketplace no debe añadir columnas a appointments';

  RAISE NOTICE 'OK · tablas del panel B2B sin cambios estructurales';
END $$;

-- --- Ofertas públicas de talleres publicados -------------------------------
DO $$
DECLARE
  v_shop_id UUID;
  v_visible INT;
  v_promo_id UUID;
BEGIN
  SELECT id INTO v_shop_id FROM public.shops WHERE slug = 'taller-central-chamberi';

  INSERT INTO public.shop_promotions (
    shop_id, title, description, badge_label, discount_percent, price_from, is_active
  ) VALUES (
    v_shop_id, 'Cambio de aceite -15%', 'Incluye filtro', '-15%', 15, 59, true
  ) RETURNING id INTO v_promo_id;

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_visible FROM public.shop_promotions WHERE shop_id = v_shop_id;
  ASSERT v_visible = 1, format('anon debería ver 1 oferta activa, ve %s', v_visible);
  RESET ROLE;

  UPDATE public.shops
     SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb),
           '{marketplace,is_listed}',
           'false'::jsonb,
           true
         )
   WHERE id = v_shop_id;

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_visible FROM public.shop_promotions WHERE shop_id = v_shop_id;
  ASSERT v_visible = 0, 'anon no debería ver ofertas de un taller no publicado';
  RESET ROLE;

  -- Restaurar publicación para no interferir con asserts posteriores (no hay).
  UPDATE public.shops
     SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb),
           '{marketplace,is_listed}',
           'true'::jsonb,
           true
         )
   WHERE id = v_shop_id;

  RAISE NOTICE 'OK · ofertas visibles solo en talleres publicados';
END $$;

\echo ''
\echo '================================================'
\echo ' Marketplace SQL: todas las comprobaciones OK'
\echo '================================================'
