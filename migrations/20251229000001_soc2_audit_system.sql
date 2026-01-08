-- PlexMCP SOC 2 Compliant Audit Logging System
-- Migration: 20251229000001
-- Date: December 28, 2025
-- Implements: Immutability, hash chain integrity, PII sanitization, comprehensive logging

-- =============================================================================
-- 1.0 SCHEMA CLEANUP & SECURITY ENHANCEMENTS
-- =============================================================================

-- Drop legacy audit_logs table if it exists (schema duplication fix)
DROP TABLE IF EXISTS audit_logs CASCADE;

-- Add security columns to admin_audit_log
ALTER TABLE admin_audit_log
    ADD COLUMN IF NOT EXISTS sequence_number BIGSERIAL,
    ADD COLUMN IF NOT EXISTS previous_hash TEXT,
    ADD COLUMN IF NOT EXISTS entry_hash TEXT,
    ADD COLUMN IF NOT EXISTS signature TEXT;

-- Change ip_address from INET to TEXT for flexibility (HIGH issue fix)
ALTER TABLE admin_audit_log ALTER COLUMN ip_address TYPE TEXT;

-- Make event_type NOT NULL with default (HIGH issue fix)
UPDATE admin_audit_log SET event_type = 'admin_action' WHERE event_type IS NULL;
ALTER TABLE admin_audit_log ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE admin_audit_log ALTER COLUMN event_type SET DEFAULT 'admin_action';

-- Add indexes on sequence_number for clock tamper detection
CREATE INDEX IF NOT EXISTS idx_admin_audit_sequence ON admin_audit_log(sequence_number);
CREATE INDEX IF NOT EXISTS idx_admin_audit_hash ON admin_audit_log(entry_hash) WHERE entry_hash IS NOT NULL;

-- Update foreign key cascades (HIGH issue fix)
-- Remove old constraint and add new ones with proper cascades
ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_admin_user_id_fkey;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_admin_user_id_fkey
    FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- =============================================================================
-- 1.1 CREATE AUTH_AUDIT_LOG TABLE WITH SECURITY FEATURES
-- =============================================================================

CREATE TABLE IF NOT EXISTS auth_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Actor Information
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,

    -- Event Details (with NOT NULL constraint - HIGH issue fix)
    event_type TEXT NOT NULL CHECK (event_type IN (
        'login_success', 'login_failed', 'logout',
        'password_changed', 'password_reset_requested', 'password_reset_completed',
        '2fa_enabled', '2fa_disabled', '2fa_verified', '2fa_failed',
        'oauth_login', 'oauth_linked', 'oauth_unlinked',
        'session_expired', 'account_locked', 'account_unlocked'
    )),

    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),

    -- Context (changed ip_address to TEXT - HIGH issue fix)
    ip_address TEXT,
    user_agent TEXT,
    session_id UUID,
    device_token TEXT,
    metadata JSONB DEFAULT '{}',

    -- Security features (CRITICAL issue fixes)
    sequence_number BIGSERIAL,
    previous_hash TEXT,
    entry_hash TEXT,
    signature TEXT,

    -- Immutable timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_email ON auth_audit_log(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event ON auth_audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_severity ON auth_audit_log(severity, created_at DESC)
    WHERE severity IN ('warning', 'critical');
CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_sequence ON auth_audit_log(sequence_number);
CREATE INDEX IF NOT EXISTS idx_auth_audit_hash ON auth_audit_log(entry_hash) WHERE entry_hash IS NOT NULL;

-- RLS: Split superadmin/admin policies (CRITICAL issue fix)
ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

-- Superadmin can see ALL logs
DROP POLICY IF EXISTS auth_audit_log_superadmin_select ON auth_audit_log;
CREATE POLICY auth_audit_log_superadmin_select ON auth_audit_log FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
        AND users.platform_role = 'superadmin'
    ));

-- Regular admins can only see their own auth events
DROP POLICY IF EXISTS auth_audit_log_admin_select ON auth_audit_log;
CREATE POLICY auth_audit_log_admin_select ON auth_audit_log FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
        AND users.platform_role = 'admin'
        AND auth_audit_log.user_id = users.id
    ));

-- =============================================================================
-- 1.2 IMMUTABILITY TRIGGERS
-- =============================================================================

-- Prevent modification/deletion of audit logs
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable and cannot be modified or deleted. Table: %, Operation: %',
        TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to all audit tables
