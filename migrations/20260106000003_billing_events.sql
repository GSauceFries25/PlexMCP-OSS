-- Billing Events: Append-only billing event ledger
-- SOC 2 CC7.1: Maintain complete audit trail of all billing operations
--
-- This table records all billing events to enable:
-- - "Why is this user on this tier?" debugging
-- - Billing state reconstruction if needed
-- - Compliance audit trails
-- - Pattern analysis and anomaly detection

CREATE TABLE IF NOT EXISTS billing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Event type classification
    event_type VARCHAR(50) NOT NULL,
    event_subtype VARCHAR(50),

    -- Event data (flexible JSON for event-specific details)
    event_data JSONB NOT NULL DEFAULT '{}',

    -- Stripe references (for cross-referencing)
    stripe_event_id TEXT,
    stripe_invoice_id TEXT,
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,

    -- Actor information (who caused this event)
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_type VARCHAR(20) NOT NULL DEFAULT 'system',  -- 'user', 'admin', 'system', 'stripe'

    -- Entitlement snapshot at time of event (for debugging)
    entitlement_snapshot JSONB,

    -- Standard timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_billing_events_org_id
    ON billing_events(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_type
    ON billing_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_event
    ON billing_events(stripe_event_id)
    WHERE stripe_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_events_actor
    ON billing_events(actor_id, created_at DESC)
    WHERE actor_id IS NOT NULL;

-- Enable RLS
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;

-- Only service_role can write billing events (internal only)
CREATE POLICY billing_events_service_only ON billing_events
    FOR ALL
    TO postgres, service_role
    USING (true)
    WITH CHECK (true);

-- Block regular users from accessing billing events directly
CREATE POLICY billing_events_block_users ON billing_events
    FOR ALL
    TO authenticated
    USING (false);

-- Grant access to service role
GRANT ALL ON billing_events TO service_role;

-- Comments for documentation
COMMENT ON TABLE billing_events IS 'Append-only ledger of all billing events for audit and debugging';
COMMENT ON COLUMN billing_events.event_type IS 'Event category: SUBSCRIPTION_CREATED, TIER_CHANGED, INVOICE_PAID, etc.';
COMMENT ON COLUMN billing_events.event_subtype IS 'Optional subcategory for more specific classification';
COMMENT ON COLUMN billing_events.event_data IS 'Event-specific data in JSON format';
COMMENT ON COLUMN billing_events.actor_type IS 'Who triggered this event: user, admin, system, or stripe';
COMMENT ON COLUMN billing_events.entitlement_snapshot IS 'Snapshot of entitlement state at event time';

-- Event type reference (for documentation):
-- SUBSCRIPTION_CREATED - New subscription created
-- SUBSCRIPTION_UPDATED - Subscription modified
-- SUBSCRIPTION_CANCELED - Subscription canceled
-- TIER_CHANGED - User tier changed
-- TIER_CHANGE_SCHEDULED - Downgrade scheduled for end of period
-- TIER_CHANGE_COMPLETED - Scheduled tier change executed
-- TRIAL_STARTED - Trial period began
-- TRIAL_ENDED - Trial period ended
-- INVOICE_CREATED - Invoice generated
-- INVOICE_PAID - Invoice payment successful
-- INVOICE_FAILED - Invoice payment failed
-- CREDIT_APPLIED - Proration credit applied
-- OVERAGE_RECORDED - API overage recorded
-- OVERAGE_CHARGED - Overage charge created
-- INSTANT_CHARGE - Instant charge triggered ($50+ threshold)
-- ORG_PAUSED - Organization paused due to spend cap
-- ORG_UNPAUSED - Organization unpaused
-- SPEND_CAP_SET - Spend cap configured
-- SPEND_CAP_THRESHOLD - Spend cap threshold notification
-- REFUND_ISSUED - Refund processed
-- DISPUTE_CREATED - Chargeback/dispute opened
-- DISPUTE_RESOLVED - Dispute resolved
-- ADMIN_OVERRIDE - Admin manually changed billing state
-- ENTERPRISE_LIMITS_SET - Custom enterprise limits configured

-- Rollback:
-- DROP TABLE IF EXISTS billing_events;
