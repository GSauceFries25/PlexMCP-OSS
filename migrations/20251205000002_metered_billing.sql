-- Add metered billing support
-- Stores the Stripe subscription item ID for metered usage reporting

-- Add metered item ID column to subscriptions
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS stripe_metered_item_id VARCHAR(255);

-- Create index for efficient lookups of subscriptions with metered items
CREATE INDEX IF NOT EXISTS idx_subscriptions_metered_item
ON subscriptions(stripe_metered_item_id)
WHERE stripe_metered_item_id IS NOT NULL;

-- Add index for finding active metered subscriptions by org
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_metered
ON subscriptions(org_id, stripe_metered_item_id)
WHERE status = 'active' AND stripe_metered_item_id IS NOT NULL;

-- Create table to track usage reports sent to Stripe
CREATE TABLE IF NOT EXISTS stripe_usage_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    metered_item_id VARCHAR(255) NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    total_usage BIGINT NOT NULL,
    included_limit BIGINT NOT NULL,
    overage_units BIGINT NOT NULL,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stripe_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding recent reports for an org
CREATE INDEX IF NOT EXISTS idx_usage_reports_org_period
ON stripe_usage_reports(org_id, period_start, period_end);

-- Index for finding reports by subscription
CREATE INDEX IF NOT EXISTS idx_usage_reports_subscription
ON stripe_usage_reports(subscription_id, reported_at);

-- Enable RLS
ALTER TABLE stripe_usage_reports ENABLE ROW LEVEL SECURITY;

-- RLS policy: org members can view their own usage reports
DROP POLICY IF EXISTS stripe_usage_reports_org_policy ON stripe_usage_reports;
CREATE POLICY stripe_usage_reports_org_policy ON stripe_usage_reports
    FOR SELECT
    USING (
        org_id IN (
            SELECT org_id FROM users WHERE id = auth.uid()
        )
    );
