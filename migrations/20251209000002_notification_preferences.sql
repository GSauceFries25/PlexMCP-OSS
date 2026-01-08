-- Migration: Add notification preferences table
-- Description: Stores user notification preferences for email alerts

CREATE TABLE user_notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_alerts BOOLEAN NOT NULL DEFAULT true,
    weekly_digest BOOLEAN NOT NULL DEFAULT false,
    usage_alerts BOOLEAN NOT NULL DEFAULT true,
    security_alerts BOOLEAN NOT NULL DEFAULT true,
    api_error_notifications BOOLEAN NOT NULL DEFAULT true,
    marketing_emails BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX idx_notification_preferences_user_id ON user_notification_preferences(user_id);

-- Note: RLS is intentionally NOT enabled on this table
-- The backend handles authorization via JWT token validation
-- and queries using the authenticated user_id from the token

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function on update
CREATE TRIGGER trigger_update_notification_preferences_updated_at
    BEFORE UPDATE ON user_notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_notification_preferences_updated_at();
