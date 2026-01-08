-- Webhook Idempotency: Prevent replay attacks
-- SOC 2 CC7.1: Ensure webhooks are processed exactly once
--
-- This table tracks Stripe webhook event IDs to prevent duplicate processing
-- which could lead to double-charging, duplicate email sends, or inconsistent state.

-- Create the idempotency table
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_result TEXT DEFAULT 'success',
    error_message TEXT
);

-- Index for fast lookups by event ID
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_id
    ON stripe_webhook_events(stripe_event_id);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
    ON stripe_webhook_events(processed_at);

-- Add comment for documentation
COMMENT ON TABLE stripe_webhook_events IS 'Tracks processed Stripe webhook events to prevent replay attacks (SOC 2 CC7.1)';

-- Enable RLS
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events FORCE ROW LEVEL SECURITY;

-- Only allow internal access (no user access needed)
CREATE POLICY stripe_webhook_events_internal_only ON stripe_webhook_events
    FOR ALL
    TO postgres, service_role
    USING (true)
    WITH CHECK (true);

-- Block authenticated users from accessing webhook events
CREATE POLICY stripe_webhook_events_block_users ON stripe_webhook_events
    FOR ALL
    TO authenticated
    USING (false);

-- Grant access to service role for backend usage
GRANT ALL ON stripe_webhook_events TO service_role;

-- Note: For cleanup, use a scheduled job (pg_cron) to remove old events:
-- DELETE FROM stripe_webhook_events WHERE processed_at < NOW() - INTERVAL '7 days';
