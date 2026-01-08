-- Fix mcp_test_history RLS - currently has RLS disabled
-- This table contains MCP test results and should be org-scoped

-- Enable RLS on the table
ALTER TABLE mcp_test_history ENABLE ROW LEVEL SECURITY;

-- Ensure FORCE RLS is enabled
ALTER TABLE mcp_test_history FORCE ROW LEVEL SECURITY;

-- Policy: Users can view test history for their org's MCPs
CREATE POLICY mcp_test_history_org_select ON mcp_test_history
    FOR SELECT
    USING (
        org_id IN (
            SELECT org_id FROM organization_members
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can insert test history for their org's MCPs
CREATE POLICY mcp_test_history_org_insert ON mcp_test_history
    FOR INSERT
    WITH CHECK (
        org_id IN (
            SELECT org_id FROM organization_members
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Only org admins can delete test history (cleanup)
CREATE POLICY mcp_test_history_admin_delete ON mcp_test_history
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.user_id = auth.uid()
            AND om.org_id = mcp_test_history.org_id
            AND om.role IN ('owner', 'admin')
        )
    );

-- Service role gets full access for background jobs
CREATE POLICY mcp_test_history_service_role ON mcp_test_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMENT ON POLICY mcp_test_history_org_select ON mcp_test_history IS
    'SOC 2 CC6.1: Users can view test history for their organizations MCPs';
COMMENT ON POLICY mcp_test_history_admin_delete ON mcp_test_history IS
    'SOC 2 CC6.1: Only org admins can delete test history';
