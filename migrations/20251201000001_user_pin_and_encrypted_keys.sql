-- PlexMCP: PIN-Protected Encrypted API Key Storage
-- Migration: 20251201000001_user_pin_and_encrypted_keys.sql
--
-- This migration adds:
-- 1. PIN hash columns to users table (for user-level PIN protection)
-- 2. Encrypted key storage to api_keys table (to allow key retrieval)
-- 3. Rate limiting for PIN attempts

-- Add PIN columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS key_pin_hash VARCHAR(255),
ADD COLUMN IF NOT EXISTS key_pin_salt VARCHAR(64),
ADD COLUMN IF NOT EXISTS key_pin_set_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

-- Add encrypted key storage to api_keys table
-- encrypted_key: The API key encrypted with user's PIN-derived key
-- key_nonce: Nonce used for AES-GCM encryption
ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS encrypted_key TEXT,
ADD COLUMN IF NOT EXISTS key_nonce VARCHAR(64);

-- Index for users with PIN set (for faster lookups)
CREATE INDEX IF NOT EXISTS idx_users_has_pin ON users(id) WHERE key_pin_hash IS NOT NULL;

-- Index for PIN lockout (to find locked users)
CREATE INDEX IF NOT EXISTS idx_users_pin_locked ON users(pin_locked_until) WHERE pin_locked_until IS NOT NULL;

-- Comment explaining the encryption scheme
COMMENT ON COLUMN users.key_pin_hash IS 'Argon2id hash of the 4-digit PIN';
COMMENT ON COLUMN users.key_pin_salt IS 'Salt used for PIN hashing and key derivation';
COMMENT ON COLUMN users.key_pin_set_at IS 'When the PIN was last set/changed';
COMMENT ON COLUMN users.pin_failed_attempts IS 'Number of consecutive failed PIN attempts';
COMMENT ON COLUMN users.pin_locked_until IS 'PIN is locked until this time after too many failed attempts';
COMMENT ON COLUMN api_keys.encrypted_key IS 'API key encrypted with AES-256-GCM using PIN-derived key';
COMMENT ON COLUMN api_keys.key_nonce IS 'Base64-encoded nonce for AES-GCM decryption';
