-- Add support for scheduled subscription downgrades
-- Downgrades take effect at the end of the billing period (industry standard)

-- Add columns to track pending downgrades
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_downgrade_tier VARCHAR(50);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_downgrade_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_schedule_id VARCHAR(255);

-- Index for finding subscriptions with pending downgrades
CREATE INDEX IF NOT EXISTS idx_subscriptions_pending_downgrade
ON subscriptions(scheduled_downgrade_tier)
WHERE scheduled_downgrade_tier IS NOT NULL;

-- Add constraint to ensure scheduled_downgrade_tier is a valid tier
-- (free, pro, team, enterprise)
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS chk_scheduled_downgrade_tier;
ALTER TABLE subscriptions ADD CONSTRAINT chk_scheduled_downgrade_tier
CHECK (scheduled_downgrade_tier IS NULL OR scheduled_downgrade_tier IN ('free', 'pro', 'team', 'enterprise'));

COMMENT ON COLUMN subscriptions.scheduled_downgrade_tier IS 'The tier to downgrade to at period end (null = no pending downgrade)';
COMMENT ON COLUMN subscriptions.scheduled_downgrade_at IS 'When the downgrade was scheduled by the user';
COMMENT ON COLUMN subscriptions.stripe_schedule_id IS 'Stripe subscription schedule ID for tracking the scheduled change';
