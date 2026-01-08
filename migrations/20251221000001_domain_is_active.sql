-- Add is_active column to custom_domains table
-- This allows users to temporarily disable a custom domain without deleting it

ALTER TABLE custom_domains
ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN custom_domains.is_active IS 'Whether the custom domain is enabled for routing. When false, falls back to default subdomain.';
