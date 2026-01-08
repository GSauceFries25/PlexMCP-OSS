-- Migration: Instant charges for $50+ overage threshold
-- Tracks automatic charges triggered when overage exceeds threshold

CREATE TABLE IF NOT EXISTS instant_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Charge details
    amount_cents INTEGER NOT NULL,
    usage_at_charge BIGINT NOT NULL,
    overage_at_charge BIGINT NOT NULL,

    -- Stripe references
    stripe_invoice_id VARCHAR(255),
    stripe_payment_intent_id VARCHAR(255),

    -- Status: pending, processing, succeeded, failed
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_instant_charges_org ON instant_charges(org_id);
CREATE INDEX IF NOT EXISTS idx_instant_charges_status ON instant_charges(status);
CREATE INDEX IF NOT EXISTS idx_instant_charges_stripe_invoice ON instant_charges(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_instant_charges_org_created ON instant_charges(org_id, created_at DESC);

-- Enable RLS
ALTER TABLE instant_charges ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Organization isolation
DROP POLICY IF EXISTS instant_charges_org_policy ON instant_charges;
CREATE POLICY instant_charges_org_policy ON instant_charges
    FOR ALL
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Comments
COMMENT ON TABLE instant_charges IS 'Instant charges triggered when overage exceeds $50 threshold';
COMMENT ON COLUMN instant_charges.usage_at_charge IS 'Total usage count when charge was triggered';
COMMENT ON COLUMN instant_charges.overage_at_charge IS 'Overage amount (calls over limit) when triggered';
COMMENT ON COLUMN instant_charges.status IS 'Status: pending, processing, succeeded, failed';