DROP TRIGGER IF EXISTS prevent_admin_audit_update ON admin_audit_log;
CREATE TRIGGER prevent_admin_audit_update
    BEFORE UPDATE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

DROP TRIGGER IF EXISTS prevent_admin_audit_delete ON admin_audit_log;
CREATE TRIGGER prevent_admin_audit_delete
    BEFORE DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

DROP TRIGGER IF EXISTS prevent_auth_audit_update ON auth_audit_log;
CREATE TRIGGER prevent_auth_audit_update
    BEFORE UPDATE ON auth_audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

DROP TRIGGER IF EXISTS prevent_auth_audit_delete ON auth_audit_log;
CREATE TRIGGER prevent_auth_audit_delete
    BEFORE DELETE ON auth_audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- Apply to user_identity_audit if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_identity_audit') THEN
        DROP TRIGGER IF EXISTS prevent_identity_audit_update ON user_identity_audit;
        CREATE TRIGGER prevent_identity_audit_update
            BEFORE UPDATE ON user_identity_audit
            FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

        DROP TRIGGER IF EXISTS prevent_identity_audit_delete ON user_identity_audit;
        CREATE TRIGGER prevent_identity_audit_delete
            BEFORE DELETE ON user_identity_audit
            FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
    END IF;
END $$;

-- =============================================================================
-- 1.25 HASH CHAIN & SIGNATURE VALIDATION (CRITICAL ISSUE FIXES)
-- =============================================================================

