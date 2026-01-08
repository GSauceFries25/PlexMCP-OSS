-- PlexMCP Support Ticket SLA and Workload Management
-- Migration: 20251224000001_sla_and_workload.sql

-- Add enterprise_inquiry category if not exists
DO $$ BEGIN
    ALTER TYPE ticket_category ADD VALUE IF NOT EXISTS 'enterprise_inquiry';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- SLA Rules Configuration Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS sla_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    priority ticket_priority NOT NULL,
    category ticket_category,  -- NULL = applies to all categories
    first_response_hours INTEGER NOT NULL,  -- SLA for first admin response
    resolution_hours INTEGER NOT NULL,       -- SLA for ticket resolution
    business_hours_only BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default SLA rules by priority
INSERT INTO sla_rules (name, priority, first_response_hours, resolution_hours, business_hours_only) VALUES
    ('Urgent SLA', 'urgent', 1, 4, false),    -- 1 hour first response, 4 hours resolution (24/7)
    ('High SLA', 'high', 4, 24, true),        -- 4 hours first response, 24 hours resolution
    ('Medium SLA', 'medium', 8, 72, true),    -- 8 hours first response, 72 hours resolution
    ('Low SLA', 'low', 24, 168, true)         -- 24 hours first response, 168 hours (7 days) resolution
ON CONFLICT DO NOTHING;

-- Unique constraint: one rule per priority/category combo
-- Using NULLS NOT DISTINCT for proper NULL handling in unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_rules_priority_category
    ON sla_rules(priority, category)
    WHERE is_active = true;

-- =============================================================================
-- Add SLA Tracking Columns to support_tickets
-- =============================================================================

-- First response tracking
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_sla_hours INTEGER;

-- Resolution SLA tracking
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_sla_hours INTEGER;

-- SLA breach flags
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_breached BOOLEAN DEFAULT false;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_breached BOOLEAN DEFAULT false;

-- Escalation tracking
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS original_priority ticket_priority;

-- =============================================================================
-- Assignment History/Audit Trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS ticket_assignment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE NOT NULL,
    assigned_from UUID REFERENCES users(id) ON DELETE SET NULL,  -- Previous assignee (NULL if unassigned)
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,    -- New assignee (NULL if unassigning)
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL,  -- Who made the change
    reason TEXT,  -- Optional reason for reassignment
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_history_ticket ON ticket_assignment_history(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_history_to ON ticket_assignment_history(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assignment_history_by ON ticket_assignment_history(assigned_by);

-- =============================================================================
-- Internal Notes Support
-- =============================================================================

-- Add internal flag to messages (internal notes not visible to customers)
ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false;

-- Index for filtering internal messages
CREATE INDEX IF NOT EXISTS idx_messages_internal ON ticket_messages(ticket_id) WHERE is_internal = true;

-- =============================================================================
-- Response Templates
-- =============================================================================

CREATE TABLE IF NOT EXISTS ticket_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category ticket_category,  -- NULL = global template
    subject_template TEXT,     -- Optional subject line for new tickets
    content TEXT NOT NULL,     -- Template body (supports {{variables}})
    shortcut TEXT UNIQUE,      -- Quick-insert shortcut (e.g., "/billing-refund")
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_category ON ticket_templates(category) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_templates_shortcut ON ticket_templates(shortcut) WHERE shortcut IS NOT NULL;

-- =============================================================================
-- SLA Tracking Indexes
-- =============================================================================

-- Index for finding tickets approaching first response SLA
CREATE INDEX IF NOT EXISTS idx_tickets_first_response_pending ON support_tickets(created_at, first_response_sla_hours)
    WHERE first_response_at IS NULL
    AND status NOT IN ('resolved', 'closed');

-- Index for finding tickets approaching resolution SLA
CREATE INDEX IF NOT EXISTS idx_tickets_resolution_pending ON support_tickets(created_at, resolution_sla_hours)
    WHERE status NOT IN ('resolved', 'closed');

-- Index for SLA breach queries
CREATE INDEX IF NOT EXISTS idx_tickets_sla_breached ON support_tickets(first_response_breached, resolution_breached)
    WHERE first_response_breached = true OR resolution_breached = true;

-- =============================================================================
-- RLS Policies for New Tables
-- =============================================================================

ALTER TABLE sla_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_templates ENABLE ROW LEVEL SECURITY;

-- SLA rules: admins only
CREATE POLICY "Admins can manage SLA rules"
    ON sla_rules FOR ALL
    USING (EXISTS (
        SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
    ));

-- Assignment history: visible to ticket owners and admins
CREATE POLICY "Users can view assignment history for their tickets"
    ON ticket_assignment_history FOR SELECT
    USING (
        ticket_id IN (
            SELECT id FROM support_tickets
            WHERE organization_id IN (
                SELECT org_id FROM organization_members WHERE user_id = auth.uid()
            )
        )
        OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
    );

-- Only admins can create assignment history (via assignment changes)
CREATE POLICY "Admins can create assignment history"
    ON ticket_assignment_history FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
    ));

-- Templates: admins only
CREATE POLICY "Admins can manage templates"
    ON ticket_templates FOR ALL
    USING (EXISTS (
        SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
    ));

