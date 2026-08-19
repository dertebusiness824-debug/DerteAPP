-- Allow shop owners to cancel/reject pending urgencias.

ALTER TABLE urgencias
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE urgencias DROP CONSTRAINT IF EXISTS urgencias_status_check;
ALTER TABLE urgencias
  ADD CONSTRAINT urgencias_status_check
  CHECK (status IN ('pending', 'accepted', 'cancelled'));
