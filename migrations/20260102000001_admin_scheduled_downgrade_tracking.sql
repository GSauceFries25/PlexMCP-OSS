-- Migration: Admin Scheduled Downgrade Tracking
-- Purpose: Store admin context and custom settings for scheduled downgrades
-- Date: 2026-01-02

-- Add columns for admin-initiated scheduled downgrades
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS admin_downgrade_scheduled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS admin_downgrade_scheduled_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS admin_downgrade_scheduled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS admin_downgrade_reason TEXT,
ADD COLUMN IF NOT EXISTS admin_downgrade_custom_price_cents BIGINT,
ADD COLUMN IF NOT EXISTS admin_downgrade_billing_interval VARCHAR(20);

-- Add comments for documentation
COMMENT ON COLUMN subscriptions.admin_downgrade_scheduled IS
    'True if scheduled downgrade was initiated by admin (vs user)';
COMMENT ON COLUMN subscriptions.admin_downgrade_scheduled_by IS
    'Admin user ID who scheduled the downgrade';
COMMENT ON COLUMN subscriptions.admin_downgrade_scheduled_at IS
    'Timestamp when admin scheduled the downgrade';
COMMENT ON COLUMN subscriptions.admin_downgrade_reason IS
    'Admin-provided reason for downgrade';
COMMENT ON COLUMN subscriptions.admin_downgrade_custom_price_cents IS
    'Custom price to apply when downgrade executes (Enterprise tier)';
COMMENT ON COLUMN subscriptions.admin_downgrade_billing_interval IS
    'Billing interval (monthly/annual) to apply when downgrade executes';

-- Create index for admin scheduled downgrade queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_admin_downgrade
ON subscriptions(admin_downgrade_scheduled)
WHERE admin_downgrade_scheduled = true;

-- Index for querying by admin who scheduled
CREATE INDEX IF NOT EXISTS idx_subscriptions_admin_downgrade_by
ON subscriptions(admin_downgrade_scheduled_by)
WHERE admin_downgrade_scheduled_by IS NOT NULL;
