-- Google Sign-In for shop owners (email identity + optional google_sub).
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx
  ON users (google_sub) WHERE google_sub IS NOT NULL;

-- Owners sign in with email; phone remains the customer contact number.
ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'es';
