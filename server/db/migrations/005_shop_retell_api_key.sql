-- Per-shop Retell AI API key (optional override / configuration surface).
-- Global RETELL_API_KEY in env still verifies webhooks; this column stores the
-- key the Super Admin configures for each workshop's Retell agent.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS retell_api_key TEXT;
