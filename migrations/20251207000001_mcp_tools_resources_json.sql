-- Add JSONB columns to store full tools and resources data from MCP health checks
-- This allows displaying actual tool names/descriptions in the UI instead of just counts

ALTER TABLE mcp_instances ADD COLUMN IF NOT EXISTS tools_json JSONB;
ALTER TABLE mcp_instances ADD COLUMN IF NOT EXISTS resources_json JSONB;

-- Add comments for documentation
COMMENT ON COLUMN mcp_instances.tools_json IS 'Full tool list from MCP tools/list response, stored as JSON array';
COMMENT ON COLUMN mcp_instances.resources_json IS 'Full resource list from MCP resources/list response, stored as JSON array';
