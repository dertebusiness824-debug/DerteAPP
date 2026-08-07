-- Internal shop notes on bookings (separate from customer/Google description notes).
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;
