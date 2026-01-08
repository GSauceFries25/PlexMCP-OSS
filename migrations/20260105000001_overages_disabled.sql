-- Add overages_disabled flag to organizations
-- When true, the organization will be blocked at their tier limit instead of accruing overages
-- This is automatically true for Free tier, but admins can also enable it for paid tiers

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS overages_disabled BOOLEAN NOT NULL DEFAULT false;

-- Add index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_organizations_overages_disabled
ON organizations (overages_disabled)
WHERE overages_disabled = true;

-- Add audit column for when admin toggled this
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS overages_disabled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS overages_disabled_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS overages_disabled_reason TEXT;

COMMENT ON COLUMN organizations.overages_disabled IS 'When true, org is blocked at tier limit instead of accruing overages. Auto-true for Free tier.';
