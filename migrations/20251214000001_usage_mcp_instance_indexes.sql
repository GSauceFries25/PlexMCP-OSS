-- Add indexes for mcp_instance_id lookups in analytics queries
-- These indexes improve performance of get_usage_by_mcp() and related analytics
-- that filter on mcp_instance_id

-- Partial index on mcp_instance_id (only non-NULL values)
-- Improves queries like: SELECT ... FROM usage_records WHERE mcp_instance_id IS NOT NULL
CREATE INDEX IF NOT EXISTS idx_usage_records_mcp_instance_id
ON usage_records (mcp_instance_id)
WHERE mcp_instance_id IS NOT NULL;

-- Composite index for common analytics queries that filter by org + mcp + time
-- Supports: get_usage_by_mcp(), get_hourly_usage() with MCP filtering
CREATE INDEX IF NOT EXISTS idx_usage_records_org_mcp_period
ON usage_records (org_id, mcp_instance_id, period_start)
WHERE mcp_instance_id IS NOT NULL;
