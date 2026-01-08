-- Security Alerting System
-- Phase 2.3: SOC 2 Compliance - Automated Security Monitoring
--
-- SOC 2 Requirement: CC7.2 - System monitoring for anomalies
--
-- This system tracks security events and triggers real-time alerts for:
-- - Brute force attacks (5+ failed logins in 5 minutes)
-- - Privilege escalation (role changes to admin/superadmin)
-- - Data exfiltration (large exports, unusual API patterns)
-- - Configuration changes (MCP modifications, RLS changes)
-- - Rate limit violations (sustained abuse)

CREATE TABLE IF NOT EXISTS security_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Alert classification
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'brute_force_attack',
        'privilege_escalation',
        'data_exfiltration',
        'configuration_change',
        'rate_limit_violation',
        'suspicious_activity',
        'authentication_anomaly'
    )),

    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    -- Subject of the alert
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    ip_address TEXT,

    -- Alert details
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',

    -- Event aggregation (for alerts triggered by multiple events)
    event_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Alert lifecycle
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,

    -- External notification tracking
    notified_at TIMESTAMPTZ,
    notification_status TEXT CHECK (notification_status IN ('pending', 'sent', 'failed')),
    notification_error TEXT,

    CONSTRAINT valid_ack CHECK (
        (acknowledged_at IS NULL AND acknowledged_by IS NULL) OR
        (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)
    ),
    CONSTRAINT valid_resolution CHECK (
        (resolved_at IS NULL AND resolved_by IS NULL AND resolution_notes IS NULL) OR
        (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    )
);

-- Index for finding active alerts
CREATE INDEX idx_security_alerts_active ON security_alerts(created_at DESC)
    WHERE acknowledged_at IS NULL AND resolved_at IS NULL;

