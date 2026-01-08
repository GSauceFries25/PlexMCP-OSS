-- Migration: Track sent spend cap notifications to avoid duplicates
-- Prevents sending the same threshold notification multiple times per billing period

CREATE TABLE IF NOT EXISTS spend_cap_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    billing_period_start TIMESTAMPTZ NOT NULL,

    -- Threshold that triggered the notification (50, 75, 90, 100)
    threshold_percent INTEGER NOT NULL,

    -- Tracking
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    email_to VARCHAR(255) NOT NULL,

    -- Prevent duplicate notifications for same threshold in same period
    UNIQUE(org_id, billing_period_start, threshold_percent)
);

-- Index for fast lookup by org and period
CREATE INDEX IF NOT EXISTS idx_spend_cap_notifications_org_period
    ON spend_cap_notifications(org_id, billing_period_start);

-- Enable RLS
ALTER TABLE spend_cap_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Organization isolation (read-only for users)
DROP POLICY IF EXISTS spend_cap_notifications_org_policy ON spend_cap_notifications;
CREATE POLICY spend_cap_notifications_org_policy ON spend_cap_notifications
    FOR SELECT
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Comments
COMMENT ON TABLE spend_cap_notifications IS 'Tracks sent spend cap threshold notifications';
COMMENT ON COLUMN spend_cap_notifications.threshold_percent IS 'Notification threshold: 50, 75, 90, or 100';
