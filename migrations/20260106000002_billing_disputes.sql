-- Billing Disputes: Track Stripe chargebacks/disputes
-- CRITICAL: Disputes require immediate attention and can result in financial penalties
--
-- This table tracks dispute events from Stripe's charge.dispute.* webhooks
-- to enable admin visibility and response tracking.

CREATE TABLE IF NOT EXISTS billing_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    stripe_dispute_id TEXT UNIQUE NOT NULL,
    stripe_charge_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    reason TEXT,
    status TEXT NOT NULL,
    response_due_by TIMESTAMPTZ,
    evidence_submitted BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding disputes by org
CREATE INDEX IF NOT EXISTS idx_billing_disputes_org_id
    ON billing_disputes(org_id);

-- Index for finding active disputes
CREATE INDEX IF NOT EXISTS idx_billing_disputes_status
    ON billing_disputes(status)
    WHERE status NOT IN ('won', 'lost');

-- Enable RLS
ALTER TABLE billing_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_disputes FORCE ROW LEVEL SECURITY;

-- Only service_role can access disputes (admin-only data)
CREATE POLICY billing_disputes_service_only ON billing_disputes
    FOR ALL
    TO postgres, service_role
    USING (true)
    WITH CHECK (true);

-- Block regular users from accessing dispute data
CREATE POLICY billing_disputes_block_users ON billing_disputes
    FOR ALL
    TO authenticated
    USING (false);

-- Grant access to service role
GRANT ALL ON billing_disputes TO service_role;

-- Comment
COMMENT ON TABLE billing_disputes IS 'Tracks Stripe charge disputes (chargebacks) for admin review';

-- Rollback:
-- DROP TABLE IF EXISTS billing_disputes;
