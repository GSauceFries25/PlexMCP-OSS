-- Add custom_subdomain column for paid tier users to set custom subdomains
-- Example: "acme" for acme.plexmcp.com (instead of auto-generated deep-cliff-900.plexmcp.com)

-- =============================================================================
-- Add custom_subdomain Column
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'custom_subdomain'
  ) THEN
    ALTER TABLE organizations ADD COLUMN custom_subdomain VARCHAR(255) UNIQUE;
  END IF;
END $$;

-- =============================================================================
-- Index for Fast Routing Lookups
-- =============================================================================

-- Create index for routing by custom_subdomain
CREATE INDEX IF NOT EXISTS idx_organizations_custom_subdomain_routing
  ON organizations(custom_subdomain) WHERE custom_subdomain IS NOT NULL;

-- =============================================================================
-- Comments for Documentation
-- =============================================================================

COMMENT ON COLUMN organizations.custom_subdomain IS 'Optional custom subdomain set by paid tier users (e.g., acme for acme.plexmcp.com). Must be unique across all orgs.';
