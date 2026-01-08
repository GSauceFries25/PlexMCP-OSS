-- Webhook Event Timestamp: Add event timestamp for stale event detection
-- This migration adds the Stripe event timestamp to enable rejection of
-- out-of-order webhook events.
--
-- SOC 2 CC7.1: Prevent processing of stale or replayed events

-- Add event_timestamp column to stripe_webhook_events
ALTER TABLE stripe_webhook_events
ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMPTZ;

-- Index for finding events by timestamp (for temporal ordering)
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_timestamp
    ON stripe_webhook_events(event_timestamp DESC)
    WHERE event_timestamp IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN stripe_webhook_events.event_timestamp IS 'Original timestamp from Stripe event.created, for temporal ordering';

-- Rollback:
-- DROP INDEX IF EXISTS idx_stripe_webhook_events_event_timestamp;
-- ALTER TABLE stripe_webhook_events DROP COLUMN IF EXISTS event_timestamp;
