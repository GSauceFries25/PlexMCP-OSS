-- Add member status for team member limit enforcement on plan downgrades
-- Supports graceful degradation: excess members get read-only access

-- Add status column to track active/suspended/pending members
ALTER TABLE organization_members
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- Add check constraint for valid status values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_member_status'
    ) THEN
        ALTER TABLE organization_members
        ADD CONSTRAINT chk_member_status
        CHECK (status IN ('active', 'suspended', 'pending'));
    END IF;
END $$;

-- Add timestamp for when member was suspended
ALTER TABLE organization_members
ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

-- Add reason for suspension (e.g., 'plan_downgrade', 'manual', 'billing_issue')
ALTER TABLE organization_members
ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- Index for efficient queries on member status within an organization
CREATE INDEX IF NOT EXISTS idx_org_members_status
ON organization_members(org_id, status);

-- Index for ordering members by join date (newest first for suspension)
CREATE INDEX IF NOT EXISTS idx_org_members_created
ON organization_members(org_id, created_at DESC);

-- Comment explaining the status values
COMMENT ON COLUMN organization_members.status IS 'Member status: active (full access), suspended (read-only due to plan limits), pending (invited but not yet accepted)';
COMMENT ON COLUMN organization_members.suspended_at IS 'Timestamp when member was suspended (null if active)';
COMMENT ON COLUMN organization_members.suspended_reason IS 'Reason for suspension: plan_downgrade, manual, billing_issue, etc.';