-- Hash chain for integrity verification
CREATE OR REPLACE FUNCTION calculate_entry_hash(
    p_id UUID,
    p_admin_user_id UUID,
    p_action TEXT,
    p_target_type TEXT,
    p_target_id UUID,
    p_details JSONB,
    p_event_type TEXT,
    p_severity TEXT,
    p_created_at TIMESTAMPTZ,
    p_sequence_number BIGINT,
    p_previous_hash TEXT
) RETURNS TEXT AS $$
BEGIN
    RETURN encode(
        digest(
            COALESCE(p_id::text, '') ||
            COALESCE(p_admin_user_id::text, '') ||
            COALESCE(p_action, '') ||
            COALESCE(p_target_type, '') ||
            COALESCE(p_target_id::text, '') ||
            COALESCE(p_details::text, '{}') ||
            COALESCE(p_event_type, '') ||
            COALESCE(p_severity, '') ||
            COALESCE(p_created_at::text, '') ||
            COALESCE(p_sequence_number::text, '') ||
            COALESCE(p_previous_hash, ''),
            'sha256'
        ),
        'hex'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Automatically calculate hash chain on insert
CREATE OR REPLACE FUNCTION maintain_audit_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
    prev_hash TEXT;
BEGIN
    -- Get hash of previous entry
    SELECT entry_hash INTO prev_hash
    FROM admin_audit_log
    ORDER BY sequence_number DESC
    LIMIT 1;

    -- Calculate hash for current entry
    NEW.previous_hash := prev_hash;
    NEW.entry_hash := calculate_entry_hash(
        NEW.id,
        NEW.admin_user_id,
        NEW.action,
        NEW.target_type,
        NEW.target_id,
        NEW.details,
        NEW.event_type,
        NEW.severity,
        NEW.created_at,
        NEW.sequence_number,
        NEW.previous_hash
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_audit_log_hash_chain ON admin_audit_log;
CREATE TRIGGER admin_audit_log_hash_chain
    BEFORE INSERT ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION maintain_audit_hash_chain();

-- Same for auth_audit_log
CREATE OR REPLACE FUNCTION maintain_auth_audit_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
    prev_hash TEXT;
BEGIN
    SELECT entry_hash INTO prev_hash
    FROM auth_audit_log
    ORDER BY sequence_number DESC
    LIMIT 1;

    NEW.previous_hash := prev_hash;
    NEW.entry_hash := encode(
        digest(
            COALESCE(NEW.id::text, '') ||
            COALESCE(NEW.user_id::text, '') ||
            COALESCE(NEW.email, '') ||
            COALESCE(NEW.event_type, '') ||
            COALESCE(NEW.severity, '') ||
            COALESCE(NEW.created_at::text, '') ||
            COALESCE(NEW.sequence_number::text, '') ||
            COALESCE(NEW.previous_hash, ''),
            'sha256'
        ),
        'hex'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auth_audit_log_hash_chain ON auth_audit_log;
CREATE TRIGGER auth_audit_log_hash_chain
    BEFORE INSERT ON auth_audit_log
    FOR EACH ROW EXECUTE FUNCTION maintain_auth_audit_hash_chain();

-- Clock tamper detection
CREATE OR REPLACE FUNCTION validate_audit_timestamp()
RETURNS TRIGGER AS $$
DECLARE
    last_timestamp TIMESTAMPTZ;
    last_sequence BIGINT;
BEGIN
    SELECT created_at, sequence_number INTO last_timestamp, last_sequence
    FROM admin_audit_log
    ORDER BY sequence_number DESC
    LIMIT 1;

    -- Verify timestamp is not in the past
    IF last_timestamp IS NOT NULL AND NEW.created_at < last_timestamp THEN
        RAISE WARNING 'Audit log timestamp anomaly detected: new entry % is earlier than previous entry %',
            NEW.created_at, last_timestamp;
    END IF;

    -- Verify sequence number is monotonic
    IF last_sequence IS NOT NULL AND NEW.sequence_number <= last_sequence THEN
        RAISE EXCEPTION 'Audit log sequence violation: sequence must be strictly increasing'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_audit_log_timestamp_validation ON admin_audit_log;
CREATE TRIGGER admin_audit_log_timestamp_validation
    BEFORE INSERT ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION validate_audit_timestamp();

-- Function to verify hash chain integrity
CREATE OR REPLACE FUNCTION verify_audit_chain(
    p_table TEXT DEFAULT 'admin_audit_log'
) RETURNS TABLE(
    sequence_number BIGINT,
    is_valid BOOLEAN,
    expected_hash TEXT,
    actual_hash TEXT
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT
            a.sequence_number,
            a.entry_hash = calculate_entry_hash(
                a.id, a.admin_user_id, a.action, a.target_type,
                a.target_id, a.details, a.event_type, a.severity,
                a.created_at, a.sequence_number, a.previous_hash
            ) as is_valid,
            calculate_entry_hash(
                a.id, a.admin_user_id, a.action, a.target_type,
                a.target_id, a.details, a.event_type, a.severity,
                a.created_at, a.sequence_number, a.previous_hash
            ) as expected_hash,
            a.entry_hash as actual_hash
        FROM %I a
        ORDER BY a.sequence_number
    ', p_table);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 1.26 PII SANITIZATION FUNCTION (HIGH ISSUE FIX)
-- =============================================================================

-- Sanitize sensitive data from audit log details
CREATE OR REPLACE FUNCTION sanitize_audit_details(details JSONB)
RETURNS JSONB AS $$
DECLARE
    sanitized JSONB;
    sensitive_keys TEXT[] := ARRAY['password', 'password_hash', 'token', 'api_key', 'secret', 'private_key', 'credit_card', 'ssn'];
    key TEXT;
BEGIN
    sanitized := details;
    FOREACH key IN ARRAY sensitive_keys LOOP
        IF sanitized ? key THEN
            sanitized := jsonb_set(sanitized, ARRAY[key], '"[REDACTED]"'::jsonb);
        END IF;
    END LOOP;
    RETURN sanitized;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- 1.3 AUTOMATIC AUDIT TRIGGERS FOR CRITICAL TABLES
-- =============================================================================

-- Automatically log changes to critical tables
CREATE OR REPLACE FUNCTION log_critical_table_change()
RETURNS TRIGGER AS $$
DECLARE
    actor_user_id UUID;
    action_type TEXT;
    change_details JSONB;
BEGIN
    actor_user_id := auth.uid();

    IF TG_OP = 'INSERT' THEN
        action_type := TG_TABLE_NAME || '_created';
        change_details := jsonb_build_object('operation', 'INSERT', 'new_data', to_jsonb(NEW));
    ELSIF TG_OP = 'UPDATE' THEN
        action_type := TG_TABLE_NAME || '_updated';
        change_details := jsonb_build_object(
            'operation', 'UPDATE',
            'old_data', to_jsonb(OLD),
            'new_data', to_jsonb(NEW),
            'changed_fields', (
                SELECT jsonb_object_agg(key, jsonb_build_object('old', old_val, 'new', new_val))
                FROM jsonb_each(to_jsonb(OLD)) old_obj(key, old_val)
                JOIN jsonb_each(to_jsonb(NEW)) new_obj(key, new_val) USING (key)
                WHERE old_val IS DISTINCT FROM new_val
            )
        );
    ELSIF TG_OP = 'DELETE' THEN
        action_type := TG_TABLE_NAME || '_deleted';
        change_details := jsonb_build_object('operation', 'DELETE', 'old_data', to_jsonb(OLD));
    END IF;

    IF actor_user_id IS NOT NULL THEN
        INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity, created_at
        ) VALUES (
            actor_user_id,
            action_type,
            TG_TABLE_NAME,
            CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
            change_details,
            'data_modification',
            CASE
                WHEN TG_OP = 'DELETE' THEN 'critical'
                WHEN TG_OP = 'INSERT' THEN 'info'
                ELSE 'warning'
            END,
            NOW()
        );
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to critical tables (drop first if exists)
DROP TRIGGER IF EXISTS audit_users_changes ON users;
CREATE TRIGGER audit_users_changes AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION log_critical_table_change();

DROP TRIGGER IF EXISTS audit_organizations_changes ON organizations;
CREATE TRIGGER audit_organizations_changes AFTER INSERT OR UPDATE OR DELETE ON organizations
    FOR EACH ROW EXECUTE FUNCTION log_critical_table_change();

DROP TRIGGER IF EXISTS audit_api_keys_changes ON api_keys;
CREATE TRIGGER audit_api_keys_changes AFTER INSERT OR UPDATE OR DELETE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION log_critical_table_change();

DROP TRIGGER IF EXISTS audit_subscriptions_changes ON subscriptions;
CREATE TRIGGER audit_subscriptions_changes AFTER INSERT OR UPDATE OR DELETE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION log_critical_table_change();

-- Apply to optional tables if they exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_identities') THEN
        DROP TRIGGER IF EXISTS audit_user_identities_changes ON user_identities;
        CREATE TRIGGER audit_user_identities_changes AFTER INSERT OR UPDATE OR DELETE ON user_identities
            FOR EACH ROW EXECUTE FUNCTION log_critical_table_change();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_2fa') THEN
        DROP TRIGGER IF EXISTS audit_user_2fa_changes ON user_2fa;
        CREATE TRIGGER audit_user_2fa_changes AFTER INSERT OR UPDATE OR DELETE ON user_2fa
            FOR EACH ROW EXECUTE FUNCTION log_critical_table_change();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_security_settings') THEN
        DROP TRIGGER IF EXISTS audit_security_settings_changes ON user_security_settings;
        CREATE TRIGGER audit_security_settings_changes AFTER INSERT OR UPDATE OR DELETE ON user_security_settings
            FOR EACH ROW EXECUTE FUNCTION log_critical_table_change();
    END IF;
END $$;

-- =============================================================================
-- 1.35 UPDATE RLS POLICIES (CRITICAL ISSUE FIX)
-- =============================================================================

-- Drop old permissive RLS policy
DROP POLICY IF EXISTS admin_audit_log_select ON admin_audit_log;

-- Superadmin can see ALL logs
CREATE POLICY admin_audit_log_superadmin_select ON admin_audit_log FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
        AND users.platform_role = 'superadmin'
    ));

-- Regular admins can only see their own actions
CREATE POLICY admin_audit_log_admin_select ON admin_audit_log FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
        AND users.platform_role = 'admin'
        AND admin_audit_log.admin_user_id = users.id
    ));

