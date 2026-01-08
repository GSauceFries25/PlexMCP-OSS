-- Fix: Remove foreign key constraint on tested_by column
-- The tested_by references users(id), but users logging in via Supabase Auth
-- don't always exist in the public.users table, causing FK violations.
-- The constraint was dropped manually, but this migration ensures it stays gone.

-- Drop the constraint if it exists (idempotent)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'mcp_test_history_tested_by_fkey'
        AND table_name = 'mcp_test_history'
    ) THEN
        ALTER TABLE mcp_test_history DROP CONSTRAINT mcp_test_history_tested_by_fkey;
    END IF;
END $$;

-- Note: The tested_by column is kept as UUID but without the FK constraint.
-- This allows storing the auth.uid() without requiring a matching row in public.users.
