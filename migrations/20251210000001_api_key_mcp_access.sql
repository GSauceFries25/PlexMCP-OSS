-- PlexMCP API Key MCP Access Control
-- Migration: 20251210000001_api_key_mcp_access.sql
--
-- Adds MCP access control columns to api_keys table:
-- - mcp_access_mode: Controls how the API key accesses MCPs ('all', 'selected', 'none')
-- - allowed_mcp_ids: Array of MCP IDs this key can access (when mode is 'selected')

-- Add mcp_access_mode column (default 'all' for backward compatibility)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS mcp_access_mode VARCHAR(20) NOT NULL DEFAULT 'all';

-- Add allowed_mcp_ids column (nullable UUID array)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_mcp_ids UUID[] DEFAULT NULL;

-- Add index for efficient filtering on allowed_mcp_ids
CREATE INDEX IF NOT EXISTS idx_api_keys_allowed_mcps ON api_keys USING GIN(allowed_mcp_ids);

-- Add check constraint to ensure valid access modes
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_mcp_access_mode_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_mcp_access_mode_check
  CHECK (mcp_access_mode IN ('all', 'selected', 'none'));

-- Add comment for documentation
COMMENT ON COLUMN api_keys.mcp_access_mode IS 'Controls MCP access: all (default), selected (use allowed_mcp_ids), or none (disabled)';
COMMENT ON COLUMN api_keys.allowed_mcp_ids IS 'When mcp_access_mode=selected, only these MCP IDs are accessible via this key';
