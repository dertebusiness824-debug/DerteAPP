-- Urgencias lifecycle: pending until the shop owner accepts into a booking.

ALTER TABLE urgencias
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

UPDATE urgencias
   SET title = COALESCE(NULLIF(trim(title), ''), 'Solicitud de servicio urgente')
 WHERE title IS NULL OR trim(title) = '';

UPDATE urgencias
   SET status = 'pending'
 WHERE status IS NULL OR trim(status) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'urgencias_status_check'
  ) THEN
    ALTER TABLE urgencias
      ADD CONSTRAINT urgencias_status_check
      CHECK (status IN ('pending', 'accepted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS urgencias_shop_status_created_idx
  ON urgencias (shop_id, status, created_at DESC);
