-- PlexMCP Website Analytics - Complete Fix and Enhancement
-- Migration: 20251230000001_fix_website_analytics.sql
-- Fixes critical bugs and adds bot detection, admin exclusion, and alerts
--
-- CRITICAL FIXES:
-- 1. Add UNIQUE constraint on fingerprint_hash (Bug #1)
-- 2. Add bot detection columns
-- 3. Add admin exclusion columns
-- 4. Add real-time alert system
--
-- NOTE: This migration drops all existing analytics data to start fresh
-- with accurate tracking. All data will be recreated from this point forward.

-- =============================================================================
-- Drop Existing Analytics Tables (Start Fresh)
-- =============================================================================

DROP TABLE IF EXISTS analytics_realtime CASCADE;
DROP TABLE IF EXISTS analytics_alerts CASCADE;
DROP TABLE IF EXISTS analytics_conversions CASCADE;
DROP TABLE IF EXISTS analytics_goals CASCADE;
DROP TABLE IF EXISTS analytics_events CASCADE;
DROP TABLE IF EXISTS analytics_page_views CASCADE;
DROP TABLE IF EXISTS analytics_aggregates_hourly CASCADE;
DROP TABLE IF EXISTS analytics_sessions CASCADE;
DROP TABLE IF EXISTS analytics_visitors CASCADE;
DROP TABLE IF EXISTS analytics_settings CASCADE;

-- Drop the cleanup function
DROP FUNCTION IF EXISTS cleanup_analytics_realtime();

-- =============================================================================
-- Analytics Visitors (Anonymous and Authenticated)
-- =============================================================================

CREATE TABLE analytics_visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Privacy-preserving fingerprint (SHA-256 hash of IP + UA + daily salt)
    fingerprint_hash VARCHAR(64) NOT NULL,
    -- Link to authenticated user (if logged in)
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Visit tracking
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    visit_count INTEGER NOT NULL DEFAULT 1,
    is_returning BOOLEAN NOT NULL DEFAULT FALSE,
    -- Bot detection (NEW)
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    bot_score INTEGER DEFAULT 0,
    bot_patterns TEXT[],
    -- Admin exclusion (NEW)
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CRITICAL FIX: Use UNIQUE index instead of regular index
CREATE UNIQUE INDEX idx_analytics_visitors_fingerprint ON analytics_visitors(fingerprint_hash);
CREATE INDEX idx_analytics_visitors_user ON analytics_visitors(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_analytics_visitors_first_seen ON analytics_visitors(first_seen_at DESC);
CREATE INDEX idx_analytics_visitors_last_seen ON analytics_visitors(last_seen_at DESC);
CREATE INDEX idx_analytics_visitors_bots ON analytics_visitors(is_bot) WHERE is_bot = true;
CREATE INDEX idx_analytics_visitors_admin ON analytics_visitors(is_admin) WHERE is_admin = true;

-- =============================================================================
-- Analytics Sessions
-- =============================================================================

CREATE TABLE analytics_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id UUID NOT NULL REFERENCES analytics_visitors(id) ON DELETE CASCADE,
    -- Session timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    -- Engagement
    page_views INTEGER NOT NULL DEFAULT 0,
    is_bounce BOOLEAN NOT NULL DEFAULT TRUE,  -- Single page view = bounce
    entry_page VARCHAR(2048),
    exit_page VARCHAR(2048),
    -- Device/Browser info (parsed from user agent)
    browser VARCHAR(100),
    browser_version VARCHAR(50),
    os VARCHAR(100),
    os_version VARCHAR(50),
    device_type VARCHAR(20),  -- desktop, mobile, tablet, bot
    screen_width INTEGER,
    screen_height INTEGER,
    -- Location (privacy-friendly: country/region, optional city)
    country_code CHAR(2),
    region_code VARCHAR(10),
    city VARCHAR(100),  -- Optional, controlled by privacy settings
    -- Traffic source
    referrer VARCHAR(2048),
    referrer_domain VARCHAR(255),
    -- UTM parameters
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_term VARCHAR(255),
    utm_content VARCHAR(255),
    -- Technical (privacy-hashed)
    ip_hash VARCHAR(64),  -- SHA-256 of IP for duplicate detection
    user_agent TEXT,
    -- Bot detection (NEW)
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    -- Admin exclusion (NEW)
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_sessions_visitor ON analytics_sessions(visitor_id);
CREATE INDEX idx_analytics_sessions_started ON analytics_sessions(started_at DESC);
CREATE INDEX idx_analytics_sessions_country ON analytics_sessions(country_code) WHERE country_code IS NOT NULL;
CREATE INDEX idx_analytics_sessions_device ON analytics_sessions(device_type);
CREATE INDEX idx_analytics_sessions_referrer ON analytics_sessions(referrer_domain) WHERE referrer_domain IS NOT NULL;
CREATE INDEX idx_analytics_sessions_utm ON analytics_sessions(utm_source, utm_medium) WHERE utm_source IS NOT NULL;
CREATE INDEX idx_analytics_sessions_bots ON analytics_sessions(is_bot) WHERE is_bot = true;

-- =============================================================================
-- Analytics Page Views
-- =============================================================================

CREATE TABLE analytics_page_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
    visitor_id UUID NOT NULL REFERENCES analytics_visitors(id) ON DELETE CASCADE,
    -- Page info
    url VARCHAR(2048) NOT NULL,
    url_path VARCHAR(2048) NOT NULL,  -- Path only (without domain)
    url_query VARCHAR(2048),  -- Query string (sanitized)
    title VARCHAR(500),
    -- Navigation
    referrer VARCHAR(2048),  -- Previous page (internal navigation tracking)
    -- Timing
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exited_at TIMESTAMPTZ,
    time_on_page_seconds INTEGER,
    -- Engagement
    scroll_depth_percent INTEGER,  -- 0-100
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_pageviews_session ON analytics_page_views(session_id);
CREATE INDEX idx_analytics_pageviews_visitor ON analytics_page_views(visitor_id);
CREATE INDEX idx_analytics_pageviews_path ON analytics_page_views(url_path);
CREATE INDEX idx_analytics_pageviews_entered ON analytics_page_views(entered_at DESC);

-- =============================================================================
-- Analytics Events (Custom Event Tracking)
-- =============================================================================

CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES analytics_sessions(id) ON DELETE CASCADE,
    visitor_id UUID REFERENCES analytics_visitors(id) ON DELETE CASCADE,
    -- Event identification
    event_name VARCHAR(255) NOT NULL,
    event_category VARCHAR(100),
    -- Flexible event data
    event_data JSONB,
    -- Context
    page_url VARCHAR(2048),
    page_path VARCHAR(2048),
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_events_session ON analytics_events(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_analytics_events_visitor ON analytics_events(visitor_id) WHERE visitor_id IS NOT NULL;
CREATE INDEX idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX idx_analytics_events_category ON analytics_events(event_category) WHERE event_category IS NOT NULL;
CREATE INDEX idx_analytics_events_created ON analytics_events(created_at DESC);

-- =============================================================================
-- Analytics Goals/Conversions
-- =============================================================================

CREATE TABLE analytics_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    -- Goal trigger criteria
    event_name VARCHAR(255),  -- Match event name for event-based goals
    url_pattern VARCHAR(2048),  -- Regex pattern for URL-based goals
    goal_type VARCHAR(50) NOT NULL,  -- 'event', 'pageview', 'engagement', 'duration'
    -- Goal configuration
    min_duration_seconds INTEGER,  -- For engagement goals
    min_page_views INTEGER,  -- For engagement goals
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_analytics_goals_name ON analytics_goals(name);

CREATE TABLE analytics_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES analytics_goals(id) ON DELETE CASCADE,
    session_id UUID REFERENCES analytics_sessions(id) ON DELETE CASCADE,
    visitor_id UUID REFERENCES analytics_visitors(id) ON DELETE CASCADE,
    -- Conversion value
    value_cents INTEGER,  -- Optional monetary value
    metadata JSONB,  -- Additional conversion context
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_conversions_goal ON analytics_conversions(goal_id);
CREATE INDEX idx_analytics_conversions_session ON analytics_conversions(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_analytics_conversions_created ON analytics_conversions(created_at DESC);

-- =============================================================================
-- Analytics Aggregates (Hourly Rollups for Performance)
-- =============================================================================

CREATE TABLE analytics_aggregates_hourly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_hour TIMESTAMPTZ NOT NULL,
    page_path VARCHAR(2048),  -- NULL for site-wide aggregates
    -- Core metrics
    visitors INTEGER NOT NULL DEFAULT 0,
    sessions INTEGER NOT NULL DEFAULT 0,
    page_views INTEGER NOT NULL DEFAULT 0,
    bounces INTEGER NOT NULL DEFAULT 0,
    total_time_seconds BIGINT NOT NULL DEFAULT 0,
    -- Breakdown data (stored as JSONB for flexibility)
    by_country JSONB,   -- {"US": 10, "UK": 5, ...}
    by_device JSONB,    -- {"desktop": 12, "mobile": 3, ...}
    by_browser JSONB,   -- {"Chrome": 10, "Safari": 5, ...}
    by_referrer JSONB,  -- {"google.com": 5, "twitter.com": 2, ...}
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint for upsert operations
CREATE UNIQUE INDEX idx_analytics_agg_hour_path
ON analytics_aggregates_hourly(period_hour, COALESCE(page_path, ''));

CREATE INDEX idx_analytics_agg_hour ON analytics_aggregates_hourly(period_hour DESC);

-- =============================================================================
-- Analytics Settings (Privacy Controls & Alert Configuration)
-- =============================================================================

CREATE TABLE analytics_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Privacy settings
    anonymize_ip BOOLEAN NOT NULL DEFAULT TRUE,  -- Hash IPs (always recommended)
    collect_city BOOLEAN NOT NULL DEFAULT FALSE,  -- City-level geo (off by default)
    respect_dnt BOOLEAN NOT NULL DEFAULT TRUE,   -- Honor Do Not Track header
    cookie_consent_required BOOLEAN NOT NULL DEFAULT FALSE,  -- GDPR consent mode
    -- Data retention settings
    raw_data_retention_days INTEGER NOT NULL DEFAULT 90,  -- Keep raw data 90 days
    aggregate_retention_days INTEGER NOT NULL DEFAULT 730,  -- Keep aggregates 2 years
    -- Real-time settings
    enable_realtime BOOLEAN NOT NULL DEFAULT TRUE,
    realtime_max_visitors INTEGER NOT NULL DEFAULT 1000,  -- Cap for performance
    -- Excluded paths (not tracked)
    excluded_paths TEXT[],  -- e.g., ['/admin/*', '/api/*']
    -- Excluded IPs (not tracked)
    excluded_ips TEXT[],  -- e.g., ['127.0.0.1', '10.0.0.*']
    -- Bot filtering (NEW: enabled by default)
    filter_bots BOOLEAN NOT NULL DEFAULT TRUE,
    bot_detection_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- Admin exclusion (NEW)
    exclude_admin_visits BOOLEAN NOT NULL DEFAULT TRUE,
    -- Alert settings (NEW)
    alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    alert_threshold_multiplier DECIMAL(5,2) NOT NULL DEFAULT 5.0,  -- Alert when traffic > 5x baseline
    alert_time_window_minutes INTEGER NOT NULL DEFAULT 5,  -- Check last 5 minutes
    alert_webhook_url TEXT,  -- Optional webhook for alert notifications
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure only one settings row exists (singleton)
CREATE UNIQUE INDEX idx_analytics_settings_singleton
ON analytics_settings((TRUE));

-- Insert default settings with new alert configurations
INSERT INTO analytics_settings (
    anonymize_ip,
    collect_city,
    respect_dnt,
    raw_data_retention_days,
    filter_bots,
    bot_detection_enabled,
    exclude_admin_visits,
    alerts_enabled,
    alert_threshold_multiplier,
    alert_time_window_minutes
)
VALUES (TRUE, FALSE, TRUE, 90, TRUE, TRUE, TRUE, TRUE, 5.0, 5)
ON CONFLICT ((TRUE)) DO NOTHING;

-- =============================================================================
-- Real-time Tracking Table (for live visitor count)
-- =============================================================================

CREATE TABLE analytics_realtime (
    session_id UUID PRIMARY KEY REFERENCES analytics_sessions(id) ON DELETE CASCADE,
    visitor_id UUID NOT NULL REFERENCES analytics_visitors(id) ON DELETE CASCADE,
    current_page VARCHAR(2048),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Quick-access fields for real-time dashboard
    country_code CHAR(2),
    device_type VARCHAR(20)
);

CREATE INDEX idx_analytics_realtime_activity ON analytics_realtime(last_activity_at DESC);

-- Cleanup old real-time entries (sessions inactive for 5+ minutes)
-- This should be called periodically by a worker
CREATE OR REPLACE FUNCTION cleanup_analytics_realtime()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM analytics_realtime
    WHERE last_activity_at < NOW() - INTERVAL '5 minutes';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Analytics Alerts (NEW: Real-time Traffic Spike Detection)
-- =============================================================================

CREATE TABLE analytics_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Alert classification
    alert_type VARCHAR(50) NOT NULL,  -- 'traffic_spike', 'anomaly', 'bot_attack'
    severity VARCHAR(20) NOT NULL,  -- 'low', 'medium', 'high', 'critical'
    -- Alert details
    metric_name VARCHAR(100) NOT NULL,  -- 'visitors', 'sessions', 'page_views'
    current_value BIGINT NOT NULL,
    baseline_value BIGINT NOT NULL,
    threshold_multiplier DECIMAL(5,2) NOT NULL,
    -- Alert metadata
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolution_note TEXT,
    -- Context
    time_window_minutes INTEGER NOT NULL,
    alert_data JSONB,  -- Additional context (affected pages, countries, etc.)
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_alerts_triggered ON analytics_alerts(triggered_at DESC);
CREATE INDEX idx_analytics_alerts_type ON analytics_alerts(alert_type);
CREATE INDEX idx_analytics_alerts_severity ON analytics_alerts(severity);
CREATE INDEX idx_analytics_alerts_resolved ON analytics_alerts(is_resolved, triggered_at DESC);

-- =============================================================================
-- RLS Policies
-- =============================================================================

-- Analytics data is platform-wide, admin-only access
ALTER TABLE analytics_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_aggregates_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_realtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_alerts ENABLE ROW LEVEL SECURITY;

-- Admin-only read access
CREATE POLICY "Admins can view analytics"
ON analytics_visitors FOR SELECT
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can view sessions"
ON analytics_sessions FOR SELECT
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can view page views"
ON analytics_page_views FOR SELECT
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can view events"
ON analytics_events FOR SELECT
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can manage goals"
ON analytics_goals FOR ALL
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can view conversions"
ON analytics_conversions FOR SELECT
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can view aggregates"
ON analytics_aggregates_hourly FOR SELECT
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can manage settings"
ON analytics_settings FOR ALL
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can view realtime"
ON analytics_realtime FOR SELECT
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can view alerts"
ON analytics_alerts FOR SELECT
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can manage alerts"
ON analytics_alerts FOR UPDATE
USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- =============================================================================
-- Seed Default Goals
-- =============================================================================

INSERT INTO analytics_goals (name, description, goal_type, url_pattern) VALUES
('Registration Complete', 'User completed registration', 'pageview', '/register/success'),
('Pricing Page View', 'User viewed pricing page', 'pageview', '/pricing'),
('Documentation View', 'User viewed documentation', 'pageview', '/docs.*'),
('Contact Sales', 'User submitted contact sales form', 'event', NULL)
ON CONFLICT (name) DO NOTHING;

-- Update the event-based goal
UPDATE analytics_goals
SET event_name = 'contact_sales_submit'
WHERE name = 'Contact Sales';

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE analytics_visitors IS 'Unique visitors identified by privacy-preserving fingerprint';
COMMENT ON TABLE analytics_sessions IS 'Browser sessions with 30-min timeout';
COMMENT ON TABLE analytics_page_views IS 'Individual page view events';
COMMENT ON TABLE analytics_events IS 'Custom event tracking (button clicks, form submissions, etc.)';
COMMENT ON TABLE analytics_goals IS 'Conversion goals configuration';
COMMENT ON TABLE analytics_conversions IS 'Recorded goal completions';
COMMENT ON TABLE analytics_aggregates_hourly IS 'Pre-computed hourly stats for dashboard performance';
COMMENT ON TABLE analytics_settings IS 'Platform analytics privacy and retention settings';
COMMENT ON TABLE analytics_realtime IS 'Active sessions for real-time visitor count';
COMMENT ON TABLE analytics_alerts IS 'Real-time traffic spike and anomaly detection';

COMMENT ON COLUMN analytics_visitors.fingerprint_hash IS 'SHA-256 hash of IP + User-Agent + daily salt (rotates daily for privacy)';
COMMENT ON COLUMN analytics_visitors.is_bot IS 'True if visitor detected as bot via pattern matching';
COMMENT ON COLUMN analytics_visitors.bot_score IS 'Bot detection confidence score (0-100)';
COMMENT ON COLUMN analytics_visitors.is_admin IS 'True if visitor is authenticated admin (excluded from stats if enabled)';
COMMENT ON COLUMN analytics_sessions.ip_hash IS 'SHA-256 hash of IP address (never stored raw)';
COMMENT ON COLUMN analytics_sessions.is_bounce IS 'True if session had only one page view';
COMMENT ON COLUMN analytics_settings.respect_dnt IS 'When true, visitors with Do Not Track header are not tracked';
COMMENT ON COLUMN analytics_settings.alert_threshold_multiplier IS 'Alert when current traffic exceeds baseline by this multiplier';
