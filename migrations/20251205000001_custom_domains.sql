-- Custom domains table for the Custom Domain addon
-- Allows users to use their own domain (e.g., mcp.company.com)
-- instead of the default subdomain
--
-- Note: This migration uses user_id to reference the existing users table
-- since the organizations table is not yet deployed in production.

-- Domain verification and SSL status tracking
DO $$ BEGIN
  CREATE TYPE domain_status AS ENUM (
    'pending',      -- Awaiting DNS verification
    'verifying',    -- Currently checking DNS records
    'verified',     -- DNS verified, SSL pending
    'active',       -- Fully active with SSL
    'failed',       -- Verification failed
    'expired'       -- Domain removed or cert expired
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS custom_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Domain configuration
    domain VARCHAR(255) NOT NULL,
    subdomain VARCHAR(255), -- Optional subdomain prefix (e.g., "mcp" for mcp.company.com)

    -- Verification
    verification_token VARCHAR(255) NOT NULL,
    verification_status domain_status NOT NULL DEFAULT 'pending',
    verification_attempts INT NOT NULL DEFAULT 0,
    last_verification_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,

    -- SSL/TLS
    ssl_status domain_status NOT NULL DEFAULT 'pending',
    ssl_provisioned_at TIMESTAMPTZ,
    ssl_expires_at TIMESTAMPTZ,

    -- DNS records the user needs to add
    -- CNAME: domain -> proxy.plexmcp.com
    -- TXT: _plexmcp-verification.domain -> verification_token
    cname_target VARCHAR(255) NOT NULL DEFAULT 'proxy.plexmcp.com',

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    UNIQUE(domain),
    UNIQUE(user_id, subdomain) -- Each user can only use each subdomain once
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_custom_domains_user ON custom_domains(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_domains_status ON custom_domains(verification_status);
CREATE INDEX IF NOT EXISTS idx_custom_domains_domain ON custom_domains(domain);

-- Index for finding domains that need verification
CREATE INDEX IF NOT EXISTS idx_custom_domains_pending ON custom_domains(verification_status, last_verification_at)
    WHERE verification_status IN ('pending', 'verifying');

-- Enable Row Level Security
ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;

-- Users can only see their own domains
DROP POLICY IF EXISTS custom_domains_select ON custom_domains;
CREATE POLICY custom_domains_select ON custom_domains
    FOR SELECT
    USING (user_id = auth.uid());

-- Users can only insert their own domains
DROP POLICY IF EXISTS custom_domains_insert ON custom_domains;
CREATE POLICY custom_domains_insert ON custom_domains
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Users can only update their own domains
DROP POLICY IF EXISTS custom_domains_update ON custom_domains;
CREATE POLICY custom_domains_update ON custom_domains
    FOR UPDATE
    USING (user_id = auth.uid());

-- Users can only delete their own domains
DROP POLICY IF EXISTS custom_domains_delete ON custom_domains;
CREATE POLICY custom_domains_delete ON custom_domains
    FOR DELETE
    USING (user_id = auth.uid());

-- Trigger to update updated_at
-- Drop trigger first to make migration idempotent
DROP TRIGGER IF EXISTS custom_domains_updated_at ON custom_domains;

-- Create trigger using whichever function exists
DO $$ BEGIN
  CREATE TRIGGER custom_domains_updated_at
      BEFORE UPDATE ON custom_domains
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_updated_at();
EXCEPTION
  WHEN undefined_function THEN
    -- Fall back to update_updated_at_column if trigger_set_updated_at doesn't exist
    CREATE TRIGGER custom_domains_updated_at
      BEFORE UPDATE ON custom_domains
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
END $$;

-- Comment for documentation
COMMENT ON TABLE custom_domains IS 'Custom domains for users using the Custom Domain addon';
COMMENT ON COLUMN custom_domains.verification_token IS 'Token user adds to TXT record for domain verification';
COMMENT ON COLUMN custom_domains.cname_target IS 'CNAME target for the custom domain to point to';
