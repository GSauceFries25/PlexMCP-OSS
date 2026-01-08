-- User Identities (Connected Accounts) Schema for PlexMCP
-- Migration: 20251208000003_user_identities.sql
-- Date: December 8, 2025
-- Allows users to connect multiple OAuth providers to their account

-- User identities table for multiple auth methods
CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,           -- 'email', 'google', 'github'
    provider_user_id TEXT NOT NULL,   -- External ID from provider
    email TEXT,                       -- Email from provider (may differ from primary)
    display_name TEXT,                -- Name from provider
    avatar_url TEXT,                  -- Avatar from provider
    access_token_encrypted TEXT,      -- Encrypted OAuth access token (optional)
    refresh_token_encrypted TEXT,     -- Encrypted OAuth refresh token (optional)
    token_expires_at TIMESTAMPTZ,     -- When access token expires
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',      -- Additional provider data

    -- Each provider can only be linked once per user
    UNIQUE(user_id, provider),
    -- Each provider account can only be linked to one user
    UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider ON user_identities(provider, provider_user_id);

-- Audit log for identity changes
CREATE TABLE IF NOT EXISTS user_identity_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,             -- 'linked', 'unlinked', 'password_changed'
    provider TEXT,                    -- Provider name for link/unlink, NULL for password
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',      -- Additional context
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_audit_user ON user_identity_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_identity_audit_action ON user_identity_audit(action);
CREATE INDEX IF NOT EXISTS idx_identity_audit_created ON user_identity_audit(created_at);

-- Enable Row Level Security
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identity_audit ENABLE ROW LEVEL SECURITY;

-- Comments for documentation
COMMENT ON TABLE user_identities IS 'Stores linked OAuth providers and auth methods per user';
COMMENT ON TABLE user_identity_audit IS 'Audit trail for identity linking/unlinking and password changes';
COMMENT ON COLUMN user_identities.provider IS 'Auth provider: email, google, github';
COMMENT ON COLUMN user_identities.provider_user_id IS 'Unique user ID from the OAuth provider';
COMMENT ON COLUMN user_identities.access_token_encrypted IS 'AES-256-GCM encrypted OAuth access token';
COMMENT ON COLUMN user_identity_audit.action IS 'Action type: linked, unlinked, password_changed';
