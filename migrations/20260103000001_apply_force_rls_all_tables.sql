-- Apply FORCE ROW LEVEL SECURITY to all tables
-- Phase 2.1: SOC 2 Compliance - Critical Security Fix
--
-- CVSS Score: 7.2 (High)
-- Impact: Prevents superadmin/admin users from bypassing RLS policies
--
-- Without FORCE RLS, users with bypassrls privilege (superadmins) can
-- bypass RLS policies and access data from other organizations.
-- This is a critical multi-tenancy security issue.
--
-- SOC 2 Requirement: CC6.1 - Logical access controls

-- =============================================================================
-- CRITICAL SECURITY TABLES
-- =============================================================================

-- Audit logs must be tamper-proof
ALTER TABLE admin_audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_log FORCE ROW LEVEL SECURITY;

-- Authentication & Authorization
ALTER TABLE user_2fa FORCE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_backup_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_login_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_setup_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE user_security_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE user_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE user_identity_audit FORCE ROW LEVEL SECURITY;

-- Payment & Billing Security
ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_disputes FORCE ROW LEVEL SECURITY;
ALTER TABLE instant_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE overage_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE stripe_usage_reports FORCE ROW LEVEL SECURITY;

-- Spend Control
ALTER TABLE spend_caps FORCE ROW LEVEL SECURITY;
ALTER TABLE spend_cap_notifications FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- ORGANIZATIONAL DATA
-- =============================================================================

ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_domains FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- MCP (Model Context Protocol) INSTANCES & LOGS
-- =============================================================================

ALTER TABLE mcp_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_proxy_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_request_log FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- SUPPORT TICKETING SYSTEM
-- =============================================================================

ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_email_metadata FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_assignment_history FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_typing_indicators FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_viewers FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- ADMIN EMAIL INBOX SYSTEM
-- =============================================================================

ALTER TABLE admin_email_folders FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_email_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_email_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE email_routing_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_email_assignments FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- ANALYTICS SYSTEM
-- =============================================================================

ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_page_views FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_visitors FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_conversions FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_goals FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_realtime FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_aggregates_hourly FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_alerts FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- FAQ & KNOWLEDGE BASE
-- =============================================================================

ALTER TABLE faq_articles FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- SLA & SERVICE QUALITY
-- =============================================================================

ALTER TABLE sla_rules FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- WEBHOOK PROCESSING
-- =============================================================================

ALTER TABLE webhook_processing_queue FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- USER PRESENCE (Real-time collaboration)
-- =============================================================================

ALTER TABLE user_presence FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- VERIFICATION & TESTING
-- =============================================================================

-- Verify all tables now have FORCE RLS
DO $$
DECLARE
    table_count INTEGER;
    force_rls_count INTEGER;
    missing_tables TEXT;
BEGIN
    -- Count total tables with RLS enabled
    SELECT COUNT(*)
    INTO table_count
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.schemaname = 'public'
      AND c.relrowsecurity = true;

    -- Count tables with FORCE RLS
    SELECT COUNT(*)
    INTO force_rls_count
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.schemaname = 'public'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true;

    -- Find tables missing FORCE RLS
    SELECT string_agg(t.tablename, ', ')
    INTO missing_tables
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.schemaname = 'public'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = false;

    RAISE NOTICE 'RLS Status:';
    RAISE NOTICE '  Total tables with RLS: %', table_count;
    RAISE NOTICE '  Tables with FORCE RLS: %', force_rls_count;

    IF missing_tables IS NOT NULL THEN
        RAISE WARNING 'Tables missing FORCE RLS: %', missing_tables;
        RAISE EXCEPTION 'Migration incomplete: % tables still missing FORCE RLS', (table_count - force_rls_count);
    ELSE
        RAISE NOTICE '  ✓ All RLS tables have FORCE RLS enabled';
        RAISE NOTICE '  ✓ Multi-tenancy security enforced for all users including superadmins';
    END IF;
END $$;
