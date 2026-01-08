-- Apply FORCE ROW LEVEL SECURITY to remaining 9 tables
-- Date: January 3, 2026
-- Purpose: Complete RLS enforcement across all tables (SOC 2 compliance requirement)
--
-- Background:
-- 68 tables already have FORCE RLS enabled.
-- This migration completes coverage for the remaining 9 tables.
--
-- FORCE RLS ensures that even superadmin/admin users cannot bypass RLS policies,
-- preventing cross-organization data access and ensuring compliance with SOC 2 CC6.1.
--
-- Note: Some tables intentionally had RLS disabled with application-layer authorization.
-- For SOC 2 compliance and defense-in-depth, we're enabling RLS as an additional layer.

-- =============================================================================
-- Step 1: Enable and Force RLS on all 9 tables
-- =============================================================================

-- Archive Tables
DO $$
BEGIN
    -- Admin audit log archive
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_audit_log_archive') THEN
        ALTER TABLE admin_audit_log_archive ENABLE ROW LEVEL SECURITY;
        ALTER TABLE admin_audit_log_archive FORCE ROW LEVEL SECURITY;
    END IF;

    -- Auth audit log archive
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auth_audit_log_archive') THEN
        ALTER TABLE auth_audit_log_archive ENABLE ROW LEVEL SECURITY;
        ALTER TABLE auth_audit_log_archive FORCE ROW LEVEL SECURITY;
    END IF;

    -- User identity audit archive
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_identity_audit_archive') THEN
        ALTER TABLE user_identity_audit_archive ENABLE ROW LEVEL SECURITY;
        ALTER TABLE user_identity_audit_archive FORCE ROW LEVEL SECURITY;
    END IF;

    -- Alert configuration tables
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_configurations') THEN
        ALTER TABLE alert_configurations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE alert_configurations FORCE ROW LEVEL SECURITY;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_thresholds') THEN
        ALTER TABLE alert_thresholds ENABLE ROW LEVEL SECURITY;
        ALTER TABLE alert_thresholds FORCE ROW LEVEL SECURITY;
    END IF;

    -- Enterprise features
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'enterprise_limit_changes') THEN
        ALTER TABLE enterprise_limit_changes ENABLE ROW LEVEL SECURITY;
        ALTER TABLE enterprise_limit_changes FORCE ROW LEVEL SECURITY;
    END IF;

    -- Subdomain words (global lookup table)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subdomain_words') THEN
        ALTER TABLE subdomain_words ENABLE ROW LEVEL SECURITY;
        ALTER TABLE subdomain_words FORCE ROW LEVEL SECURITY;
    END IF;

    -- User preferences
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notification_preferences') THEN
        ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;
        ALTER TABLE user_notification_preferences FORCE ROW LEVEL SECURITY;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_trusted_devices') THEN
        ALTER TABLE user_trusted_devices ENABLE ROW LEVEL SECURITY;
        ALTER TABLE user_trusted_devices FORCE ROW LEVEL SECURITY;
    END IF;
END $$;

-- =============================================================================
-- Step 2: Create RLS Policies
-- =============================================================================

-- Admin audit log archive policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_audit_log_archive') THEN
        -- Superadmins can view all archived admin logs
        CREATE POLICY admin_audit_log_archive_superadmin_select ON admin_audit_log_archive
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND platform_role = 'superadmin'
                )
            );

        -- Admins can view their own archived admin actions
        CREATE POLICY admin_audit_log_archive_admin_select ON admin_audit_log_archive
            FOR SELECT
            USING (
                admin_user_id = auth.uid()
                AND EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND is_admin = true
                )
            );
    END IF;
END $$;

-- Auth audit log archive policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auth_audit_log_archive') THEN
        -- Superadmins can view all archived auth logs
        CREATE POLICY auth_audit_log_archive_superadmin_select ON auth_audit_log_archive
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND platform_role = 'superadmin'
                )
            );

        -- Users can view their own archived auth logs
        CREATE POLICY auth_audit_log_archive_user_select ON auth_audit_log_archive
            FOR SELECT
            USING (user_id = auth.uid());
    END IF;
END $$;

-- User identity audit archive policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_identity_audit_archive') THEN
        -- Superadmins can view all archived identity audits
        CREATE POLICY user_identity_audit_archive_superadmin_select ON user_identity_audit_archive
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND platform_role = 'superadmin'
                )
            );

        -- Users can view their own archived identity audit
        CREATE POLICY user_identity_audit_archive_user_select ON user_identity_audit_archive
            FOR SELECT
            USING (user_id = auth.uid());
    END IF;
END $$;

-- Alert configuration policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_configurations') THEN
        -- Users can manage their org's alert configurations
        CREATE POLICY alert_configurations_org_access ON alert_configurations
            FOR ALL
            USING (
                org_id IN (
                    SELECT org_id FROM users WHERE id = auth.uid()
                )
            );
    END IF;
END $$;

-- Alert threshold policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_thresholds') THEN
        -- Users can manage their org's alert thresholds
        CREATE POLICY alert_thresholds_org_access ON alert_thresholds
            FOR ALL
            USING (
                org_id IN (
                    SELECT org_id FROM users WHERE id = auth.uid()
                )
            );
    END IF;
END $$;

