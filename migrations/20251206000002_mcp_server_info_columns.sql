-- Add server info columns to mcp_instances table
-- These are populated during health checks and displayed in the Testing page

ALTER TABLE mcp_instances ADD COLUMN IF NOT EXISTS protocol_version TEXT;
ALTER TABLE mcp_instances ADD COLUMN IF NOT EXISTS server_name TEXT;
ALTER TABLE mcp_instances ADD COLUMN IF NOT EXISTS server_version TEXT;
ALTER TABLE mcp_instances ADD COLUMN IF NOT EXISTS tools_count INTEGER;
ALTER TABLE mcp_instances ADD COLUMN IF NOT EXISTS resources_count INTEGER;
ALTER TABLE mcp_instances ADD COLUMN IF NOT EXISTS last_latency_ms INTEGER;
