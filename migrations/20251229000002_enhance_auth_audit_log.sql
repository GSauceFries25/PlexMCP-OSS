-- Migration: Enhance auth_audit_log for OAuth and auth method tracking
-- Date: 2025-12-29
-- Purpose: Add provider and auth_method columns to support comprehensive authentication logging
--          for SOC 2 compliance (CC6.2 - Authentication and Credential Management)

-- Add OAuth provider and authentication method tracking columns
ALTER TABLE auth_audit_log
ADD COLUMN IF NOT EXISTS provider TEXT,
ADD COLUMN IF NOT EXISTS auth_method TEXT;

-- Add performance indexes for filtering by provider and auth method
CREATE INDEX IF NOT EXISTS idx_auth_audit_provider
  ON auth_audit_log(provider)
  WHERE provider IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_audit_method
  ON auth_audit_log(auth_method)
  WHERE auth_method IS NOT NULL;

-- Add composite index for common query patterns (provider + created_at)
CREATE INDEX IF NOT EXISTS idx_auth_audit_provider_created
  ON auth_audit_log(provider, created_at DESC)
  WHERE provider IS NOT NULL;

-- Add composite index for auth method + created_at
CREATE INDEX IF NOT EXISTS idx_auth_audit_method_created
  ON auth_audit_log(auth_method, created_at DESC)
  WHERE auth_method IS NOT NULL;

-- Add documentation comments
COMMENT ON COLUMN auth_audit_log.provider IS 'OAuth provider (google, github) or "email" for password-based authentication. NULL for system events.';
COMMENT ON COLUMN auth_audit_log.auth_method IS 'Authentication method: oauth, password, 2fa, api_key, refresh_token, magic_link';

-- Verify the columns were added successfully
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_audit_log' AND column_name = 'provider'
  ) THEN
    RAISE EXCEPTION 'Failed to add provider column to auth_audit_log';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_audit_log' AND column_name = 'auth_method'
  ) THEN
    RAISE EXCEPTION 'Failed to add auth_method column to auth_audit_log';
  END IF;

  RAISE NOTICE 'Successfully enhanced auth_audit_log with provider and auth_method columns';
END $$;
