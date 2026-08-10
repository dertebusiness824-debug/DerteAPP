-- Per-shop Zadarma API credentials so each taller can be linked independently.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS zadarma_api_key TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS zadarma_api_secret TEXT;
