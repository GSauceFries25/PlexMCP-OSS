-- PlexMCP Support Ticket System
-- Migration: 20251205000003_support_tickets.sql

-- Add is_admin column to users table (needed for admin-level RLS policies)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Support ticket categories
CREATE TYPE ticket_category AS ENUM (
  'general',
  'billing',
  'technical',
  'feature_request',
  'bug_report'
);

-- Ticket status
CREATE TYPE ticket_status AS ENUM (
  'open',
  'in_progress',
  'awaiting_response',
  'resolved',
  'closed'
);

-- Ticket priority
CREATE TYPE ticket_priority AS ENUM (
  'low',
  'medium',
  'high',
  'urgent'
);

-- Main tickets table
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  category ticket_category NOT NULL DEFAULT 'general',
  status ticket_status NOT NULL DEFAULT 'open',
  priority ticket_priority NOT NULL DEFAULT 'medium',
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

-- Ticket messages (conversation thread)
CREATE TABLE ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_admin_reply BOOLEAN NOT NULL DEFAULT FALSE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FAQ articles
CREATE TABLE faq_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  search_keywords TEXT[],
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  not_helpful_count INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ticket number sequence
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1;

-- Function to generate ticket number
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.ticket_number := 'PLX-' || LPAD(nextval('ticket_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_ticket_number
  BEFORE INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION generate_ticket_number();

-- Update timestamp trigger for tickets
CREATE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update timestamp trigger for FAQs
CREATE TRIGGER update_faq_articles_updated_at
  BEFORE UPDATE ON faq_articles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX idx_tickets_org ON support_tickets(organization_id);
CREATE INDEX idx_tickets_user ON support_tickets(user_id);
CREATE INDEX idx_tickets_status ON support_tickets(status);
CREATE INDEX idx_tickets_priority ON support_tickets(priority);
CREATE INDEX idx_tickets_category ON support_tickets(category);
CREATE INDEX idx_tickets_created ON support_tickets(created_at DESC);
CREATE INDEX idx_tickets_assigned ON support_tickets(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX idx_ticket_messages_created ON ticket_messages(created_at);
CREATE INDEX idx_faq_category ON faq_articles(category);
CREATE INDEX idx_faq_published ON faq_articles(is_published) WHERE is_published = true;
CREATE INDEX idx_faq_search ON faq_articles USING GIN(search_keywords);

-- RLS policies
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq_articles ENABLE ROW LEVEL SECURITY;

-- Users can see their org's tickets
-- Note: organization_members uses 'org_id' not 'organization_id'
CREATE POLICY "Users can view own org tickets"
  ON support_tickets FOR SELECT
  USING (
    organization_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Users can create tickets for their org
CREATE POLICY "Users can create tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- Users can update their own tickets (close them), admins can update any
CREATE POLICY "Users can update own tickets"
  ON support_tickets FOR UPDATE
  USING (
    (user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Messages policy: Users can see messages on their tickets
CREATE POLICY "Users can view ticket messages"
  ON ticket_messages FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE organization_id IN (
        SELECT org_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Users can create messages on their tickets
CREATE POLICY "Users can create ticket messages"
  ON ticket_messages FOR INSERT
  WITH CHECK (
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE organization_id IN (
        SELECT org_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
    )
  );

-- FAQ is public for reading (published only)
CREATE POLICY "Anyone can read published FAQs"
  ON faq_articles FOR SELECT
  USING (is_published = true);

-- Only admins can manage FAQs
CREATE POLICY "Admins can manage FAQs"
  ON faq_articles FOR ALL
  USING (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
  ));

-- Seed initial FAQ content
INSERT INTO faq_articles (title, content, category, search_keywords, display_order) VALUES
-- Getting Started
('How do I create my first MCP?',
'To create your first MCP:
1. Go to the MCPs page in your dashboard
2. Click "Add MCP"
3. Enter your MCP server URL (e.g., http://localhost:3000/mcp)
4. Give it a name and optional description
5. Click "Create"

Your MCP will be automatically tested to ensure it''s reachable.',
'getting-started',
ARRAY['create', 'first', 'mcp', 'add', 'new', 'start', 'begin'],
1),

('How do I connect an AI client?',
'To connect an AI client (Claude Desktop, Cursor, etc.):
1. Go to the Connections page
2. Select your AI client type
3. Choose which MCPs to include
4. Generate the configuration
5. Copy the config to your client settings file

Each client has specific instructions shown during the generation process.',
'getting-started',
ARRAY['connect', 'client', 'claude', 'cursor', 'ai', 'config', 'configuration'],
2),

('What is an API key and why do I need one?',
'API keys authenticate your AI clients with PlexMCP. Each key:
- Has a unique prefix for identification
- Can have specific scopes (read, write, admin)
- Can be rotated or revoked anytime
- Shows last usage time for security

Create API keys in the API Keys page and keep them secure.',
'getting-started',
ARRAY['api', 'key', 'authentication', 'auth', 'security', 'token'],
3),

-- Billing
('How does billing work?',
'PlexMCP offers several plans:
- **Free**: 5 MCPs, 1,000 calls/month
- **Pro** ($29/mo): 10 MCPs, 50,000 calls/month
- **Team** ($99/mo): 25 MCPs, 200,000 calls/month
- **Enterprise**: Custom limits

Paid plans include overage billing at per-1000-call rates when you exceed limits.',
'billing',
ARRAY['billing', 'payment', 'subscription', 'plan', 'price', 'cost', 'charge'],
1),

('How do I upgrade or downgrade my plan?',
'To change your plan:
1. Go to the Billing page
2. Click "Change Plan" or scroll to plan selector
3. Choose your new plan
4. Complete checkout via Stripe

Upgrades take effect immediately. Downgrades apply at the next billing cycle.',
'billing',
ARRAY['upgrade', 'downgrade', 'change', 'plan', 'switch'],
2),

('What happens if I exceed my limits?',
'When you exceed your plan limits:
- **Free plan**: Requests are blocked until reset
- **Paid plans**: Overage charges apply ($0.50/1k calls for Pro, $0.25/1k for Team)

You can monitor usage in the Usage page and set up alerts in Settings.',
'billing',
ARRAY['exceed', 'limit', 'overage', 'blocked', 'throttle', 'over'],
3),

('How do I cancel my subscription?',
'To cancel your subscription:
1. Go to the Billing page
2. Find "Subscription Management" section
3. Click "Cancel Subscription"
4. Your access continues until the end of your billing period

You can resubscribe anytime from the same page.',
'billing',
ARRAY['cancel', 'subscription', 'stop', 'end', 'terminate'],
4),

-- Technical
('Why is my MCP showing as unhealthy?',
'An unhealthy MCP status usually means:
1. **Connection refused**: MCP server is not running
2. **Timeout**: Server is slow or unreachable
3. **Authentication failed**: Invalid credentials
4. **SSL error**: Certificate issues

Check the Testing page for detailed error messages and run a manual health check.',
'technical',
ARRAY['unhealthy', 'error', 'connection', 'failed', 'timeout', 'ssl', 'health'],
1),

('How do I troubleshoot connection issues?',
'Common connection troubleshooting steps:
1. Verify your MCP server is running
2. Check the server URL is correct (include protocol)
3. Ensure firewall allows the connection
4. Test the endpoint directly with curl
5. Check server logs for errors

Use the Testing page for automated diagnostics.',
'technical',
ARRAY['troubleshoot', 'connection', 'debug', 'fix', 'issue', 'problem'],
2),

('What MCP protocol version is supported?',
'PlexMCP supports MCP protocol version 2024-11-05 and later. Key features:
- JSON-RPC 2.0 transport
- SSE (Server-Sent Events) for streaming
- Tool calls and resources
- Prompt templates

Check your MCP server''s protocol version in the Testing page.',
'technical',
ARRAY['protocol', 'version', 'mcp', 'specification', 'spec', 'json-rpc'],
3),

-- Troubleshooting
('My AI client can''t connect to PlexMCP',
'If your AI client can''t connect:
1. Verify the API key is correct and not revoked
2. Check the server URL matches your client config
3. Ensure the client type in config matches your tool
4. Try regenerating the configuration
5. Restart your AI client after config changes

Test your connection in the Testing page first.',
'troubleshooting',
ARRAY['client', 'connect', 'fail', 'cannot', 'error', 'claude', 'cursor'],
1),

('Requests are being rejected or rate limited',
'Request rejections can happen due to:
1. **Plan limit reached**: Check Usage page
2. **Invalid API key**: Verify in API Keys page
3. **MCP offline**: Check Testing page
4. **Rate limiting**: Wait and retry

Check the Usage page for request details and error breakdown.',
'troubleshooting',
ARRAY['reject', 'rate', 'limit', 'throttle', 'block', 'denied', '429'],
2),

('How do I report a bug?',
'To report a bug:
1. Go to Help & Support
2. Click "Submit a Ticket"
3. Select "Bug Report" category
4. Include:
   - What you expected to happen
   - What actually happened
   - Steps to reproduce
   - Browser/client version

We''ll respond within 24 hours.',
'troubleshooting',
ARRAY['bug', 'report', 'issue', 'problem', 'error', 'wrong', 'broken'],
3);
