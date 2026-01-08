-- Two-Factor Authentication (2FA) Schema for PlexMCP
-- Migration: 20251208000001_user_2fa.sql
-- Date: December 8, 2025

-- User 2FA settings table
-- Stores encrypted TOTP secrets and 2FA status per user
CREATE TABLE IF NOT EXISTS user_2fa (
    user_id UUID PRIMARY KEY,
    -- TOTP secret encrypted with application-level AES-256-GCM key
    totp_secret_encrypted TEXT NOT NULL,
    totp_secret_nonce TEXT NOT NULL,
    -- Status tracking
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_at TIMESTAMPTZ,
    -- Rate limiting (same pattern as PIN: 5 attempts, 15-min lockout)
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backup/recovery codes table
-- Codes are hashed with Argon2 (same as passwords), one-time use
CREATE TABLE IF NOT EXISTS user_2fa_backup_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    -- Code stored as Argon2 hash (not reversible)
    code_hash TEXT NOT NULL,
    -- One-time use tracking
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Foreign key with cascade delete
    CONSTRAINT fk_2fa_backup_codes_user
        FOREIGN KEY (user_id)
        REFERENCES user_2fa(user_id)
        ON DELETE CASCADE
);

-- Index for efficient lookup of unused backup codes
CREATE INDEX IF NOT EXISTS idx_2fa_backup_codes_user
    ON user_2fa_backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_2fa_backup_codes_unused
    ON user_2fa_backup_codes(user_id)
    WHERE used_at IS NULL;

-- 2FA setup tokens table
-- Temporary storage during QR code setup flow (expires in 10 minutes)
CREATE TABLE IF NOT EXISTS user_2fa_setup_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    -- Temporary encrypted secret during setup (before user verifies)
    temp_secret_encrypted TEXT NOT NULL,
    temp_secret_nonce TEXT NOT NULL,
    -- Token expires in 10 minutes
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2FA login tokens table
-- Temporary tokens issued after password verification, before 2FA code entry
-- Used when user has 2FA enabled - password correct but need TOTP verification
CREATE TABLE IF NOT EXISTS user_2fa_login_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    -- Token hash (we only store hash, not the actual token)
    token_hash TEXT NOT NULL,
    -- Token expires in 5 minutes
    expires_at TIMESTAMPTZ NOT NULL,
    -- Track if already used
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_2fa_login_tokens_user
    ON user_2fa_login_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_2fa_login_tokens_hash
    ON user_2fa_login_tokens(token_hash)
    WHERE used_at IS NULL;

-- Cleanup old expired tokens automatically (optional, can be done via cron)
-- This creates a function to clean up expired setup/login tokens
CREATE OR REPLACE FUNCTION cleanup_expired_2fa_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM user_2fa_setup_tokens WHERE expires_at < NOW();
    DELETE FROM user_2fa_login_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security
ALTER TABLE user_2fa ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_backup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_setup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_2fa_login_tokens ENABLE ROW LEVEL SECURITY;

-- Updated at trigger for user_2fa table
DROP TRIGGER IF EXISTS update_user_2fa_updated_at ON user_2fa;
CREATE TRIGGER update_user_2fa_updated_at
    BEFORE UPDATE ON user_2fa
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE user_2fa IS 'Stores 2FA (TOTP) configuration per user';
COMMENT ON TABLE user_2fa_backup_codes IS 'One-time backup codes for 2FA recovery';
COMMENT ON TABLE user_2fa_setup_tokens IS 'Temporary tokens during 2FA setup flow';
COMMENT ON TABLE user_2fa_login_tokens IS 'Temporary tokens for 2FA login verification';
COMMENT ON COLUMN user_2fa.totp_secret_encrypted IS 'AES-256-GCM encrypted TOTP secret';
COMMENT ON COLUMN user_2fa.failed_attempts IS 'Count of failed 2FA attempts, resets on success';
COMMENT ON COLUMN user_2fa.locked_until IS 'Account locked until this time after 5 failed attempts';
