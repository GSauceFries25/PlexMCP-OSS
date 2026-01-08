-- Real-Time Support Features Migration
-- Adds WebSocket support for presence tracking, typing indicators, and ticket viewers
-- Date: 2025-12-25

-- ============================================================================
-- User Presence Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  online_status TEXT NOT NULL CHECK (online_status IN ('online', 'away', 'offline')),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device_info JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presence_online ON user_presence(online_status)
  WHERE online_status IN ('online', 'away');

CREATE INDEX IF NOT EXISTS idx_presence_activity ON user_presence(last_activity_at DESC);

COMMENT ON TABLE user_presence IS 'Tracks online/offline/away status for all platform users';
COMMENT ON COLUMN user_presence.online_status IS 'Current presence status: online, away, or offline';
COMMENT ON COLUMN user_presence.last_activity_at IS 'Last user activity timestamp (updated on any action)';
COMMENT ON COLUMN user_presence.last_seen_at IS 'Last time user was seen (for "last seen X ago" display)';
COMMENT ON COLUMN user_presence.device_info IS 'Optional device metadata (browser, OS, etc.)';

-- ============================================================================
-- Ticket Viewer Tracking (Who's viewing which tickets)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_viewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_viewing_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ping_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_viewers_ticket ON ticket_viewers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_viewers_user ON ticket_viewers(user_id);
-- Index for finding stale viewers (cleanup query uses runtime NOW(), not index predicate)
CREATE INDEX IF NOT EXISTS idx_viewers_stale ON ticket_viewers(last_ping_at);

COMMENT ON TABLE ticket_viewers IS 'Tracks which users are currently viewing specific tickets';
COMMENT ON COLUMN ticket_viewers.last_ping_at IS 'Updated periodically to indicate viewer is still active';
COMMENT ON INDEX idx_viewers_stale IS 'Identifies stale viewers for cleanup (no ping in 2+ minutes)';

-- ============================================================================
-- Typing Indicators (Who's typing in which tickets)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_typing_indicators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_typing_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_update_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_typing_ticket ON ticket_typing_indicators(ticket_id);
CREATE INDEX IF NOT EXISTS idx_typing_user ON ticket_typing_indicators(user_id);
-- Index for finding stale typing indicators (cleanup query uses runtime NOW(), not index predicate)
CREATE INDEX IF NOT EXISTS idx_typing_stale ON ticket_typing_indicators(last_update_at);

COMMENT ON TABLE ticket_typing_indicators IS 'Tracks which users are currently typing in tickets';
COMMENT ON COLUMN ticket_typing_indicators.last_update_at IS 'Updated when user continues typing';
COMMENT ON INDEX idx_typing_stale IS 'Identifies stale typing indicators for cleanup (no update in 5+ seconds)';

-- ============================================================================
-- Row Level Security Policies
-- ============================================================================

ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_typing_indicators ENABLE ROW LEVEL SECURITY;

-- User Presence Policies

DROP POLICY IF EXISTS "Anyone can view presence" ON user_presence;
CREATE POLICY "Anyone can view presence"
  ON user_presence FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can update own presence" ON user_presence;
CREATE POLICY "Users can update own presence"
  ON user_presence FOR ALL
  USING (user_id = auth.uid());

-- Ticket Viewers Policies

DROP POLICY IF EXISTS "Users can view ticket viewers" ON ticket_viewers;
CREATE POLICY "Users can view ticket viewers"
  ON ticket_viewers FOR SELECT
  USING (
    -- Users can see viewers of tickets they have access to
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE organization_id IN (
        SELECT org_id FROM users WHERE id = auth.uid()
      )
    )
    -- Or if user is a platform admin
    OR EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND platform_role IN ('admin', 'superadmin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Users can add self as viewer" ON ticket_viewers;
CREATE POLICY "Users can add self as viewer"
  ON ticket_viewers FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own viewer record" ON ticket_viewers;
CREATE POLICY "Users can update own viewer record"
  ON ticket_viewers FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can remove self as viewer" ON ticket_viewers;
CREATE POLICY "Users can remove self as viewer"
  ON ticket_viewers FOR DELETE
  USING (user_id = auth.uid());

-- Typing Indicators Policies

DROP POLICY IF EXISTS "Users can view typing indicators" ON ticket_typing_indicators;
CREATE POLICY "Users can view typing indicators"
  ON ticket_typing_indicators FOR SELECT
  USING (
    -- Users can see typing indicators in tickets they have access to
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE organization_id IN (
        SELECT org_id FROM users WHERE id = auth.uid()
      )
    )
    -- Or if user is a platform admin
    OR EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND platform_role IN ('admin', 'superadmin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Users can manage own typing indicators" ON ticket_typing_indicators;
CREATE POLICY "Users can manage own typing indicators"
  ON ticket_typing_indicators FOR ALL
  USING (user_id = auth.uid());

-- ============================================================================
-- Cleanup Functions (Run periodically via background worker or cron)
-- ============================================================================

-- Mark users offline if no activity in 5 minutes
CREATE OR REPLACE FUNCTION cleanup_stale_presence()
RETURNS void AS $$
BEGIN
  UPDATE user_presence
  SET
    online_status = 'offline',
    updated_at = NOW()
  WHERE
    online_status IN ('online', 'away')
    AND last_activity_at < NOW() - INTERVAL '5 minutes';

  RAISE NOTICE 'Cleaned up % stale presence records', FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_stale_presence IS 'Marks users offline if no activity in 5+ minutes. Run periodically.';

-- Remove stale ticket viewers (no ping in 2 minutes)
CREATE OR REPLACE FUNCTION cleanup_stale_viewers()
RETURNS void AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ticket_viewers
  WHERE last_ping_at < NOW() - INTERVAL '2 minutes';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Cleaned up % stale viewer records', deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_stale_viewers IS 'Removes viewers with no ping in 2+ minutes. Run periodically.';

-- Remove stale typing indicators (no update in 5 seconds)
CREATE OR REPLACE FUNCTION cleanup_stale_typing()
RETURNS void AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ticket_typing_indicators
  WHERE last_update_at < NOW() - INTERVAL '5 seconds';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Cleaned up % stale typing indicators', deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_stale_typing IS 'Removes typing indicators with no update in 5+ seconds. Run frequently.';

-- Combined cleanup function for convenience
CREATE OR REPLACE FUNCTION cleanup_realtime_data()
RETURNS void AS $$
BEGIN
  PERFORM cleanup_stale_presence();
  PERFORM cleanup_stale_viewers();
  PERFORM cleanup_stale_typing();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_realtime_data IS 'Runs all real-time data cleanup functions. Schedule via pg_cron or background worker.';

-- ============================================================================
-- Trigger for updated_at on user_presence
-- ============================================================================

DROP TRIGGER IF EXISTS update_user_presence_updated_at ON user_presence;
CREATE TRIGGER update_user_presence_updated_at
  BEFORE UPDATE ON user_presence
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Grant permissions to authenticated users
-- ============================================================================

-- Grant usage on sequences (if any future tables need them)
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ============================================================================
-- Verification Queries (for testing)
-- ============================================================================

-- Verify tables were created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_presence') AND
     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ticket_viewers') AND
     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ticket_typing_indicators')
  THEN
    RAISE NOTICE 'Real-time support tables created successfully';
  ELSE
    RAISE EXCEPTION 'Failed to create real-time support tables';
  END IF;
END $$;

-- Verify RLS is enabled
DO $$
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE relname = 'user_presence') AND
     (SELECT relrowsecurity FROM pg_class WHERE relname = 'ticket_viewers') AND
     (SELECT relrowsecurity FROM pg_class WHERE relname = 'ticket_typing_indicators')
  THEN
    RAISE NOTICE 'Row Level Security enabled on all real-time tables';
  ELSE
    RAISE EXCEPTION 'RLS not properly enabled';
  END IF;
END $$;
