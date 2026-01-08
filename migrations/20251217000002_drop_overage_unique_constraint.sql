-- Drop unique constraint on overage_charges to allow incremental charges
-- When a user pays early, we need to create additional charges for new usage
-- Date: 2024-12-17

-- Drop the unique index that prevents multiple charges per billing period
DROP INDEX IF EXISTS idx_overage_charges_org_period_type;

-- Create a non-unique index for efficient lookups (still need fast queries)
CREATE INDEX IF NOT EXISTS idx_overage_charges_org_period_type
ON overage_charges(org_id, billing_period_start, resource_type);

-- Add an index for finding pending charges quickly
CREATE INDEX IF NOT EXISTS idx_overage_charges_org_period_pending
ON overage_charges(org_id, billing_period_start, resource_type)
WHERE status = 'pending';

COMMENT ON INDEX idx_overage_charges_org_period_type IS
  'Non-unique index for efficient overage lookups by org/period/resource';