-- Enterprise limit changes policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'enterprise_limit_changes') THEN
        -- Superadmins can view all limit changes
        CREATE POLICY enterprise_limit_changes_superadmin_select ON enterprise_limit_changes
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND platform_role = 'superadmin'
                )
            );

        -- Org owners can view their org's limit changes
        CREATE POLICY enterprise_limit_changes_org_select ON enterprise_limit_changes
            FOR SELECT
            USING (
                org_id IN (
                    SELECT om.org_id FROM organization_members om
                    WHERE om.user_id = auth.uid() AND om.role = 'owner'
                )
            );
    END IF;
END $$;

-- Subdomain words policies (global lookup table - read-only for all)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subdomain_words') THEN
        -- All authenticated users can read subdomain words
        CREATE POLICY subdomain_words_public_select ON subdomain_words
            FOR SELECT
            USING (true);  -- Global read-only table

        -- Only superadmins can modify
        CREATE POLICY subdomain_words_superadmin_modify ON subdomain_words
            FOR ALL
            USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND platform_role = 'superadmin'
                )
            );
    END IF;
END $$;

-- User notification preferences policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notification_preferences') THEN
        -- Users can only access their own notification preferences
        CREATE POLICY user_notification_preferences_owner_access ON user_notification_preferences
            FOR ALL
            USING (user_id = auth.uid());

        -- Superadmins can view all preferences
        CREATE POLICY user_notification_preferences_superadmin_select ON user_notification_preferences
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND platform_role = 'superadmin'
                )
            );
    END IF;
END $$;

-- User trusted devices policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_trusted_devices') THEN
        -- Users can only access their own trusted devices
        CREATE POLICY user_trusted_devices_owner_access ON user_trusted_devices
            FOR ALL
            USING (user_id = auth.uid());

        -- Superadmins can view all devices (for security auditing)
        CREATE POLICY user_trusted_devices_superadmin_select ON user_trusted_devices
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND platform_role = 'superadmin'
                )
            );
    END IF;
END $$;

-- =============================================================================
-- Step 3: Verification
-- =============================================================================

-- Verify all tables now have FORCE RLS enabled
DO $$
DECLARE
    table_count INTEGER;
    tables_with_force_rls TEXT[];
BEGIN
    SELECT COUNT(*), array_agg(c.relname ORDER BY c.relname) INTO table_count, tables_with_force_rls
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    WHERE t.schemaname = 'public'
    AND c.relrowsecurity = true
    AND c.relforcerowsecurity = true;

    RAISE NOTICE 'Tables with FORCE RLS enabled: %', table_count;

    -- Expected: 77 tables (68 existing + 9 new)
    IF table_count >= 77 THEN
        RAISE NOTICE 'SUCCESS: All tables have FORCE RLS enabled (% tables)', table_count;
    ELSE
        RAISE WARNING 'Expected 77+ tables with FORCE RLS, found only %', table_count;
        RAISE NOTICE 'Tables with FORCE RLS: %', tables_with_force_rls;
    END IF;
END $$;

-- =============================================================================
-- Documentation (conditional - only comment on tables that exist)
-- =============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_audit_log_archive') THEN
        COMMENT ON TABLE admin_audit_log_archive IS 'Archive of admin audit logs. FORCE RLS ensures admins cannot access other org historical data.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auth_audit_log_archive') THEN
        COMMENT ON TABLE auth_audit_log_archive IS 'Archive of authentication events. FORCE RLS protects historical auth data across orgs.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_identity_audit_archive') THEN
        COMMENT ON TABLE user_identity_audit_archive IS 'Archive of identity changes. FORCE RLS prevents cross-org historical identity access.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_configurations') THEN
        COMMENT ON TABLE alert_configurations IS 'Alert configuration settings. FORCE RLS ensures org-specific alert configs.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_thresholds') THEN
        COMMENT ON TABLE alert_thresholds IS 'Alert threshold definitions. FORCE RLS protects org alert settings.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'enterprise_limit_changes') THEN
        COMMENT ON TABLE enterprise_limit_changes IS 'Enterprise limit modification audit trail. FORCE RLS protects enterprise customer data.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subdomain_words') THEN
        COMMENT ON TABLE subdomain_words IS 'Reserved subdomain words (global). FORCE RLS applied with public read policy for consistency.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notification_preferences') THEN
        COMMENT ON TABLE user_notification_preferences IS 'User notification preferences. FORCE RLS protects user privacy settings.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_trusted_devices') THEN
        COMMENT ON TABLE user_trusted_devices IS 'Trusted device fingerprints for 2FA bypass. FORCE RLS protects sensitive device data.';
    END IF;
END $$;

-- =============================================================================
-- Rollback Instructions
-- =============================================================================

-- To rollback (only if absolutely necessary):
-- Note: This will remove security protections. Only rollback if RLS policies
-- are causing critical production issues that cannot be fixed by updating policies.

-- ALTER TABLE admin_audit_log_archive NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE auth_audit_log_archive NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_identity_audit_archive NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE alert_configurations NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE alert_thresholds NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE enterprise_limit_changes NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE subdomain_words NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_notification_preferences NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_trusted_devices NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;

-- DROP POLICY IF EXISTS ... (list all policies created above)

-- WARNING: Rollback should only be performed if RLS policies are causing
-- critical production issues. Removing FORCE RLS creates security vulnerabilities.