-- Index for user-specific alerts
CREATE INDEX idx_security_alerts_user ON security_alerts(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- Index for org-specific alerts
CREATE INDEX idx_security_alerts_org ON security_alerts(org_id, created_at DESC)
    WHERE org_id IS NOT NULL;

-- Index for alert type analysis
CREATE INDEX idx_security_alerts_type ON security_alerts(alert_type, severity, created_at DESC);

-- Index for IP-based analysis
CREATE INDEX idx_security_alerts_ip ON security_alerts(ip_address, created_at DESC)
    WHERE ip_address IS NOT NULL;

-- Row-Level Security
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts FORCE ROW LEVEL SECURITY;

-- Policy: Superadmins can see all alerts
CREATE POLICY superadmin_all_alerts ON security_alerts
    FOR ALL
    TO PUBLIC
    USING (current_setting('app.is_superadmin', true)::boolean = true)
    WITH CHECK (current_setting('app.is_superadmin', true)::boolean = true);

-- Policy: Org admins can see alerts for their org
CREATE POLICY org_admin_alerts ON security_alerts
    FOR SELECT
    TO PUBLIC
    USING (
        org_id = current_setting('app.current_org_id', true)::uuid
        AND current_setting('app.user_role', true)::text IN ('owner', 'admin')
    );

-- =============================================================================
-- Alert Threshold Tracking
-- =============================================================================

-- Tracks event counts to determine when to trigger alerts
CREATE TABLE IF NOT EXISTS alert_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What is being tracked
    threshold_type TEXT NOT NULL,
    threshold_key TEXT NOT NULL,  -- e.g., "user:123" or "ip:1.2.3.4"

    -- Event tracking
    event_count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_end TIMESTAMPTZ NOT NULL,

    -- Alert status
    alert_triggered BOOLEAN NOT NULL DEFAULT false,
    alert_id UUID REFERENCES security_alerts(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (threshold_type, threshold_key, window_start)
);

-- Index for finding active thresholds (query should filter window_end > NOW() at runtime)
CREATE INDEX idx_alert_thresholds_active ON alert_thresholds(threshold_type, threshold_key, window_end)
    WHERE alert_triggered = false;

-- Index for cleanup query (query should filter by created_at at runtime)
CREATE INDEX idx_alert_thresholds_cleanup ON alert_thresholds(created_at);

-- Row-Level Security for alert_thresholds
ALTER TABLE alert_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_thresholds FORCE ROW LEVEL SECURITY;

-- Backend policy for alert_thresholds
CREATE POLICY alert_thresholds_backend ON alert_thresholds
    FOR ALL TO postgres USING (true) WITH CHECK (true);

-- =============================================================================
-- Alert Configuration
-- =============================================================================

-- Stores alert rules and thresholds
CREATE TABLE IF NOT EXISTS alert_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    alert_type TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT true,

    -- Threshold configuration
    threshold_count INTEGER NOT NULL,  -- e.g., 5 failures
    threshold_window_seconds INTEGER NOT NULL,  -- e.g., 300 seconds (5 minutes)

    -- Notification configuration
    notify_slack BOOLEAN NOT NULL DEFAULT true,
    notify_email BOOLEAN NOT NULL DEFAULT false,
    notify_pagerduty BOOLEAN NOT NULL DEFAULT false,

    -- Cooldown to prevent alert spam
    cooldown_seconds INTEGER NOT NULL DEFAULT 300,  -- 5 minutes

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default alert configurations
INSERT INTO alert_configurations (alert_type, threshold_count, threshold_window_seconds, cooldown_seconds)
VALUES
    ('brute_force_attack', 5, 300, 300),  -- 5 failures in 5 minutes
    ('privilege_escalation', 1, 60, 0),  -- Immediate alert, no cooldown
    ('data_exfiltration', 3, 60, 300),  -- 3 large exports in 1 minute
    ('configuration_change', 1, 60, 0),  -- Immediate alert for config changes
    ('rate_limit_violation', 10, 300, 600),  -- 10 violations in 5 minutes
    ('suspicious_activity', 3, 60, 300),  -- 3 suspicious events in 1 minute
    ('authentication_anomaly', 1, 60, 300)  -- 1 anomaly triggers alert
ON CONFLICT (alert_type) DO NOTHING;

-- Row-Level Security for alert_configurations
ALTER TABLE alert_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_configurations FORCE ROW LEVEL SECURITY;

-- Backend policy for alert_configurations
CREATE POLICY alert_configurations_backend ON alert_configurations
    FOR ALL TO postgres USING (true) WITH CHECK (true);

-- =============================================================================
-- Helper Functions
-- =============================================================================

-- Function to increment threshold and check if alert should be triggered
CREATE OR REPLACE FUNCTION increment_alert_threshold(
    p_threshold_type TEXT,
    p_threshold_key TEXT,
    p_window_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_count INTEGER;
    v_threshold_config RECORD;
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
BEGIN
    -- Get alert configuration
    SELECT threshold_count, threshold_window_seconds
    INTO v_threshold_config
    FROM alert_configurations
    WHERE alert_type = p_threshold_type
      AND enabled = true;

    IF NOT FOUND THEN
        RETURN false;  -- Alert type not configured or disabled
    END IF;

    -- Calculate time window
    v_window_end := NOW();
    v_window_start := v_window_end - (v_threshold_config.threshold_window_seconds || ' seconds')::INTERVAL;

    -- Find or create threshold record
    INSERT INTO alert_thresholds (threshold_type, threshold_key, window_start, window_end, event_count)
    VALUES (p_threshold_type, p_threshold_key, v_window_start, v_window_end, 1)
    ON CONFLICT (threshold_type, threshold_key, window_start)
    DO UPDATE SET
        event_count = alert_thresholds.event_count + 1,
        updated_at = NOW()
    RETURNING event_count INTO v_current_count;

    -- Check if threshold exceeded
    IF v_current_count >= v_threshold_config.threshold_count THEN
        -- Mark threshold as triggered
        UPDATE alert_thresholds
        SET alert_triggered = true
        WHERE threshold_type = p_threshold_type
          AND threshold_key = p_threshold_key
          AND window_start = v_window_start;

        RETURN true;  -- Trigger alert!
    END IF;

    RETURN false;
END;
$$;

-- Function to cleanup old threshold records
CREATE OR REPLACE FUNCTION cleanup_old_alert_thresholds()
RETURNS void
LANGUAGE sql
AS $$
    DELETE FROM alert_thresholds
    WHERE created_at < NOW() - INTERVAL '7 days';
$$;

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    table_count INTEGER;
    config_count INTEGER;
BEGIN
    -- Verify tables created
    SELECT COUNT(*)
    INTO table_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('security_alerts', 'alert_thresholds', 'alert_configurations');

    IF table_count != 3 THEN
        RAISE EXCEPTION 'Expected 3 tables (security_alerts, alert_thresholds, alert_configurations), found %', table_count;
    END IF;

    -- Verify default configurations
    SELECT COUNT(*)
    INTO config_count
    FROM alert_configurations;

    IF config_count < 7 THEN
        RAISE EXCEPTION 'Expected at least 7 alert configurations, found %', config_count;
    END IF;

    RAISE NOTICE '✓ Security alerting system initialized successfully';
    RAISE NOTICE '  - Tables: security_alerts, alert_thresholds, alert_configurations';
    RAISE NOTICE '  - Alert types configured: %', config_count;
    RAISE NOTICE '  - RLS policies: active';
    RAISE NOTICE '  - Helper functions: increment_alert_threshold, cleanup_old_alert_thresholds';
END $$;
