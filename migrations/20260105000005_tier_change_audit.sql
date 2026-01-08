-- Tier Change Audit: Comprehensive audit trail for all tier changes
-- This migration creates an audit table to track all tier changes from
-- any source (admin, user, webhook, system) with full context.
--
-- SOC 2 CC5.2: Maintain audit trails for significant changes

-- Create tier change audit table
CREATE TABLE IF NOT EXISTS tier_change_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    from_tier VARCHAR(50) NOT NULL,
    to_tier VARCHAR(50) NOT NULL,
    source VARCHAR(50) NOT NULL,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    options JSONB,  -- Store full TierChangeOptions for debugging
    stripe_event_id TEXT,  -- Link to Stripe event if triggered by webhook
    metadata JSONB,  -- Additional context (custom pricing, trial info, etc.)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding tier changes by organization
CREATE INDEX IF NOT EXISTS idx_tier_change_audit_org
    ON tier_change_audit(org_id, created_at DESC);

-- Index for finding tier changes by source (admin, user, webhook, system)
CREATE INDEX IF NOT EXISTS idx_tier_change_audit_source
    ON tier_change_audit(source, created_at DESC);

-- Index for finding tier changes by admin user
CREATE INDEX IF NOT EXISTS idx_tier_change_audit_changed_by
    ON tier_change_audit(changed_by, created_at DESC)
    WHERE changed_by IS NOT NULL;

-- Constraint to ensure source is a valid value
ALTER TABLE tier_change_audit ADD CONSTRAINT chk_tier_change_source
    CHECK (source IN ('admin', 'user', 'webhook', 'system', 'admin_panel', 'user_upgrade', 'user_downgrade', 'stripe_webhook'));

-- Enable RLS
ALTER TABLE tier_change_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_change_audit FORCE ROW LEVEL SECURITY;

-- Only allow internal/admin access
CREATE POLICY tier_change_audit_admin_read ON tier_change_audit
    FOR SELECT
    TO postgres, service_role
    USING (true);

CREATE POLICY tier_change_audit_internal_insert ON tier_change_audit
    FOR INSERT
    TO postgres, service_role
    WITH CHECK (true);

-- Block authenticated users from direct access
CREATE POLICY tier_change_audit_block_users ON tier_change_audit
    FOR ALL
    TO authenticated
    USING (false);

-- Grant access to service role
GRANT SELECT, INSERT ON tier_change_audit TO service_role;

-- Comments for documentation
COMMENT ON TABLE tier_change_audit IS 'Audit trail for all subscription tier changes (SOC 2 CC5.2)';
COMMENT ON COLUMN tier_change_audit.source IS 'Source of change: admin_panel, user_upgrade, user_downgrade, stripe_webhook, system';
COMMENT ON COLUMN tier_change_audit.options IS 'Full TierChangeOptions struct as JSON for debugging';
COMMENT ON COLUMN tier_change_audit.metadata IS 'Additional context: custom_price_cents, trial_days, etc.';

-- Rollback:
-- DROP TABLE IF EXISTS tier_change_audit CASCADE;