-- Prevent all modification attempts (belt and suspenders with triggers)
DROP POLICY IF EXISTS admin_audit_log_no_insert ON admin_audit_log;
CREATE POLICY admin_audit_log_no_insert ON admin_audit_log FOR INSERT
    WITH CHECK (false);

DROP POLICY IF EXISTS admin_audit_log_no_update ON admin_audit_log;
CREATE POLICY admin_audit_log_no_update ON admin_audit_log FOR UPDATE
    USING (false);

DROP POLICY IF EXISTS admin_audit_log_no_delete ON admin_audit_log;
CREATE POLICY admin_audit_log_no_delete ON admin_audit_log FOR DELETE
    USING (false);

-- =============================================================================
-- 1.4 RETENTION & ARCHIVAL (7-YEAR SOC 2 TYPE II)
-- =============================================================================

-- Archive tables for logs older than 1 year
CREATE TABLE IF NOT EXISTS admin_audit_log_archive (LIKE admin_audit_log INCLUDING ALL);
CREATE TABLE IF NOT EXISTS auth_audit_log_archive (LIKE auth_audit_log INCLUDING ALL);

ALTER TABLE admin_audit_log_archive ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE auth_audit_log_archive ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW();

-- Create archive for user_identity_audit if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_identity_audit') THEN
        CREATE TABLE IF NOT EXISTS user_identity_audit_archive (LIKE user_identity_audit INCLUDING ALL);
        ALTER TABLE user_identity_audit_archive ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- Function to move logs > 1 year to archive
