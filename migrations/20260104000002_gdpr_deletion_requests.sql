-- GDPR Deletion Requests Table
-- Tracks user requests for account deletion under GDPR Article 17 (Right to Erasure)
-- Implements a 30-day grace period before permanent deletion

CREATE TABLE IF NOT EXISTS gdpr_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    reason TEXT,
    -- Track who processed the deletion (for audit)
    processed_by TEXT,
    -- Metadata
    CONSTRAINT valid_state CHECK (
        (completed_at IS NULL AND cancelled_at IS NULL) OR
        (completed_at IS NOT NULL AND cancelled_at IS NULL) OR
        (completed_at IS NULL AND cancelled_at IS NOT NULL)
    )
);

-- Index for finding pending deletions that are due
CREATE INDEX idx_gdpr_deletion_pending ON gdpr_deletion_requests(scheduled_for)
    WHERE completed_at IS NULL AND cancelled_at IS NULL;

-- Index for user lookup
CREATE INDEX idx_gdpr_deletion_user ON gdpr_deletion_requests(user_id);

-- Enable RLS
ALTER TABLE gdpr_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdpr_deletion_requests FORCE ROW LEVEL SECURITY;

-- Users can only see their own deletion requests
CREATE POLICY gdpr_deletion_user_select ON gdpr_deletion_requests
    FOR SELECT
    USING (user_id = auth.uid());

-- Users can insert their own deletion requests
CREATE POLICY gdpr_deletion_user_insert ON gdpr_deletion_requests
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Users can cancel their own deletion requests (update cancelled_at)
CREATE POLICY gdpr_deletion_user_update ON gdpr_deletion_requests
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Service role can do anything (for background job processing)
CREATE POLICY gdpr_deletion_service ON gdpr_deletion_requests
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Create a function to process scheduled deletions (to be called by pg_cron)
CREATE OR REPLACE FUNCTION process_gdpr_deletions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER := 0;
    deletion_record RECORD;
BEGIN
    -- Find all pending deletions that are due
    FOR deletion_record IN
        SELECT id, user_id
        FROM gdpr_deletion_requests
        WHERE scheduled_for <= NOW()
        AND completed_at IS NULL
        AND cancelled_at IS NULL
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            -- Anonymize audit logs (keep for compliance but remove PII)
            UPDATE auth_audit_log
            SET email = 'deleted-user@anonymized.local',
                ip_address = NULL,
                user_agent = NULL
            WHERE user_id = deletion_record.user_id;

            -- Delete user's 2FA settings
            DELETE FROM user_2fa WHERE user_id = deletion_record.user_id;

            -- Delete trusted devices
            DELETE FROM trusted_devices WHERE user_id = deletion_record.user_id;

            -- Delete user's support tickets (messages will cascade)
            DELETE FROM support_tickets WHERE user_id = deletion_record.user_id;

            -- Remove user from organizations
            DELETE FROM organization_members WHERE user_id = deletion_record.user_id;

            -- Delete the user record (cascades to related data)
            DELETE FROM users WHERE id = deletion_record.user_id;

            -- Mark the deletion request as completed
            UPDATE gdpr_deletion_requests
            SET completed_at = NOW(),
                processed_by = 'pg_cron_job'
            WHERE id = deletion_record.id;

            deleted_count := deleted_count + 1;

            RAISE NOTICE 'GDPR deletion completed for user %', deletion_record.user_id;

        EXCEPTION WHEN OTHERS THEN
            -- Log the error but continue with other deletions
            RAISE WARNING 'GDPR deletion failed for user %: %', deletion_record.user_id, SQLERRM;
        END;
    END LOOP;

    RETURN deleted_count;
END;
$$;

-- Schedule the GDPR deletion job to run daily at 3am UTC
-- Note: This requires pg_cron extension to be enabled
DO $$
BEGIN
    -- Check if pg_cron extension exists
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Schedule the job
        PERFORM cron.schedule(
            'gdpr-deletions',
            '0 3 * * *',
            'SELECT process_gdpr_deletions();'
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- pg_cron might not be available, that's okay
    RAISE NOTICE 'pg_cron not available, GDPR deletion job not scheduled: %', SQLERRM;
END;
$$;

COMMENT ON TABLE gdpr_deletion_requests IS 'Tracks GDPR Article 17 deletion requests with 30-day grace period';
COMMENT ON FUNCTION process_gdpr_deletions() IS 'Processes scheduled GDPR deletions, called daily by pg_cron';
