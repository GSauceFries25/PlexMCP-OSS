-- Overage tracking: usage-based billing for overages
-- Date: 2024-12-04

-- Create overage charges table
CREATE TABLE IF NOT EXISTS overage_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    billing_period_start TIMESTAMPTZ NOT NULL,
    billing_period_end TIMESTAMPTZ NOT NULL,
    resource_type VARCHAR(50) NOT NULL,  -- 'requests', 'storage', etc.
    base_limit BIGINT NOT NULL,
    actual_usage BIGINT NOT NULL,
    overage_amount BIGINT NOT NULL,
    rate_per_unit_cents INTEGER NOT NULL,
    total_charge_cents INTEGER NOT NULL,
    stripe_invoice_item_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',  -- pending, invoiced, paid, waived
    created_at TIMESTAMPTZ DEFAULT NOW(),
    invoiced_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_overage_org_period
ON overage_charges(org_id, billing_period_start);

CREATE INDEX IF NOT EXISTS idx_overage_status
ON overage_charges(status);

CREATE INDEX IF NOT EXISTS idx_overage_stripe_item
ON overage_charges(stripe_invoice_item_id);

-- Enable RLS
ALTER TABLE overage_charges ENABLE ROW LEVEL SECURITY;

-- RLS policy: organizations can only see their own overage charges
DROP POLICY IF EXISTS overage_charges_org_isolation ON overage_charges;
CREATE POLICY overage_charges_org_isolation ON overage_charges
    FOR ALL
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Add comments for documentation
COMMENT ON TABLE overage_charges IS 'Tracks usage-based overage charges when customers exceed their plan limits';
COMMENT ON COLUMN overage_charges.resource_type IS 'Type of resource (requests, storage, etc.)';
COMMENT ON COLUMN overage_charges.base_limit IS 'The limit from tier + add-ons at time of billing';
COMMENT ON COLUMN overage_charges.overage_amount IS 'Amount over the limit';
COMMENT ON COLUMN overage_charges.rate_per_unit_cents IS 'Rate charged per unit of overage';
COMMENT ON COLUMN overage_charges.status IS 'Charge status: pending (awaiting invoice), invoiced, paid, waived';
