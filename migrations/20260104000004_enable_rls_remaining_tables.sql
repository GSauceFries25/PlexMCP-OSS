-- Enable RLS on remaining tables
-- SOC 2 CC6.1: Defense-in-depth - database-level access controls
-- This migration ensures all tables have RLS enabled with appropriate policies
-- Tables that don't exist are silently skipped (for test environments)

-- Helper function to enable RLS on a table if it exists
CREATE OR REPLACE FUNCTION enable_rls_if_exists(p_table TEXT)
RETURNS VOID AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = p_table AND table_schema = 'public') THEN
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', p_table);

        -- Create backend policy if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = p_table AND policyname = p_table || '_backend') THEN
            EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO postgres USING (true)', p_table || '_backend', p_table);
        END IF;

        -- Create service policy if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = p_table AND policyname = p_table || '_service') THEN
            EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO service_role USING (true)', p_table || '_service', p_table);
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SYSTEM/CONFIG TABLES (Backend-only access)
-- These tables contain system configuration, not user data
-- =============================================================================

SELECT enable_rls_if_exists('_sqlx_migrations');
SELECT enable_rls_if_exists('admin_users');
SELECT enable_rls_if_exists('system_config');

-- Apply RLS to all remaining tables using helper function
SELECT enable_rls_if_exists('subscription_tier_config');
SELECT enable_rls_if_exists('api_key_expiration_presets');
SELECT enable_rls_if_exists('api_key_roles');
SELECT enable_rls_if_exists('api_scopes');
SELECT enable_rls_if_exists('client_types');

-- Pattern/ML tables
SELECT enable_rls_if_exists('global_patterns');
SELECT enable_rls_if_exists('learned_patterns');
SELECT enable_rls_if_exists('semantic_patterns');
SELECT enable_rls_if_exists('llm_training_data');
SELECT enable_rls_if_exists('misjudgment_corrections');
SELECT enable_rls_if_exists('cheating_detections');
SELECT enable_rls_if_exists('guidance_warnings');
SELECT enable_rls_if_exists('validation_history');

-- Organization-scoped tables
SELECT enable_rls_if_exists('orgs');
SELECT enable_rls_if_exists('user_org_memberships');
SELECT enable_rls_if_exists('invitations');
SELECT enable_rls_if_exists('mcp_instances');
SELECT enable_rls_if_exists('mcp_entries');
SELECT enable_rls_if_exists('mcp_addresses');
SELECT enable_rls_if_exists('org_mcp_configs');
SELECT enable_rls_if_exists('oauth_clients');

-- Gateway tables
SELECT enable_rls_if_exists('gateway_instances');
SELECT enable_rls_if_exists('gateway_mcp_bindings');
SELECT enable_rls_if_exists('gateway_requests');
SELECT enable_rls_if_exists('gateway_metrics_hourly');

-- Usage/billing tables
SELECT enable_rls_if_exists('usage_records');
SELECT enable_rls_if_exists('usage_tracking_archive');
SELECT enable_rls_if_exists('usage_alerts');
SELECT enable_rls_if_exists('tier_usage_analytics');
SELECT enable_rls_if_exists('auto_reload_history');
SELECT enable_rls_if_exists('subscription_addons');
SELECT enable_rls_if_exists('subscription_events');

-- Alert/monitoring tables
SELECT enable_rls_if_exists('alert_configs');
SELECT enable_rls_if_exists('alert_history');
SELECT enable_rls_if_exists('cache_metrics');
SELECT enable_rls_if_exists('openrouter_model_stats');

-- Agent/task tables
SELECT enable_rls_if_exists('agents');
SELECT enable_rls_if_exists('task_executions');
SELECT enable_rls_if_exists('task_actions');
SELECT enable_rls_if_exists('task_screenshots');

-- Webhook/event tables
SELECT enable_rls_if_exists('webhook_events');

-- Security/reputation tables
SELECT enable_rls_if_exists('domain_reputation');
SELECT enable_rls_if_exists('user_reputation');
SELECT enable_rls_if_exists('pin_reset_tokens');

-- Connect/setup tables
SELECT enable_rls_if_exists('connect_setup_steps');

-- Cleanup helper function
DROP FUNCTION IF EXISTS enable_rls_if_exists(TEXT);

-- =============================================================================
-- SUMMARY
-- =============================================================================

COMMENT ON SCHEMA public IS 'Tables that exist have RLS enabled with FORCE RLS for defense-in-depth. Backend (postgres) and service_role have full access for application operations.';
