-- Webhook Processing Timeout: Prevent stuck "processing" state
-- SOC 2 CC7.1: Ensure webhooks don't get permanently stuck
--
-- This migration adds tracking for when processing started, allowing the system
-- to recover events that have been stuck in "processing" state for too long.
-- Without this, if a process crashes while handling a webhook, that event
-- can never be processed again.

-- Add processing_started_at column to track when processing began
ALTER TABLE stripe_webhook_events
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Index for finding stuck "processing" events efficiently
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processing_stuck
    ON stripe_webhook_events(processing_started_at)
    WHERE processing_result = 'processing';

-- Update existing "processing" events to have a processing_started_at
-- Set to processed_at for historical records (best effort)
UPDATE stripe_webhook_events
SET processing_started_at = processed_at
WHERE processing_result = 'processing'
  AND processing_started_at IS NULL;

-- Comment for documentation
COMMENT ON COLUMN stripe_webhook_events.processing_started_at IS
    'When processing started - used to detect and recover stuck events after timeout (30 min default)';

-- Create a function to recover stuck events (can be called by pg_cron or manually)
CREATE OR REPLACE FUNCTION recover_stuck_webhook_events(timeout_minutes INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    recovered_count INTEGER;
BEGIN
    -- Reset stuck "processing" events older than timeout to allow reprocessing
    WITH recovered AS (
        UPDATE stripe_webhook_events
        SET processing_result = 'timeout_recovered',
            error_message = format('Stuck in processing for over %s minutes, recovered at %s',
                                   timeout_minutes, NOW())
        WHERE processing_result = 'processing'
          AND processing_started_at < NOW() - (timeout_minutes || ' minutes')::INTERVAL
        RETURNING id
    )
    SELECT COUNT(*) INTO recovered_count FROM recovered;

    RETURN recovered_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service_role
GRANT EXECUTE ON FUNCTION recover_stuck_webhook_events(INTEGER) TO service_role;

-- Comment for the function
COMMENT ON FUNCTION recover_stuck_webhook_events IS
    'Recovers webhook events stuck in processing state. Call periodically or manually to unstick events.';

-- Rollback:
-- DROP FUNCTION IF EXISTS recover_stuck_webhook_events(INTEGER);
-- DROP INDEX IF EXISTS idx_stripe_webhook_events_processing_stuck;
-- ALTER TABLE stripe_webhook_events DROP COLUMN IF EXISTS processing_started_at;
