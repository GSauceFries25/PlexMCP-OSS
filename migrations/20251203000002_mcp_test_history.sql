-- MCP Test History table for storing test results
-- This enables the troubleshooting page with test history

CREATE TABLE mcp_test_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mcp_id UUID NOT NULL REFERENCES mcp_instances(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    health_status VARCHAR(50) NOT NULL,
    protocol_version VARCHAR(50),
    server_name VARCHAR(255),
    server_version VARCHAR(255),
    tools_count INTEGER,
    resources_count INTEGER,
    latency_ms INTEGER NOT NULL,
    error_message TEXT,
    tested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    tested_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Index for fetching history by MCP (most common query)
CREATE INDEX idx_mcp_test_history_mcp ON mcp_test_history(mcp_id);

-- Index for fetching history by organization
CREATE INDEX idx_mcp_test_history_org ON mcp_test_history(org_id);

-- Index for ordering by test time (descending for most recent first)
CREATE INDEX idx_mcp_test_history_tested_at ON mcp_test_history(tested_at DESC);

-- Composite index for common query: get latest tests for an MCP
CREATE INDEX idx_mcp_test_history_mcp_time ON mcp_test_history(mcp_id, tested_at DESC);

-- Comment for documentation
COMMENT ON TABLE mcp_test_history IS 'Stores historical MCP connection test results for troubleshooting';
