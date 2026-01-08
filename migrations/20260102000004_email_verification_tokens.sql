-- Email Verification & Password Reset Tokens
-- Created: 2026-01-02
-- Purpose: Store secure tokens for email verification and password reset flows

-- Create verification tokens table
CREATE TABLE IF NOT EXISTS verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL, -- SHA-256 hash of the actual token
    token_type TEXT NOT NULL CHECK (token_type IN ('email_verification', 'password_reset')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT,

    -- Indexes
    CONSTRAINT verification_tokens_unique_hash UNIQUE (token_hash)
);

-- Index for fast lookups by token hash
CREATE INDEX IF NOT EXISTS idx_verification_tokens_hash ON verification_tokens(token_hash) WHERE used_at IS NULL;

-- Index for cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_verification_tokens_expires ON verification_tokens(expires_at) WHERE used_at IS NULL;

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_verification_tokens_user ON verification_tokens(user_id);

-- Enable RLS
ALTER TABLE verification_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own tokens (not really needed since this is backend-only, but good practice)
CREATE POLICY verification_tokens_user_select ON verification_tokens
    FOR SELECT
    USING (user_id = auth.uid());

-- RLS Policy: Only service role can insert/update/delete tokens
CREATE POLICY verification_tokens_service ON verification_tokens
    FOR ALL
    USING (auth.role() = 'service_role');

-- FORCE RLS to ensure admin users cannot bypass policies
ALTER TABLE verification_tokens FORCE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE verification_tokens IS 'Stores hashed tokens for email verification and password reset flows. Tokens expire after 24 hours and can only be used once.';
COMMENT ON COLUMN verification_tokens.token_hash IS 'SHA-256 hash of the actual token (raw token never stored in database)';
COMMENT ON COLUMN verification_tokens.token_type IS 'Type of verification: email_verification or password_reset';
COMMENT ON COLUMN verification_tokens.used_at IS 'Timestamp when token was used (NULL if unused)';
