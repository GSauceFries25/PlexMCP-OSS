-- Fix CRITICAL security vulnerability in webhook_processing_queue RLS
-- Issue: Public role has USING(true) policy allowing any authenticated user
-- to access ALL webhook payloads (potential PII, payment data exposure)
-- CVE: Cross-tenant data access via overly permissive RLS policy

-- Drop the dangerous policy that allows public access
DROP POLICY IF EXISTS webhook_queue_system_full_access ON webhook_processing_queue;

-- Ensure backend-only policy exists (may already exist from previous migration)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'webhook_processing_queue'
        AND policyname = 'webhook_processing_queue_backend_access'
    ) THEN
        CREATE POLICY webhook_processing_queue_backend_access ON webhook_processing_queue
            FOR ALL
            TO postgres
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- Add service_role access for Supabase backend operations
CREATE POLICY webhook_processing_queue_service_access ON webhook_processing_queue
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Explicitly block public/authenticated role access
-- This is defense-in-depth - without a policy, access is denied anyway when FORCE RLS is on
CREATE POLICY webhook_processing_queue_block_public ON webhook_processing_queue
    FOR ALL
    TO public
    USING (false)
    WITH CHECK (false);

-- Ensure FORCE RLS is enabled (defense-in-depth)
ALTER TABLE webhook_processing_queue FORCE ROW LEVEL SECURITY;

COMMENT ON POLICY webhook_processing_queue_backend_access ON webhook_processing_queue IS 'Backend (postgres role) has full access for webhook processing';
COMMENT ON POLICY webhook_processing_queue_service_access ON webhook_processing_queue IS 'Supabase service role has full access';
COMMENT ON POLICY webhook_processing_queue_block_public ON webhook_processing_queue IS 'Explicitly blocks public/authenticated role access - webhooks are system-level only';
