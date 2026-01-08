-- Migration: Admin Trial Tracking
-- Date: December 31, 2025
-- Purpose: Add tracking for admin-granted trials and Stripe metadata in audit logs

-- ============================================================================
-- Step 1: Add trial tracking columns to subscriptions table
-- ============================================================================

-- Track admin-granted trials with metadata
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS admin_trial_granted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS admin_trial_granted_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS admin_trial_granted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS admin_trial_reason TEXT;

-- Add comment for documentation
COMMENT ON COLUMN subscriptions.admin_trial_granted IS 'Flag indicating if this trial was granted by an admin (vs user self-service trial)';
COMMENT ON COLUMN subscriptions.admin_trial_granted_by IS 'Admin user ID who granted the trial';
COMMENT ON COLUMN subscriptions.admin_trial_granted_at IS 'Timestamp when admin granted the trial';
COMMENT ON COLUMN subscriptions.admin_trial_reason IS 'Reason for admin granting trial (for audit purposes)';

-- ============================================================================
-- Step 2: Create index for admin trial queries
-- ============================================================================

-- Partial index for efficient querying of admin-granted trials
CREATE INDEX IF NOT EXISTS idx_subscriptions_admin_trial
ON subscriptions(admin_trial_granted)
WHERE admin_trial_granted = true;

-- Index for querying trials by granting admin
CREATE INDEX IF NOT EXISTS idx_subscriptions_admin_trial_granted_by
ON subscriptions(admin_trial_granted_by)
WHERE admin_trial_granted_by IS NOT NULL;

-- ============================================================================
-- Step 3: Enhance admin_audit_log with Stripe data
-- ============================================================================
-- Note: The legacy audit_logs table was replaced with admin_audit_log in SOC 2 migration

-- Add Stripe ID columns to admin_audit_log for tracking billing changes
ALTER TABLE admin_audit_log
ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

-- Add comments for documentation
COMMENT ON COLUMN admin_audit_log.stripe_subscription_id IS 'Stripe subscription ID associated with this audit event (for billing-related actions)';
COMMENT ON COLUMN admin_audit_log.stripe_customer_id IS 'Stripe customer ID associated with this audit event (for billing-related actions)';

-- Create index for querying audit logs by Stripe subscription
CREATE INDEX IF NOT EXISTS idx_admin_audit_stripe_subscription
ON admin_audit_log(stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

-- Create index for querying audit logs by Stripe customer
CREATE INDEX IF NOT EXISTS idx_admin_audit_stripe_customer
ON admin_audit_log(stripe_customer_id)
WHERE stripe_customer_id IS NOT NULL;

-- ============================================================================
-- Migration Notes
-- ============================================================================

-- This migration adds support for tracking admin-initiated trials and
-- enhances audit logging with Stripe metadata to prevent database/Stripe drift.
--
-- Key Features:
-- 1. Admin trial tracking: Know which trials were granted by admins vs self-service
-- 2. Audit trail: Complete history of who granted trials and why
-- 3. Stripe correlation: Link audit events to Stripe subscriptions/customers
-- 4. Efficient querying: Partial indexes minimize storage overhead
--
-- Rollback:
-- To rollback this migration, run:
--
-- DROP INDEX IF EXISTS idx_admin_audit_stripe_customer;
-- DROP INDEX IF EXISTS idx_admin_audit_stripe_subscription;
-- ALTER TABLE admin_audit_log DROP COLUMN IF EXISTS stripe_customer_id;
-- ALTER TABLE admin_audit_log DROP COLUMN IF EXISTS stripe_subscription_id;
-- DROP INDEX IF EXISTS idx_subscriptions_admin_trial_granted_by;
-- DROP INDEX IF EXISTS idx_subscriptions_admin_trial;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS admin_trial_reason;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS admin_trial_granted_at;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS admin_trial_granted_by;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS admin_trial_granted;
