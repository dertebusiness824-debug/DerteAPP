-- Retarget user-facing FKs that a Supabase-imported schema may have pointed
-- at public.profiles (auth.users) instead of public.users (Express auth).
-- Without this, confirming a booking writes accepted_by = local users.id and
-- fails with 23503, which the API mis-labeled as "referencia de usuario inválida".

-- ---- appointments.accepted_by ----------------------------------------------
ALTER TABLE IF EXISTS appointments DROP CONSTRAINT IF EXISTS appointments_accepted_by_fkey;

UPDATE appointments
   SET accepted_by = NULL
 WHERE accepted_by IS NOT NULL
   AND to_regclass('public.users') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = appointments.accepted_by);

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL AND to_regclass('public.appointments') IS NOT NULL THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_accepted_by_fkey
      FOREIGN KEY (accepted_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---- notifications.user_id -------------------------------------------------
ALTER TABLE IF EXISTS notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;

DELETE FROM notifications n
 WHERE to_regclass('public.users') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id);

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL AND to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---- audit_log.actor_user_id -----------------------------------------------
ALTER TABLE IF EXISTS audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_user_id_fkey;

UPDATE audit_log
   SET actor_user_id = NULL
 WHERE actor_user_id IS NOT NULL
   AND to_regclass('public.users') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = audit_log.actor_user_id);

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL AND to_regclass('public.audit_log') IS NOT NULL THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_actor_user_id_fkey
      FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;
