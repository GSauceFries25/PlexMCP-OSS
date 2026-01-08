-- Downgrade Processing Lock: Prevent race conditions during scheduled downgrades
-- This migration adds locking columns to prevent race conditions when admin
-- cancels a scheduled downgrade while a webhook is processing it.
--
-- SOC 2 CC6.1: Ensure data integrity through atomic operations

-- Processing lock columns for scheduled downgrades
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS scheduled_downgrade_processing BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS scheduled_downgrade_claimed_at TIMESTAMPTZ;

-- Partial index for finding unclaimed pending downgrades efficiently
-- This index only includes rows that have a scheduled downgrade but are not currently being processed
CREATE INDEX IF NOT EXISTS idx_subscriptions_pending_downgrade_unlocked
    ON subscriptions(org_id, scheduled_downgrade_at)
    WHERE scheduled_downgrade_tier IS NOT NULL
      AND scheduled_downgrade_processing = false;

-- Index for finding stuck processing claims (for cleanup job)
CREATE INDEX IF NOT EXISTS idx_subscriptions_stale_claims
    ON subscriptions(scheduled_downgrade_claimed_at)
    WHERE scheduled_downgrade_processing = true;

-- Comments for documentation
COMMENT ON COLUMN subscriptions.scheduled_downgrade_processing IS 'True when a process has claimed this downgrade for processing';
COMMENT ON COLUMN subscriptions.scheduled_downgrade_claimed_at IS 'When the processing claim was made (for stale claim detection)';

-- Rollback:
-- DROP INDEX IF EXISTS idx_subscriptions_pending_downgrade_unlocked;
-- DROP INDEX IF EXISTS idx_subscriptions_stale_claims;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS scheduled_downgrade_processing;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS scheduled_downgrade_claimed_at;