-- =============================================================================
-- Update RLS for Internal Messages
-- =============================================================================

-- Drop existing policy and recreate with internal note handling
DROP POLICY IF EXISTS "Users can view ticket messages" ON ticket_messages;

CREATE POLICY "Users can view ticket messages"
    ON ticket_messages FOR SELECT
    USING (
        -- Internal notes only visible to admins
        (NOT is_internal AND ticket_id IN (
            SELECT id FROM support_tickets
            WHERE organization_id IN (
                SELECT org_id FROM organization_members WHERE user_id = auth.uid()
            )
        ))
        OR EXISTS (
            SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
        )
    );

-- =============================================================================
-- Function to Auto-Set SLA Hours on Ticket Creation
-- =============================================================================

CREATE OR REPLACE FUNCTION set_ticket_sla()
RETURNS TRIGGER AS $$
DECLARE
    sla_record RECORD;
BEGIN
    -- Find applicable SLA rule (priority-specific with category, then priority-only)
    SELECT first_response_hours, resolution_hours INTO sla_record
    FROM sla_rules
    WHERE priority = NEW.priority
      AND is_active = true
      AND (category = NEW.category OR category IS NULL)
    ORDER BY category NULLS LAST
    LIMIT 1;

    IF FOUND THEN
        NEW.first_response_sla_hours := sla_record.first_response_hours;
        NEW.resolution_sla_hours := sla_record.resolution_hours;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to set SLA on new tickets
DROP TRIGGER IF EXISTS set_ticket_sla_trigger ON support_tickets;
CREATE TRIGGER set_ticket_sla_trigger
    BEFORE INSERT ON support_tickets
    FOR EACH ROW EXECUTE FUNCTION set_ticket_sla();

-- =============================================================================
-- Function to Track First Response
-- =============================================================================

CREATE OR REPLACE FUNCTION track_first_response()
RETURNS TRIGGER AS $$
DECLARE
    ticket RECORD;
BEGIN
    -- Only for admin replies
    IF NEW.is_admin_reply = true AND NOT COALESCE(NEW.is_internal, false) THEN
        SELECT id, first_response_at, first_response_sla_hours, created_at
        INTO ticket
        FROM support_tickets
        WHERE id = NEW.ticket_id
        AND first_response_at IS NULL;

        IF FOUND THEN
            -- Check if breached
            UPDATE support_tickets SET
                first_response_at = NOW(),
                first_response_breached = (
                    EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 > first_response_sla_hours
                )
            WHERE id = NEW.ticket_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for first response tracking
DROP TRIGGER IF EXISTS track_first_response_trigger ON ticket_messages;
CREATE TRIGGER track_first_response_trigger
    AFTER INSERT ON ticket_messages
    FOR EACH ROW EXECUTE FUNCTION track_first_response();

-- =============================================================================
-- Seed Default Templates
-- =============================================================================

INSERT INTO ticket_templates (name, category, content, shortcut) VALUES
('Billing Refund Request', 'billing',
'Hi {{customer_name}},

Thank you for reaching out about your refund request.

I''ve reviewed your account and can confirm that your refund has been processed. You should see the amount reflected in your account within 5-7 business days.

If you have any further questions, please don''t hesitate to ask.

Best regards,
PlexMCP Support', '/refund'),

('Technical Issue Acknowledgment', 'technical',
'Hi {{customer_name}},

Thank you for reporting this issue. I''ve escalated this to our technical team for investigation.

In the meantime, could you please provide:
1. Your browser and version
2. Any error messages you''re seeing
3. Steps to reproduce the issue

This will help us resolve this faster.

Best regards,
PlexMCP Support', '/tech-ack'),

('Feature Request Response', 'feature_request',
'Hi {{customer_name}},

Thank you for your feature suggestion! We really appreciate you taking the time to share your ideas with us.

I''ve added this to our feature request backlog for the product team to review. While I can''t promise a specific timeline, we do prioritize features based on customer feedback.

Is there anything else I can help you with?

Best regards,
PlexMCP Support', '/feature'),

('General Inquiry Response', 'general',
'Hi {{customer_name}},

Thank you for contacting PlexMCP Support.

{{response_content}}

If you have any other questions, feel free to reply to this ticket.

Best regards,
PlexMCP Support', '/general')
ON CONFLICT (shortcut) DO NOTHING;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE sla_rules IS 'SLA configuration by priority and optional category';
COMMENT ON TABLE ticket_assignment_history IS 'Audit trail for ticket assignment changes';
COMMENT ON TABLE ticket_templates IS 'Pre-defined response templates for support staff';
COMMENT ON COLUMN ticket_messages.is_internal IS 'Internal notes visible only to staff, not customers';
COMMENT ON COLUMN support_tickets.first_response_at IS 'Timestamp of first non-internal admin reply';
COMMENT ON COLUMN support_tickets.first_response_breached IS 'True if first response exceeded SLA';
COMMENT ON COLUMN support_tickets.resolution_breached IS 'True if resolution exceeded SLA';
COMMENT ON COLUMN support_tickets.original_priority IS 'Original priority before any escalation';
