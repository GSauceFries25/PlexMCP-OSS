-- Force Row Level Security on all sensitive tables
-- This ensures RLS policies are enforced even for table owners
-- CRITICAL SECURITY FIX: Without FORCE, table owners bypass RLS

-- Core organization tables
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_instances FORCE ROW LEVEL SECURITY;

-- Billing tables
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE subscription_addons FORCE ROW LEVEL SECURITY;

-- Usage tracking tables
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_aggregates FORCE ROW LEVEL SECURITY;

-- Session and audit tables
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Team management tables
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

-- PIN protection tables
ALTER TABLE user_pins FORCE ROW LEVEL SECURITY;
ALTER TABLE pin_reset_tokens FORCE ROW LEVEL SECURITY;

-- MCP related tables
ALTER TABLE mcp_test_history FORCE ROW LEVEL SECURITY;

-- Webhook handling
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;

-- Add comment explaining why FORCE is needed
COMMENT ON TABLE organizations IS 'Multi-tenant organizations. RLS FORCE enabled to ensure all queries respect tenant isolation.';
