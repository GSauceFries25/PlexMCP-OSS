-- Add custom domain and subdomain columns to organizations table
-- Migration: 20251130000002_custom_domains

-- Add custom subdomain column (e.g., "yourcompany" for yourcompany.mcp.plexmcp.com)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'custom_subdomain') THEN
    ALTER TABLE organizations ADD COLUMN custom_subdomain VARCHAR(255) UNIQUE;
  END IF;
END $$;

-- Add custom domain column (e.g., "mcp.yourcompany.com")
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'custom_domain') THEN
    ALTER TABLE organizations ADD COLUMN custom_domain VARCHAR(255);
  END IF;
END $$;

-- Add verification status for custom domains
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'custom_domain_verified') THEN
    ALTER TABLE organizations ADD COLUMN custom_domain_verified BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add timestamp for when custom domain was verified
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'custom_domain_verified_at') THEN
    ALTER TABLE organizations ADD COLUMN custom_domain_verified_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add domain_type to track which option is active
-- Values: 'auto' (default generated), 'custom_subdomain', 'custom_domain'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'domain_type') THEN
    ALTER TABLE organizations ADD COLUMN domain_type VARCHAR(50) DEFAULT 'auto';
  END IF;
END $$;

-- Create index on custom_subdomain for fast lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_organizations_custom_subdomain ON organizations(custom_subdomain) WHERE custom_subdomain IS NOT NULL;

-- Create index on custom_domain for fast lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_organizations_custom_domain ON organizations(custom_domain) WHERE custom_domain IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN organizations.custom_subdomain IS 'Custom subdomain (e.g., "acme" for acme.mcp.plexmcp.com)';
COMMENT ON COLUMN organizations.custom_domain IS 'Custom domain (e.g., "mcp.acme.com")';
COMMENT ON COLUMN organizations.custom_domain_verified IS 'Whether the custom domain has been verified via CNAME record';
COMMENT ON COLUMN organizations.custom_domain_verified_at IS 'Timestamp when custom domain was verified';
COMMENT ON COLUMN organizations.domain_type IS 'Active domain type: auto, custom_subdomain, or custom_domain';
