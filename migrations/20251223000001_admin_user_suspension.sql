-- Add suspension support to users table for admin control
-- This allows platform admins to suspend user accounts

-- Add suspension columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- Add password change tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Index for efficiently finding suspended users
CREATE INDEX IF NOT EXISTS idx_users_suspended ON users(is_suspended) WHERE is_suspended = TRUE;

-- Add comments for documentation
COMMENT ON COLUMN users.is_suspended IS 'Whether the user account is suspended by a platform admin';
COMMENT ON COLUMN users.suspended_at IS 'Timestamp when the account was suspended';
COMMENT ON COLUMN users.suspended_reason IS 'Admin-provided reason for suspension';
COMMENT ON COLUMN users.password_changed_at IS 'Timestamp when password was last changed';
