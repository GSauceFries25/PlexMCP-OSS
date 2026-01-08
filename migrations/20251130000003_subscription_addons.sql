-- Create subscription_addons table for managing paid add-ons
-- Migration: 20251130000003_subscription_addons

CREATE TABLE IF NOT EXISTS subscription_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Customer reference (user or organization ID as string)
    customer_id VARCHAR(255) NOT NULL,

    -- Subscription reference (from subscriptions table)
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,

    -- Add-on type: 'custom_branding', 'priority_support', 'extended_retention'
    addon_type VARCHAR(50) NOT NULL,

    -- Stripe subscription item ID (for managing the add-on in Stripe)
    stripe_item_id VARCHAR(255),

    -- Stripe price ID used for this add-on
    stripe_price_id VARCHAR(255) NOT NULL,

    -- Status: 'active', 'canceled', 'past_due'
    status VARCHAR(50) NOT NULL DEFAULT 'active',

    -- Metadata for add-on specific configuration
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    canceled_at TIMESTAMPTZ,

    -- Ensure one add-on type per customer
    UNIQUE(customer_id, addon_type)
);

-- Create indexes for fast lookups
CREATE INDEX idx_subscription_addons_customer_id ON subscription_addons(customer_id);
CREATE INDEX idx_subscription_addons_subscription_id ON subscription_addons(subscription_id);
CREATE INDEX idx_subscription_addons_addon_type ON subscription_addons(addon_type);
CREATE INDEX idx_subscription_addons_status ON subscription_addons(status);
CREATE INDEX idx_subscription_addons_stripe_item_id ON subscription_addons(stripe_item_id) WHERE stripe_item_id IS NOT NULL;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_subscription_addons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_addons_updated_at
    BEFORE UPDATE ON subscription_addons
    FOR EACH ROW
    EXECUTE FUNCTION update_subscription_addons_updated_at();

-- Add comments for documentation
COMMENT ON TABLE subscription_addons IS 'Tracks paid add-ons attached to customer subscriptions';
COMMENT ON COLUMN subscription_addons.addon_type IS 'Type of add-on: custom_branding, priority_support, extended_retention';
COMMENT ON COLUMN subscription_addons.stripe_item_id IS 'Stripe subscription item ID for managing the add-on';
COMMENT ON COLUMN subscription_addons.status IS 'Current status of the add-on subscription';
COMMENT ON COLUMN subscription_addons.metadata IS 'JSON metadata for add-on specific configuration';
