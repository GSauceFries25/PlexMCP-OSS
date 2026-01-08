-- PlexMCP Admin Analytics Performance Indexes
-- Migration: 20251224000002_analytics_indexes.sql

-- =============================================================================
-- Usage Records Indexes for Analytics Queries
-- =============================================================================

-- Covering index for time-range aggregation queries
-- Allows efficient SUM/AVG without hitting the table for common metrics
CREATE INDEX IF NOT EXISTS idx_usage_records_period_agg
ON usage_records(period_start)
INCLUDE (request_count, error_count, token_count, latency_ms_avg, org_id);

-- Index for MCP-specific time series queries
CREATE INDEX IF NOT EXISTS idx_usage_records_mcp_period
ON usage_records(mcp_instance_id, period_start)
WHERE mcp_instance_id IS NOT NULL;

-- Index for API key usage analysis
CREATE INDEX IF NOT EXISTS idx_usage_records_apikey_period
ON usage_records(api_key_id, period_start)
WHERE api_key_id IS NOT NULL;

-- =============================================================================
-- User Activity Indexes
-- =============================================================================

-- Index for active user queries (last login)
CREATE INDEX IF NOT EXISTS idx_users_last_login
ON users(last_login_at DESC)
WHERE last_login_at IS NOT NULL;

-- Index for user signup trends
CREATE INDEX IF NOT EXISTS idx_users_created_at
ON users(created_at DESC);

-- =============================================================================
-- Organization Analytics Indexes
-- =============================================================================

-- Index for subscription status queries
CREATE INDEX IF NOT EXISTS idx_organizations_tier
ON organizations(subscription_tier);

-- Index for organizations with status (only if status column exists)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'organizations' AND column_name = 'status'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_organizations_status
        ON organizations(status)
        WHERE status IS NOT NULL;
    END IF;
END $$;

-- =============================================================================
-- MCP Instances Indexes for Analytics
-- =============================================================================

-- Index for counting MCPs by org
CREATE INDEX IF NOT EXISTS idx_mcp_instances_org
ON mcp_instances(org_id);

-- Index for MCP health status distribution
CREATE INDEX IF NOT EXISTS idx_mcp_instances_status
ON mcp_instances(status);

-- =============================================================================
-- API Keys Analytics Indexes
-- =============================================================================

-- Index for API key last usage tracking
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used
ON api_keys(last_used_at DESC)
WHERE last_used_at IS NOT NULL;

-- Index for API keys by org
CREATE INDEX IF NOT EXISTS idx_api_keys_org
ON api_keys(org_id);

-- =============================================================================
-- Materialized View for Daily Platform Stats (Optional Performance Boost)
-- =============================================================================

-- This view pre-aggregates daily stats for faster dashboard queries
-- Refresh manually or via cron: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_platform_stats;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_platform_stats AS
SELECT
    date_trunc('day', period_start) AS stat_date,
    SUM(request_count)::BIGINT AS total_requests,
    SUM(error_count)::BIGINT AS total_errors,
    SUM(token_count)::BIGINT AS total_tokens,
    AVG(latency_ms_avg)::INTEGER AS avg_latency_ms,
    COUNT(DISTINCT org_id)::INTEGER AS unique_orgs,
    COUNT(DISTINCT api_key_id)::INTEGER AS unique_api_keys,
    COUNT(DISTINCT mcp_instance_id)::INTEGER AS unique_mcps
FROM usage_records
WHERE period_start >= NOW() - INTERVAL '90 days'
GROUP BY date_trunc('day', period_start);

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_stats_date
ON mv_daily_platform_stats(stat_date);

-- =============================================================================
-- Materialized View for Hourly Stats (Last 7 Days)
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_platform_stats AS
SELECT
    date_trunc('hour', period_start) AS stat_hour,
    SUM(request_count)::BIGINT AS total_requests,
    SUM(error_count)::BIGINT AS total_errors,
    SUM(token_count)::BIGINT AS total_tokens,
    AVG(latency_ms_avg)::INTEGER AS avg_latency_ms,
    COUNT(DISTINCT org_id)::INTEGER AS unique_orgs
FROM usage_records
WHERE period_start >= NOW() - INTERVAL '7 days'
GROUP BY date_trunc('hour', period_start);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_hourly_stats_hour
ON mv_hourly_platform_stats(stat_hour);

-- =============================================================================
-- Revenue/Billing Indexes
-- =============================================================================

-- Check if spend_caps table exists before creating index
DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_spend_caps_utilization
    ON spend_caps(org_id, current_period_spend_cents, cap_amount_cents);
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;

-- Check if overage_charges table exists
DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_overage_charges_created
    ON overage_charges(created_at DESC);
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;

-- =============================================================================
-- Admin Audit Log Indexes for Analytics
-- =============================================================================

-- Check if admin_audit_log exists
DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_admin_audit_action
    ON admin_audit_log(action, created_at DESC);
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON MATERIALIZED VIEW mv_daily_platform_stats IS 'Pre-aggregated daily stats for admin dashboard. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_platform_stats';
COMMENT ON MATERIALIZED VIEW mv_hourly_platform_stats IS 'Pre-aggregated hourly stats for real-time dashboard. Refresh frequently.';
