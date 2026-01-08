-- Add timeout configuration columns to mcp_instances table

-- Add timeout columns with defaults
ALTER TABLE mcp_instances
ADD COLUMN IF NOT EXISTS request_timeout_ms INTEGER NOT NULL DEFAULT 30000;

ALTER TABLE mcp_instances
ADD COLUMN IF NOT EXISTS partial_timeout_ms INTEGER;

-- Add constraints to ensure reasonable timeout values
ALTER TABLE mcp_instances
ADD CONSTRAINT check_request_timeout
CHECK (request_timeout_ms >= 100 AND request_timeout_ms <= 120000);

ALTER TABLE mcp_instances
ADD CONSTRAINT check_partial_timeout
CHECK (partial_timeout_ms IS NULL OR (partial_timeout_ms >= 100 AND partial_timeout_ms <= 60000));

-- Add comments for documentation
COMMENT ON COLUMN mcp_instances.request_timeout_ms IS
'Individual MCP request timeout in milliseconds (default 30000ms = 30s). Applies to single requests to this MCP.';

COMMENT ON COLUMN mcp_instances.partial_timeout_ms IS
'Aggregation partial timeout in milliseconds. When aggregating responses from multiple MCPs, return partial results after this timeout instead of waiting for all. NULL = use global default from MCP_PARTIAL_TIMEOUT_MS config.';

-- Add index for performance on active MCPs with timeout queries
CREATE INDEX IF NOT EXISTS idx_mcp_instances_active_timeout
ON mcp_instances (org_id, status, request_timeout_ms)
WHERE status = 'active';
