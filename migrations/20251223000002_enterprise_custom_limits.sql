-- Enterprise Custom Limits Migration
-- Adds custom limit columns to organizations table and audit trail

-- Add custom limit columns to organizations table
-- NULL = use tier default, value = custom override

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_max_mcps INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_max_api_keys INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_max_team_members INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_max_requests_monthly BIGINT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_overage_rate_cents INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_monthly_price_cents INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_limits_notes TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_limits_updated_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_limits_updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Audit table for tracking all custom limit changes
CREATE TABLE IF NOT EXISTS enterprise_limit_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    change_type VARCHAR(50) NOT NULL, -- 'set', 'update', 'remove'
    field_name VARCHAR(50) NOT NULL, -- 'max_mcps', 'max_api_keys', etc.
    old_value BIGINT,
    new_value BIGINT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_changes_org ON enterprise_limit_changes(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enterprise_changes_by ON enterprise_limit_changes(changed_by);

-- Add comments explaining the custom limit system
COMMENT ON COLUMN organizations.custom_max_mcps IS
    'Custom MCP limit for enterprise orgs. NULL = use tier default.';
COMMENT ON COLUMN organizations.custom_max_api_keys IS
    'Custom API key limit for enterprise orgs. NULL = use tier default.';
COMMENT ON COLUMN organizations.custom_max_team_members IS
    'Custom team member limit for enterprise orgs. NULL = use tier default.';
COMMENT ON COLUMN organizations.custom_max_requests_monthly IS
    'Custom monthly request limit for enterprise orgs. NULL = use tier default.';
COMMENT ON COLUMN organizations.custom_overage_rate_cents IS
    'Custom overage rate per 1K requests in cents. NULL = use tier default.';
COMMENT ON COLUMN organizations.custom_monthly_price_cents IS
    'Custom monthly subscription price in cents. NULL = use Stripe price.';
