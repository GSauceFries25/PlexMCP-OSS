-- Session tracking for JWT invalidation
-- Allows revoking individual JWT tokens before expiration
-- Critical for security: password changes, compromised tokens, logout

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- User who owns this session
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- JWT ID (jti claim) for unique token identification
    jti TEXT NOT NULL UNIQUE,

    -- Session metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Session context
    ip_address TEXT,
    user_agent TEXT,

    -- Revocation
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,

    -- Track if this is a refresh token session or access token session
    token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),

    -- Link refresh tokens to their access tokens
    parent_session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,

    CONSTRAINT valid_revocation CHECK (
        (revoked_at IS NULL AND revocation_reason IS NULL) OR
        (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
    )
);

-- Index for fast session validation during authentication
CREATE INDEX idx_user_sessions_jti ON user_sessions(jti) WHERE revoked_at IS NULL;

-- Index for listing user's active sessions (query should filter by expires_at > NOW() at runtime)
CREATE INDEX idx_user_sessions_user_active ON user_sessions(user_id, expires_at)
    WHERE revoked_at IS NULL;

-- Index for cleanup of expired sessions (query should filter by expires_at at runtime)
CREATE INDEX idx_user_sessions_expired ON user_sessions(expires_at);

-- Row-Level Security
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;

-- Users can only see their own sessions
CREATE POLICY user_sessions_user_select ON user_sessions
    FOR SELECT
    USING (user_id = auth.uid());

-- Only the session owner can revoke their sessions
CREATE POLICY user_sessions_user_update ON user_sessions
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Superadmins can see all sessions (for security auditing)
CREATE POLICY user_sessions_superadmin_select ON user_sessions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid() AND platform_role = 'superadmin'
        )
    );

-- Superadmins can revoke any session (for security response)
CREATE POLICY user_sessions_superadmin_update ON user_sessions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid() AND platform_role = 'superadmin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid() AND platform_role = 'superadmin'
        )
    );

-- Function to automatically cleanup expired sessions (run daily)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete sessions expired more than 30 days ago
    DELETE FROM user_sessions
    WHERE expires_at < NOW() - INTERVAL '30 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (called by cron job)
GRANT EXECUTE ON FUNCTION cleanup_expired_sessions() TO authenticated;

COMMENT ON TABLE user_sessions IS 'Tracks active JWT sessions for revocation support. Allows invalidating tokens before expiration for logout, password changes, or security incidents.';
COMMENT ON COLUMN user_sessions.jti IS 'JWT ID (jti claim) - unique identifier for each JWT token';
COMMENT ON COLUMN user_sessions.revoked_at IS 'When this session was revoked. NULL means active.';
COMMENT ON COLUMN user_sessions.token_type IS 'Type of token: access (short-lived) or refresh (long-lived)';
COMMENT ON COLUMN user_sessions.parent_session_id IS 'For access tokens, points to the refresh token session that created it';
