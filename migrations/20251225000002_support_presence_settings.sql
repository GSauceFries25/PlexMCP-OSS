-- Support Presence Settings Documentation
-- Date: 2025-12-25
--
-- This migration documents the presence visibility settings stored in
-- the organizations.settings JSONB column. No schema changes needed.
--
-- Settings structure:
-- {
--   "support": {
--     "show_online_status_to_customers": true  // Default: true
--   }
-- }
--
-- When enabled, customers can see if support staff are online.
-- When disabled, only admins can see presence status.

-- Add a comment to document this
COMMENT ON COLUMN organizations.settings IS 'Organization-wide settings (JSONB). Includes: support.show_online_status_to_customers (boolean)';

-- Verification query
DO $$
BEGIN
  RAISE NOTICE 'Support presence visibility setting documented in organizations.settings JSONB column';
  RAISE NOTICE 'Default behavior: Customers CAN see staff online status';
  RAISE NOTICE 'Admin can toggle: settings.support.show_online_status_to_customers';
END $$;
