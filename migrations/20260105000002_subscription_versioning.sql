-- Subscription Versioning: Add version fields for optimistic locking
-- This migration adds version tracking to enable atomic tier changes and
-- prevent race conditions between webhooks and admin panel operations.
--
-- SOC 2 CC6.1: Ensure data integrity through optimistic locking

-- Version fields for subscriptions table (optimistic locking)
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS stripe_event_timestamp TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ DEFAULT NOW();

-- Version fields for organizations table (tier change tracking)
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS tier_version BIGINT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS tier_source TEXT DEFAULT 'stripe',
ADD COLUMN IF NOT EXISTS tier_changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS tier_changed_at TIMESTAMPTZ;

-- Index for stale event detection (find events by timestamp)
CREATE INDEX IF NOT EXISTS idx_subscriptions_event_timestamp
    ON subscriptions(stripe_event_timestamp DESC)
    WHERE stripe_event_timestamp IS NOT NULL;

-- Index for finding recently synced subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_last_synced
    ON subscriptions(last_synced_at DESC);

-- Comments for documentation
COMMENT ON COLUMN subscriptions.version IS 'Optimistic locking version, incremented on each update';
COMMENT ON COLUMN subscriptions.stripe_event_timestamp IS 'Timestamp from Stripe event, for stale event detection';
COMMENT ON COLUMN subscriptions.last_synced_at IS 'When subscription was last synced with Stripe';
COMMENT ON COLUMN organizations.tier_version IS 'Optimistic locking version for tier changes';
COMMENT ON COLUMN organizations.tier_source IS 'Source of last tier change: admin, user, stripe, system';
COMMENT ON COLUMN organizations.tier_changed_by IS 'User who last changed the tier (if admin)';
COMMENT ON COLUMN organizations.tier_changed_at IS 'When the tier was last changed';

-- Rollback:
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS version;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS stripe_event_timestamp;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS last_synced_at;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS tier_version;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS tier_source;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS tier_changed_by;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS tier_changed_at;
-- DROP INDEX IF EXISTS idx_subscriptions_event_timestamp;
-- DROP INDEX IF EXISTS idx_subscriptions_last_synced;
