-- Migration: Admin Refunds Table
-- Purpose: Track refunds issued by admins during tier changes
-- Date: 2026-01-04

-- Create the admin_refunds table for audit trail
CREATE TABLE IF NOT EXISTS admin_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    admin_user_id UUID NOT NULL,
    stripe_refund_id VARCHAR(255),
    stripe_charge_id VARCHAR(255),
    stripe_invoice_id VARCHAR(255),
    amount_cents INTEGER NOT NULL,
    refund_type VARCHAR(20) NOT NULL CHECK (refund_type IN ('refund', 'credit')),
    reason TEXT NOT NULL,
    old_tier VARCHAR(50) NOT NULL,
    new_tier VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_admin_refunds_org_id ON admin_refunds(org_id);
CREATE INDEX IF NOT EXISTS idx_admin_refunds_admin_user_id ON admin_refunds(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_refunds_created_at ON admin_refunds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_refunds_status ON admin_refunds(status);

-- Enable RLS
ALTER TABLE admin_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_refunds FORCE ROW LEVEL SECURITY;

-- RLS Policy: Only admins can view/manage refunds
-- Note: This table is admin-only, no regular user access
CREATE POLICY admin_refunds_admin_all ON admin_refunds
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
            AND u.platform_role IN ('admin', 'superadmin', 'staff')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
            AND u.platform_role IN ('admin', 'superadmin', 'staff')
        )
    );

-- Add comment for documentation
COMMENT ON TABLE admin_refunds IS 'Audit trail for refunds issued by admins during tier changes';
COMMENT ON COLUMN admin_refunds.refund_type IS 'refund = actual money back to payment method, credit = Stripe account credit';
COMMENT ON COLUMN admin_refunds.status IS 'pending = processing, completed = success, failed = error occurred';
