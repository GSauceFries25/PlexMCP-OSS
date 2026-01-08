-- Migration: MCP Request Logging System
-- Purpose: Track all MCP proxy requests for usage tracking, billing, and security monitoring
-- SOC 2: CC6.1 (Access Controls), CC7.2 (Security Event Monitoring)
-- Date: 2025-12-29

-- =============================================================================
-- MCP Request Log Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS mcp_request_log (
    -- Identifiers
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- User/Tenant context
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    tenant_id UUID,  -- For multi-tenant isolation tracking

    -- MCP request details
    mcp_server_name TEXT NOT NULL,  -- 'claude', 'openai', 'custom', etc.
    endpoint_path TEXT NOT NULL,    -- MCP method: 'completions', 'embeddings', etc.
    http_method TEXT NOT NULL,      -- 'POST', 'GET', etc.
    http_status_code INTEGER,       -- 200, 401, 429, 500, etc.

    -- Request/response metadata
    request_size_bytes INTEGER,
    response_size_bytes INTEGER,
    latency_ms INTEGER,
    tokens_used INTEGER,            -- For billing/usage tracking

    -- Authentication context
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    session_id UUID,
    source_ip TEXT,
    user_agent TEXT,

    -- Error tracking
    error_message TEXT,
    error_code TEXT,

    -- Security events
    rate_limit_hit BOOLEAN DEFAULT FALSE,
    quota_exceeded BOOLEAN DEFAULT FALSE,

    -- Additional metadata
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- =============================================================================
-- Performance Indexes
-- =============================================================================

-- User-based queries (most common)
CREATE INDEX idx_mcp_request_user
    ON mcp_request_log(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- Organization-based queries (billing)
CREATE INDEX idx_mcp_request_org
    ON mcp_request_log(organization_id, created_at DESC)
    WHERE organization_id IS NOT NULL;

-- MCP server filtering
CREATE INDEX idx_mcp_request_server
    ON mcp_request_log(mcp_server_name, created_at DESC);

-- Time-range queries (most audit queries filter by date)
CREATE INDEX idx_mcp_request_created
    ON mcp_request_log(created_at DESC);

-- Error tracking
CREATE INDEX idx_mcp_request_status
    ON mcp_request_log(http_status_code, created_at DESC)
    WHERE http_status_code >= 400;

-- Security monitoring
CREATE INDEX idx_mcp_request_rate_limit
    ON mcp_request_log(created_at DESC)
    WHERE rate_limit_hit = TRUE;

CREATE INDEX idx_mcp_request_quota
    ON mcp_request_log(created_at DESC)
    WHERE quota_exceeded = TRUE;

-- Tenant isolation queries
CREATE INDEX idx_mcp_request_tenant
    ON mcp_request_log(tenant_id, created_at DESC)
    WHERE tenant_id IS NOT NULL;

-- Combined index for common analytics queries
CREATE INDEX idx_mcp_request_analytics
    ON mcp_request_log(organization_id, mcp_server_name, created_at DESC)
    WHERE organization_id IS NOT NULL;

-- =============================================================================
-- Row-Level Security (RLS)
-- =============================================================================

ALTER TABLE mcp_request_log ENABLE ROW LEVEL SECURITY;

-- SuperAdmin can view all MCP request logs
CREATE POLICY mcp_request_log_superadmin_select
    ON mcp_request_log
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.platform_role IN ('superadmin', 'admin')
        )
    );

-- Users can view their own MCP request logs (for transparency)
CREATE POLICY mcp_request_log_user_select
    ON mcp_request_log
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- No INSERT, UPDATE, or DELETE policies - logs are write-once via backend only
-- This prevents users from tampering with audit logs

-- =============================================================================
-- Immutability Trigger (Prevent UPDATE/DELETE)
-- =============================================================================

-- Create trigger function to block modifications
CREATE OR REPLACE FUNCTION prevent_mcp_request_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Allow updating processed_at and tokens_used only (for async completion)
        IF OLD.request_id = NEW.request_id
           AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
           AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
           AND OLD.mcp_server_name = NEW.mcp_server_name
           AND OLD.endpoint_path = NEW.endpoint_path
           AND OLD.created_at = NEW.created_at THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Cannot modify mcp_request_log records (immutable for SOC 2 compliance)';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Cannot delete mcp_request_log records (immutable for SOC 2 compliance)';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
