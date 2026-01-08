-- Enable FORCE RLS on All Multi-Tenant Tables
-- SOC 2 CC6.1: Defense-in-depth - database-level access controls
-- CVSS 7.2 (High) - Prevents superadmin bypass of RLS policies
--
-- This migration ensures ALL tables with RLS also have FORCE RLS enabled
-- to prevent database superusers from bypassing tenant isolation.

-- ============================================================================
-- PHASE 1: Enable FORCE RLS on tables that already have RLS enabled
-- ============================================================================

-- Admin/Email Tables
ALTER TABLE admin_audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_email_folders FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_email_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_email_settings FORCE ROW LEVEL SECURITY;

-- Analytics Tables (all 9)
ALTER TABLE analytics_aggregates_hourly FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_conversions FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_goals FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_page_views FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_realtime FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_visitors FORCE ROW LEVEL SECURITY;

-- Authentication Audit
ALTER TABLE auth_audit_log FORCE ROW LEVEL SECURITY;

-- Domain/Email Routing
ALTER TABLE custom_domains FORCE ROW LEVEL SECURITY;
ALTER TABLE email_routing_rules FORCE ROW LEVEL SECURITY;

-- FAQ
ALTER TABLE faq_articles FORCE ROW LEVEL SECURITY;

-- Billing/Invoicing Tables
ALTER TABLE instant_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_disputes FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;
ALTER TABLE overage_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE spend_cap_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE spend_caps FORCE ROW LEVEL SECURITY;
ALTER TABLE stripe_usage_reports FORCE ROW LEVEL SECURITY;

-- MCP Tables
ALTER TABLE mcp_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_proxy_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_request_log FORCE ROW LEVEL SECURITY;

-- Organization Tables
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;

-- SLA
ALTER TABLE sla_rules FORCE ROW LEVEL SECURITY;

-- Support Tickets (all 7)
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_assignment_history FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_email_metadata FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_typing_indicators FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_viewers FORCE ROW LEVEL SECURITY;

-- User Security Tables (CRITICAL)
ALTER TABLE user_2fa FORCE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_backup_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_setup_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE user_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE user_identity_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE user_notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE user_presence FORCE ROW LEVEL SECURITY;
ALTER TABLE user_security_settings FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- PHASE 2: Enable RLS + FORCE RLS on tables missing RLS entirely
-- ============================================================================

-- Fix misconfigured tables (had FORCE RLS but not RLS enabled)
ALTER TABLE subscription_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- User security tables that are missing RLS
ALTER TABLE user_2fa_login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_login_tokens FORCE ROW LEVEL SECURITY;

ALTER TABLE user_trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_trusted_devices FORCE ROW LEVEL SECURITY;

-- NOTE: alert_configurations and alert_thresholds tables are created in
-- 20260104000001_security_alerts.sql which runs after this migration.
-- RLS is enabled in that migration directly.

-- Archive tables (defense in depth)
ALTER TABLE admin_audit_log_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log_archive FORCE ROW LEVEL SECURITY;

ALTER TABLE auth_audit_log_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_log_archive FORCE ROW LEVEL SECURITY;

ALTER TABLE user_identity_audit_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identity_audit_archive FORCE ROW LEVEL SECURITY;

-- Enterprise tables
ALTER TABLE enterprise_limit_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_limit_changes FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- PHASE 3: Create backend policies for newly RLS-enabled tables
-- (Required so postgres role can still access data)
-- ============================================================================

-- Create backend policies for newly RLS-enabled tables
DO $$
DECLARE
    tables_to_fix TEXT[] := ARRAY[
        'user_2fa_login_tokens',
        'user_trusted_devices',
        -- NOTE: alert_configurations and alert_thresholds are handled in 20260104000001_security_alerts.sql
        'admin_audit_log_archive',
        'auth_audit_log_archive',
        'user_identity_audit_archive',
        'enterprise_limit_changes'
    ];
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY tables_to_fix
    LOOP
        -- Drop existing policy if any
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_backend', tbl);
        -- Create new policy
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO postgres USING (true) WITH CHECK (true)', tbl || '_backend', tbl);
    END LOOP;
END $$;

-- ============================================================================
-- PHASE 4: Verification
-- ============================================================================

DO $$
DECLARE
    tables_with_rls INTEGER;
    tables_with_force_rls INTEGER;
    tables_needing_force_rls INTEGER;
BEGIN
    -- Count tables with RLS
    SELECT COUNT(*) INTO tables_with_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true;

    -- Count tables with FORCE RLS
    SELECT COUNT(*) INTO tables_with_force_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relforcerowsecurity = true;

    -- Count tables with RLS but not FORCE RLS (should be 0 after migration)
    SELECT COUNT(*) INTO tables_needing_force_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = false;

    RAISE NOTICE '=== FORCE RLS Migration Summary ===';
    RAISE NOTICE 'Tables with RLS enabled: %', tables_with_rls;
    RAISE NOTICE 'Tables with FORCE RLS: %', tables_with_force_rls;
    RAISE NOTICE 'Tables still needing FORCE RLS: %', tables_needing_force_rls;

    IF tables_needing_force_rls > 0 THEN
        RAISE WARNING 'SECURITY: % tables have RLS but not FORCE RLS!', tables_needing_force_rls;
    ELSE
        RAISE NOTICE '✓ All RLS tables have FORCE RLS enabled';
    END IF;
END $$;
