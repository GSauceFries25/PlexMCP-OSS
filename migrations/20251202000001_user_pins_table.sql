-- PlexMCP: Separate User PINs Table
-- Migration: 20251202000001_user_pins_table.sql
--
-- This migration creates a separate table for PIN storage to support OAuth users
-- who don't have records in the users table. The user_pins table can be UPSERTed
-- without requiring all the NOT NULL constraints of the users table.

-- Create user_pins table for standalone PIN storage
CREATE TABLE IF NOT EXISTS user_pins (
    user_id UUID PRIMARY KEY,
    pin_hash VARCHAR(255) NOT NULL,
    pin_salt VARCHAR(64) NOT NULL,
    pin_set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ
);

-- Index for lockout lookups
CREATE INDEX IF NOT EXISTS idx_user_pins_locked ON user_pins(locked_until) WHERE locked_until IS NOT NULL;

-- Migrate any existing PIN data from users table to user_pins (if exists)
INSERT INTO user_pins (user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until)
SELECT id, key_pin_hash, key_pin_salt, COALESCE(key_pin_set_at, NOW()), pin_failed_attempts, pin_locked_until
FROM users
WHERE key_pin_hash IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE user_pins IS 'Stores PIN data separately from users table for OAuth user support';
COMMENT ON COLUMN user_pins.user_id IS 'Reference to auth.users (Supabase) - not FK constrained for flexibility';
COMMENT ON COLUMN user_pins.pin_hash IS 'Argon2id hash of the 4-digit PIN';
COMMENT ON COLUMN user_pins.pin_salt IS 'Salt used for PIN hashing and key derivation';
COMMENT ON COLUMN user_pins.pin_set_at IS 'When the PIN was last set/changed';
COMMENT ON COLUMN user_pins.failed_attempts IS 'Number of consecutive failed PIN attempts';
COMMENT ON COLUMN user_pins.locked_until IS 'PIN is locked until this time after too many failed attempts';
