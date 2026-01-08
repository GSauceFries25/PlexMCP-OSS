-- MCP Proxy Tables
-- Cache upstream MCP capabilities and track proxy usage

-- Cache upstream MCP capabilities (tools, resources, prompts)
-- This avoids repeatedly querying upstream MCPs for their capabilities
CREATE TABLE IF NOT EXISTS mcp_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mcp_id UUID NOT NULL REFERENCES mcp_instances(id) ON DELETE CASCADE,
    -- Server capabilities returned from initialize
    capabilities JSONB NOT NULL DEFAULT '{}',
    -- Cached tool definitions
    tools JSONB NOT NULL DEFAULT '[]',
    -- Cached resource definitions
    resources JSONB NOT NULL DEFAULT '[]',
    -- Cached prompt definitions
    prompts JSONB NOT NULL DEFAULT '[]',
    -- Protocol version negotiated with upstream
    protocol_version VARCHAR(50),
    -- Server info from upstream
    server_info JSONB,
    -- When the cache was last updated
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Cache TTL (default 5 minutes)
    cache_ttl_seconds INTEGER NOT NULL DEFAULT 300,
    UNIQUE(mcp_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_mcp_capabilities_mcp_id ON mcp_capabilities(mcp_id);
CREATE INDEX IF NOT EXISTS idx_mcp_capabilities_cached_at ON mcp_capabilities(cached_at);

-- Track MCP proxy requests for usage analytics and debugging
CREATE TABLE IF NOT EXISTS mcp_proxy_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- API key used for the request
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    -- Target MCP (NULL for aggregated requests like tools/list)
    mcp_id UUID REFERENCES mcp_instances(id) ON DELETE SET NULL,
    -- JSON-RPC method called
    method VARCHAR(100) NOT NULL,
    -- Tool name (for tools/call requests)
    tool_name VARCHAR(255),
    -- Resource URI (for resources/read requests)
    resource_uri TEXT,
    -- Request status: success, error, timeout
    status VARCHAR(50) NOT NULL,
    -- Response latency in milliseconds
    latency_ms INTEGER,
    -- Error message if status is error
    error_message TEXT,
    -- Request timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_mcp_proxy_logs_api_key ON mcp_proxy_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_mcp_proxy_logs_mcp_id ON mcp_proxy_logs(mcp_id);
CREATE INDEX IF NOT EXISTS idx_mcp_proxy_logs_method ON mcp_proxy_logs(method);
CREATE INDEX IF NOT EXISTS idx_mcp_proxy_logs_created ON mcp_proxy_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_proxy_logs_status ON mcp_proxy_logs(status);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_mcp_proxy_logs_api_key_created
    ON mcp_proxy_logs(api_key_id, created_at DESC);

-- Enable RLS on new tables
ALTER TABLE mcp_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_proxy_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for mcp_capabilities (org-based access)
CREATE POLICY mcp_capabilities_org_access ON mcp_capabilities
    FOR ALL
    USING (
        mcp_id IN (
            SELECT id FROM mcp_instances WHERE org_id IN (
                SELECT org_id FROM organization_members WHERE user_id = auth.uid()
            )
        )
    );

-- RLS policies for mcp_proxy_logs (org-based access via api_key)
CREATE POLICY mcp_proxy_logs_org_access ON mcp_proxy_logs
    FOR ALL
    USING (
        api_key_id IN (
            SELECT id FROM api_keys WHERE org_id IN (
                SELECT org_id FROM organization_members WHERE user_id = auth.uid()
            )
        )
    );

-- Function to automatically clean up old proxy logs (keep 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_proxy_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM mcp_proxy_logs
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Comment on tables
COMMENT ON TABLE mcp_capabilities IS 'Cache for upstream MCP server capabilities';
COMMENT ON TABLE mcp_proxy_logs IS 'Request logs for MCP proxy usage tracking and analytics';
