-- Sync is_admin boolean with platform_role enum for consistency
-- This ensures both fields are in sync for RLS policies

-- Update is_admin to true for users with admin/superadmin platform_role
UPDATE users
SET is_admin = true
WHERE platform_role IN ('admin', 'superadmin') AND (is_admin = false OR is_admin IS NULL);

-- Update is_admin to true for staff as well (for support ticket access)
UPDATE users
SET is_admin = true
WHERE platform_role = 'staff' AND (is_admin = false OR is_admin IS NULL);

-- Add an index on is_admin for faster RLS policy checks
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = true;

-- Note: We're keeping both fields for now to maintain backwards compatibility
-- with existing RLS policies that use is_admin. Future migrations should
-- update all RLS policies to use platform_role instead.
