-- Comprueba que `marketplace_uninstall.sql` deja el panel B2B tal y como estaba.

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_left INTEGER;
BEGIN
  SELECT count(*) INTO v_left
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'marketplace%';
  ASSERT v_left = 0, format('quedan %s tablas del marketplace tras desinstalar', v_left);

  SELECT count(*) INTO v_left
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'marketplace%';
  ASSERT v_left = 0, format('quedan %s funciones del marketplace tras desinstalar', v_left);

  SELECT count(*) INTO v_left
    FROM pg_trigger
   WHERE NOT tgisinternal AND tgname LIKE 'marketplace%';
  ASSERT v_left = 0, format('quedan %s triggers del marketplace tras desinstalar', v_left);

  -- Y el panel B2B sigue operativo: sus tablas y datos permanecen.
  ASSERT to_regclass('public.shops') IS NOT NULL, 'falta la tabla shops';
  ASSERT to_regclass('public.appointments') IS NOT NULL, 'falta la tabla appointments';
  ASSERT to_regclass('public.urgencias') IS NOT NULL, 'falta la tabla urgencias';
  ASSERT (SELECT count(*) FROM public.shops) > 0, 'se perdieron talleres al desinstalar';
  ASSERT (SELECT count(*) FROM public.appointments) > 0, 'se perdieron citas al desinstalar';
  ASSERT (SELECT count(*) FROM public.urgencias) > 0, 'se perdieron urgencias al desinstalar';

  RAISE NOTICE 'OK · desinstalación limpia, panel B2B intacto';
END $$;