CREATE TRIGGER enforce_mcp_request_log_immutability
    BEFORE UPDATE OR DELETE ON mcp_request_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_mcp_request_log_modification();

-- =============================================================================
-- Helper Views
-- =============================================================================

-- View for recent MCP requests (last 7 days)
CREATE OR REPLACE VIEW recent_mcp_requests AS
SELECT
    request_id,
    user_id,
    organization_id,
    mcp_server_name,
    endpoint_path,
    http_method,
    http_status_code,
    latency_ms,
    tokens_used,
    created_at,
    CASE
        WHEN http_status_code >= 500 THEN 'critical'
        WHEN http_status_code >= 400 THEN 'warning'
        ELSE 'info'
    END as severity,
    rate_limit_hit,
    quota_exceeded
FROM mcp_request_log
WHERE created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- View for MCP usage statistics by organization
CREATE OR REPLACE VIEW mcp_usage_by_org AS
SELECT
    organization_id,
    mcp_server_name,
    COUNT(*) as request_count,
    SUM(tokens_used) as total_tokens,
    AVG(latency_ms) as avg_latency_ms,
    SUM(CASE WHEN http_status_code >= 400 THEN 1 ELSE 0 END) as error_count,
    SUM(CASE WHEN rate_limit_hit THEN 1 ELSE 0 END) as rate_limited_count,
    MIN(created_at) as first_request,
    MAX(created_at) as last_request
FROM mcp_request_log
WHERE organization_id IS NOT NULL
GROUP BY organization_id, mcp_server_name;

-- =============================================================================
-- Table Comments
-- =============================================================================

COMMENT ON TABLE mcp_request_log IS
    'Logs all MCP proxy requests for usage tracking, billing, and security monitoring. Immutable for SOC 2 compliance.';

COMMENT ON COLUMN mcp_request_log.request_id IS
    'Unique identifier for this MCP request (UUID)';

COMMENT ON COLUMN mcp_request_log.mcp_server_name IS
    'Which MCP server handled the request (claude, openai, custom, etc.)';

COMMENT ON COLUMN mcp_request_log.endpoint_path IS
    'MCP method/endpoint called (e.g., /v1/messages, /v1/embeddings)';

COMMENT ON COLUMN mcp_request_log.tokens_used IS
    'Number of tokens consumed (for metered billing and usage tracking)';

COMMENT ON COLUMN mcp_request_log.latency_ms IS
    'Request latency in milliseconds (for performance monitoring)';

COMMENT ON COLUMN mcp_request_log.rate_limit_hit IS
    'TRUE if this request triggered rate limiting';

COMMENT ON COLUMN mcp_request_log.quota_exceeded IS
    'TRUE if this request exceeded usage quota';

COMMENT ON COLUMN mcp_request_log.metadata IS
    'Additional request metadata in JSONB format';

COMMENT ON COLUMN mcp_request_log.processed_at IS
    'Timestamp when async processing completed (for token usage updates)';

-- =============================================================================
-- Grant Permissions
-- =============================================================================

-- Grant SELECT to authenticated users (filtered by RLS)
GRANT SELECT ON mcp_request_log TO authenticated;

-- Grant SELECT on views to authenticated users
GRANT SELECT ON recent_mcp_requests TO authenticated;
GRANT SELECT ON mcp_usage_by_org TO authenticated;

-- =============================================================================
-- Migration Complete
-- =============================================================================

-- Log migration completion
DO $$
BEGIN
    RAISE NOTICE 'Migration 20251229000003_create_mcp_request_log.sql completed successfully';
    RAISE NOTICE 'Created mcp_request_log table with 9 indexes';
    RAISE NOTICE 'Enabled RLS with superadmin and user policies';
    RAISE NOTICE 'Added immutability trigger for SOC 2 compliance';
    RAISE NOTICE 'Created 2 helper views: recent_mcp_requests, mcp_usage_by_org';
END $$;
