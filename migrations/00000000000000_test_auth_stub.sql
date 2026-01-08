-- Test Auth Stub for SQLx Integration Tests
-- This migration creates a stub for Supabase's auth schema and auth.uid()/auth.role() functions
-- Only needed for local testing with #[sqlx::test] - not run in production

-- Create auth schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS auth;

-- Create a stub auth.uid() function that returns a test UUID
-- In tests, this can be overridden by setting a session variable
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID AS $$
BEGIN
  -- Check if a test user ID is set in session
  BEGIN
    RETURN current_setting('test.auth_user_id', true)::UUID;
  EXCEPTION WHEN OTHERS THEN
    -- Default test user ID if not set
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
  END;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION auth.uid() IS 'Stub function for testing - returns test user ID from session or default UUID';

-- Create a stub auth.role() function that returns the current role
-- In tests, this can be overridden by setting a session variable
CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT AS $$
BEGIN
  -- Check if a test role is set in session
  BEGIN
    RETURN current_setting('test.auth_role', true);
  EXCEPTION WHEN OTHERS THEN
    -- Default to 'anon' if not set
    RETURN 'anon';
  END;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION auth.role() IS 'Stub function for testing - returns test role from session or anon';
