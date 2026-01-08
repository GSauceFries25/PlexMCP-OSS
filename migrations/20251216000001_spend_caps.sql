-- Migration: Spend caps with hard pause functionality
-- Allows users to set spending limits with optional API pause when exceeded

CREATE TABLE IF NOT EXISTS spend_caps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

    -- Spend cap configuration
    cap_amount_cents INTEGER NOT NULL,
    hard_pause_enabled BOOLEAN NOT NULL DEFAULT false,
    is_paused BOOLEAN NOT NULL DEFAULT false,
    paused_at TIMESTAMPTZ,

    -- Current period tracking
    current_period_spend_cents INTEGER NOT NULL DEFAULT 0,
    last_charge_at TIMESTAMPTZ,

    -- Admin override (temporary bypass)
    override_until TIMESTAMPTZ,
    override_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    override_reason TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_spend_caps_org ON spend_caps(org_id);
CREATE INDEX IF NOT EXISTS idx_spend_caps_paused ON spend_caps(is_paused) WHERE is_paused = true;

-- Enable RLS
ALTER TABLE spend_caps ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Organization isolation
DROP POLICY IF EXISTS spend_caps_org_policy ON spend_caps;
CREATE POLICY spend_caps_org_policy ON spend_caps
    FOR ALL
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Comments
COMMENT ON TABLE spend_caps IS 'User-configurable spend limits with optional hard pause';
COMMENT ON COLUMN spend_caps.cap_amount_cents IS 'Monthly spend limit in cents';
COMMENT ON COLUMN spend_caps.hard_pause_enabled IS 'If true, API access is paused when cap is exceeded';
COMMENT ON COLUMN spend_caps.is_paused IS 'Current pause state - checked on every API request';
COMMENT ON COLUMN spend_caps.current_period_spend_cents IS 'Accumulated overage spend in current billing period';
COMMENT ON COLUMN spend_caps.override_until IS 'Temporary override expiry for admin bypass';