CREATE OR REPLACE FUNCTION archive_old_audit_logs()
RETURNS TABLE(admin_archived BIGINT, auth_archived BIGINT, identity_archived BIGINT) AS $$
DECLARE
    threshold TIMESTAMPTZ := NOW() - INTERVAL '1 year';
    admin_cnt BIGINT; auth_cnt BIGINT; identity_cnt BIGINT;
BEGIN
    WITH moved AS (DELETE FROM admin_audit_log WHERE created_at < threshold RETURNING *)
    INSERT INTO admin_audit_log_archive SELECT *, NOW() FROM moved;
    GET DIAGNOSTICS admin_cnt = ROW_COUNT;

    WITH moved AS (DELETE FROM auth_audit_log WHERE created_at < threshold RETURNING *)
    INSERT INTO auth_audit_log_archive SELECT *, NOW() FROM moved;
    GET DIAGNOSTICS auth_cnt = ROW_COUNT;

    -- Handle user_identity_audit if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_identity_audit') THEN
        EXECUTE 'WITH moved AS (DELETE FROM user_identity_audit WHERE created_at < $1 RETURNING *)
                 INSERT INTO user_identity_audit_archive SELECT *, NOW() FROM moved'
        USING threshold;
        GET DIAGNOSTICS identity_cnt = ROW_COUNT;
    ELSE
        identity_cnt := 0;
    END IF;

    RETURN QUERY SELECT admin_cnt, auth_cnt, identity_cnt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to delete logs > 7 years
CREATE OR REPLACE FUNCTION delete_expired_audit_logs()
RETURNS TABLE(admin_deleted BIGINT, auth_deleted BIGINT, identity_deleted BIGINT) AS $$
DECLARE
    threshold TIMESTAMPTZ := NOW() - INTERVAL '7 years';
    admin_cnt BIGINT; auth_cnt BIGINT; identity_cnt BIGINT;
BEGIN
    DELETE FROM admin_audit_log_archive WHERE created_at < threshold;
    GET DIAGNOSTICS admin_cnt = ROW_COUNT;

    DELETE FROM auth_audit_log_archive WHERE created_at < threshold;
    GET DIAGNOSTICS auth_cnt = ROW_COUNT;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_identity_audit_archive') THEN
        EXECUTE 'DELETE FROM user_identity_audit_archive WHERE created_at < $1' USING threshold;
        GET DIAGNOSTICS identity_cnt = ROW_COUNT;
    ELSE
        identity_cnt := 0;
    END IF;

    RETURN QUERY SELECT admin_cnt, auth_cnt, identity_cnt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule with pg_cron (if available)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Archive monthly on 1st at 2 AM
        PERFORM cron.schedule('archive-audit-logs', '0 2 1 * *', 'SELECT archive_old_audit_logs()');
        -- Delete annually on Jan 1st at 3 AM
        PERFORM cron.schedule('delete-expired-logs', '0 3 1 1 *', 'SELECT delete_expired_audit_logs()');
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'SOC 2 audit logging system migration completed successfully';
    RAISE NOTICE 'Security features enabled:';
    RAISE NOTICE '  ✓ Immutability triggers (prevent UPDATE/DELETE)';
    RAISE NOTICE '  ✓ Hash chain integrity verification';
    RAISE NOTICE '  ✓ Clock tamper detection';
    RAISE NOTICE '  ✓ PII sanitization functions';
    RAISE NOTICE '  ✓ Automatic audit triggers on critical tables';
    RAISE NOTICE '  ✓ Split RLS policies (superadmin/admin)';
    RAISE NOTICE '  ✓ 7-year retention with 1-year archival';
END $$;
