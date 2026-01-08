-- Add unique index for atomic upsert operations on overage_charges
-- This enables ON CONFLICT ... DO UPDATE for real-time overage tracking
-- Date: 2024-12-17

-- First drop the existing non-unique index if it exists (we're replacing it with unique)
DROP INDEX IF EXISTS idx_overage_charges_org_period_type;

-- Create unique composite index for upsert operations
-- This ensures one overage record per org/period/resource combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_overage_charges_org_period_type
ON overage_charges(org_id, billing_period_start, resource_type);

COMMENT ON INDEX idx_overage_charges_org_period_type IS
  'Unique index enabling atomic upsert for real-time overage tracking';
