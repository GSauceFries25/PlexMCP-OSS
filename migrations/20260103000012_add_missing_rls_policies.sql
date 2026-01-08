-- Add Missing RLS Backend Policies
-- SOC 2 CC6.1: Defense-in-depth - database-level access controls
--
-- These tables have FORCE RLS enabled but no policies defined,
-- which means ALL access is denied. This migration adds backend
-- policies to allow the postgres role to access data.

-- ============================================================================
-- Core Tables - Backend policies for postgres role
-- ============================================================================

-- Users table
CREATE POLICY users_backend ON users
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- Organizations table
CREATE POLICY organizations_backend ON organizations
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- Sessions table
CREATE POLICY sessions_backend ON sessions
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- API Keys table
CREATE POLICY api_keys_backend ON api_keys
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- Subscriptions table
CREATE POLICY subscriptions_backend ON subscriptions
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Billing/Usage Tables
-- ============================================================================

-- Invoices table
CREATE POLICY invoices_backend ON invoices
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- Usage Records table
CREATE POLICY usage_records_backend ON usage_records
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- Usage Aggregates table
CREATE POLICY usage_aggregates_backend ON usage_aggregates
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- Subscription Addons table
CREATE POLICY subscription_addons_backend ON subscription_addons
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- Webhook Events table
CREATE POLICY webhook_events_backend ON webhook_events
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Organization/Membership Tables
-- ============================================================================

-- Organization Members table
CREATE POLICY organization_members_backend ON organization_members
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- Invitations table
CREATE POLICY invitations_backend ON invitations
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- MCP Tables
-- ============================================================================

-- MCP Instances table
CREATE POLICY mcp_instances_backend ON mcp_instances
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- User Security Tables
-- ============================================================================

-- User 2FA table
CREATE POLICY user_2fa_backend ON user_2fa
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- User 2FA Backup Codes table
CREATE POLICY user_2fa_backup_codes_backend ON user_2fa_backup_codes
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- User 2FA Setup Tokens table
CREATE POLICY user_2fa_setup_tokens_backend ON user_2fa_setup_tokens
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- User PINs table
CREATE POLICY user_pins_backend ON user_pins
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- PIN Reset Tokens table
CREATE POLICY pin_reset_tokens_backend ON pin_reset_tokens
    FOR ALL TO postgres
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    tables_without_policies INTEGER;
BEGIN
    -- Count tables with FORCE RLS but no policies
    SELECT COUNT(*) INTO tables_without_policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
      AND NOT EXISTS (
          SELECT 1
          FROM pg_policy p
          WHERE p.polrelid = c.oid
      );

    RAISE NOTICE '=== RLS Policy Migration Summary ===';
    RAISE NOTICE 'Tables still without policies: %', tables_without_policies;

    IF tables_without_policies > 0 THEN
        RAISE WARNING 'Some tables still have FORCE RLS but no policies!';
    ELSE
        RAISE NOTICE '✓ All FORCE RLS tables have policies defined';
    END IF;
END $$;
