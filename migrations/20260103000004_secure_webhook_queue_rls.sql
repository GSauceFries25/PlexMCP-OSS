-- Fix CRITICAL: webhook_processing_queue allows any authenticated user access
-- Previous policy used USING(true) which bypassed RLS for all users
-- This migration restricts access to service role and postgres only

-- Drop the overly permissive policy
DROP POLICY IF EXISTS webhook_queue_system_full_access ON webhook_processing_queue;

-- Enable FORCE RLS to ensure even superusers respect policies
ALTER TABLE webhook_processing_queue FORCE ROW LEVEL SECURITY;

-- Create restrictive policy - only service_role can access (used by backend)
-- The backend connects as service_role when processing webhooks
CREATE POLICY webhook_queue_service_role_only ON webhook_processing_queue
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Explicitly deny all access to authenticated role
-- This ensures regular users cannot access webhook data even with RLS enabled
CREATE POLICY webhook_queue_deny_authenticated ON webhook_processing_queue
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- Grant necessary permissions to service_role only
REVOKE ALL ON webhook_processing_queue FROM authenticated;
GRANT ALL ON webhook_processing_queue TO service_role;

COMMENT ON POLICY webhook_queue_service_role_only ON webhook_processing_queue IS
    'SOC 2 CC6.1: Webhook queue restricted to service role - no user access';
COMMENT ON POLICY webhook_queue_deny_authenticated ON webhook_processing_queue IS
    'SOC 2 CC6.1: Explicit deny for authenticated users';
