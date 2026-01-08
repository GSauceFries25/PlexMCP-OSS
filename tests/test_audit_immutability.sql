-- =============================================================================
-- SOC 2 Audit Log Immutability Tests
-- =============================================================================
-- This test verifies that audit logs cannot be modified or deleted,
-- ensuring compliance with SOC 2 requirements for tamper-proof audit trails.

BEGIN;

-- =============================================================================
-- Test Setup: Use existing audit log data or create minimal test data
-- =============================================================================

-- Test will use existing audit log entries. If none exist, we'll create minimal test entries.
-- We'll avoid FK constraints by using NULL for user_id where allowed.

-- Get an existing user ID for testing
DO $$
DECLARE
    existing_user_id UUID;
BEGIN
    SELECT id INTO existing_user_id FROM users LIMIT 1;

    IF existing_user_id IS NULL THEN
        RAISE EXCEPTION 'No users found in database. Cannot run audit immutability tests.';
    END IF;

    -- Insert test admin audit log entry using existing user
    INSERT INTO admin_audit_log (
        admin_user_id,
        action,
        target_type,
        details,
        event_type,
        severity,
        created_at
    ) VALUES (
        existing_user_id,
        'IMMUTABILITY_TEST_ACTION',
        'test',
        '{"test": "immutability"}'::jsonb,
        'admin_action',
        'info',
        NOW()
    );

    RAISE NOTICE 'Using existing user ID for tests: %', existing_user_id;
END $$;

-- Insert minimal test auth audit log entry
INSERT INTO auth_audit_log (
    email,
    event_type,
    severity,
    created_at
) VALUES (
    'immutability-test@plexmcp.com',
    'login_success',  -- Must match CHECK constraint
    'info',
    NOW()
);

DO $$
DECLARE
    test_admin_log_id UUID;
    test_auth_log_id UUID;
BEGIN
    -- Get admin log ID
    SELECT id INTO test_admin_log_id
    FROM admin_audit_log
    WHERE action = 'IMMUTABILITY_TEST_ACTION'
    ORDER BY created_at DESC
    LIMIT 1;

    RAISE NOTICE 'Test admin_audit_log entry created with ID: %', test_admin_log_id;

    -- Get auth log ID
    SELECT id INTO test_auth_log_id
    FROM auth_audit_log
    WHERE email = 'immutability-test@plexmcp.com'
    ORDER BY created_at DESC
    LIMIT 1;

    RAISE NOTICE 'Test auth_audit_log entry created with ID: %', test_auth_log_id;
END $$;

-- =============================================================================
-- Test 1: Verify admin_audit_log UPDATE is prevented
-- =============================================================================

DO $$
DECLARE
    test_log_id UUID;
    update_succeeded BOOLEAN := false;
BEGIN
    SELECT id INTO test_log_id
    FROM admin_audit_log
    WHERE action = 'IMMUTABILITY_TEST_ACTION'
    ORDER BY created_at DESC
    LIMIT 1;

    BEGIN
        UPDATE admin_audit_log
        SET action = 'modified_action'
        WHERE id = test_log_id;

        update_succeeded := true;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'Test 1 PASSED: admin_audit_log UPDATE prevented - %', SQLERRM;
    END;

    IF update_succeeded THEN
        RAISE EXCEPTION 'Test 1 FAILED: admin_audit_log UPDATE was not prevented!';
    END IF;
END $$;

-- =============================================================================
-- Test 2: Verify admin_audit_log DELETE is prevented
-- =============================================================================

DO $$
DECLARE
    test_log_id UUID;
    delete_succeeded BOOLEAN := false;
BEGIN
    SELECT id INTO test_log_id
    FROM admin_audit_log
    WHERE action = 'IMMUTABILITY_TEST_ACTION'
    ORDER BY created_at DESC
    LIMIT 1;

    BEGIN
        DELETE FROM admin_audit_log WHERE id = test_log_id;
        delete_succeeded := true;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'Test 2 PASSED: admin_audit_log DELETE prevented - %', SQLERRM;
    END;

    IF delete_succeeded THEN
        RAISE EXCEPTION 'Test 2 FAILED: admin_audit_log DELETE was not prevented!';
    END IF;
END $$;

-- =============================================================================
-- Test 3: Verify auth_audit_log UPDATE is prevented
-- =============================================================================

DO $$
DECLARE
    test_log_id UUID;
    update_succeeded BOOLEAN := false;
BEGIN
    SELECT id INTO test_log_id
    FROM auth_audit_log
    WHERE email = 'immutability-test@plexmcp.com'
    ORDER BY created_at DESC
    LIMIT 1;

    BEGIN
        UPDATE auth_audit_log
        SET event_type = 'logout'
        WHERE id = test_log_id;

        update_succeeded := true;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'Test 3 PASSED: auth_audit_log UPDATE prevented - %', SQLERRM;
    END;

    IF update_succeeded THEN
        RAISE EXCEPTION 'Test 3 FAILED: auth_audit_log UPDATE was not prevented!';
    END IF;
END $$;

-- =============================================================================
-- Test 4: Verify auth_audit_log DELETE is prevented
-- =============================================================================

DO $$
DECLARE
    test_log_id UUID;
    delete_succeeded BOOLEAN := false;
BEGIN
    SELECT id INTO test_log_id
    FROM auth_audit_log
    WHERE email = 'immutability-test@plexmcp.com'
    ORDER BY created_at DESC
    LIMIT 1;

    BEGIN
        DELETE FROM auth_audit_log WHERE id = test_log_id;
        delete_succeeded := true;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'Test 4 PASSED: auth_audit_log DELETE prevented - %', SQLERRM;
    END;

    IF delete_succeeded THEN
        RAISE EXCEPTION 'Test 4 FAILED: auth_audit_log DELETE was not prevented!';
    END IF;
END $$;

-- =============================================================================
-- Test 5: Verify hash chain is maintained on INSERT
-- =============================================================================

DO $$
DECLARE
    prev_hash TEXT;
    new_hash TEXT;
    new_prev_hash TEXT;
    prev_seq BIGINT;
    new_seq BIGINT;
    existing_user_id UUID;
BEGIN
    -- Get an existing user for FK constraint
    SELECT id INTO existing_user_id FROM users LIMIT 1;

    -- Get the last entry's hash and sequence
    SELECT entry_hash, sequence_number INTO prev_hash, prev_seq
    FROM admin_audit_log
    ORDER BY sequence_number DESC
    LIMIT 1;

    -- Insert new entry (hash chain should auto-populate)
    INSERT INTO admin_audit_log (
        admin_user_id,
        action,
        target_type,
        event_type,
        severity,
        created_at
    ) VALUES (
        existing_user_id,
        'hash_chain_test',
        'test',
        'admin_action',
        'info',
        NOW()
    );

    -- Get the new entry's hash and sequence
    SELECT entry_hash, previous_hash, sequence_number
    INTO new_hash, new_prev_hash, new_seq
    FROM admin_audit_log
    WHERE action = 'hash_chain_test'
    ORDER BY created_at DESC
    LIMIT 1;

    -- Verify hash chain linkage
    IF new_prev_hash IS DISTINCT FROM prev_hash THEN
        RAISE EXCEPTION 'Test 5 FAILED: Hash chain broken - previous_hash mismatch. Expected: %, Got: %',
            prev_hash, new_prev_hash;
    END IF;

    -- Verify sequence is monotonically increasing
    IF new_seq <= prev_seq THEN
        RAISE EXCEPTION 'Test 5 FAILED: Sequence not increasing. Previous: %, New: %',
            prev_seq, new_seq;
    END IF;

    -- Verify entry hash was generated
    IF new_hash IS NULL OR new_hash = '' THEN
        RAISE EXCEPTION 'Test 5 FAILED: Entry hash not generated';
    END IF;

    RAISE NOTICE 'Test 5 PASSED: Hash chain maintained correctly';
    RAISE NOTICE '  Previous hash: %', prev_hash;
    RAISE NOTICE '  New previous_hash: %', new_prev_hash;
    RAISE NOTICE '  New entry_hash: %', new_hash;
    RAISE NOTICE '  Sequence: % -> %', prev_seq, new_seq;
END $$;

-- =============================================================================
-- Test 6: Verify auth_audit_log hash chain
-- =============================================================================

DO $$
DECLARE
    prev_hash TEXT;
    new_hash TEXT;
    new_prev_hash TEXT;
    prev_seq BIGINT;
    new_seq BIGINT;
BEGIN
    -- Get the last entry's hash and sequence
    SELECT entry_hash, sequence_number INTO prev_hash, prev_seq
    FROM auth_audit_log
    ORDER BY sequence_number DESC
    LIMIT 1;

    -- Insert new entry
    INSERT INTO auth_audit_log (
        email,
        event_type,
        severity,
        created_at
    ) VALUES (
        'hash-chain-test@plexmcp.com',
        'login_success',
        'info',
        NOW()
    );

    -- Get the new entry's hash and sequence
    SELECT entry_hash, previous_hash, sequence_number
    INTO new_hash, new_prev_hash, new_seq
    FROM auth_audit_log
    WHERE email = 'hash-chain-test@plexmcp.com'
    ORDER BY created_at DESC
    LIMIT 1;

    -- Verify hash chain linkage
    IF new_prev_hash IS DISTINCT FROM prev_hash THEN
        RAISE EXCEPTION 'Test 6 FAILED: Hash chain broken - previous_hash mismatch';
    END IF;

    -- Verify sequence is monotonically increasing
    IF new_seq <= prev_seq THEN
        RAISE EXCEPTION 'Test 6 FAILED: Sequence not increasing';
    END IF;

    -- Verify entry hash was generated
    IF new_hash IS NULL OR new_hash = '' THEN
        RAISE EXCEPTION 'Test 6 FAILED: Entry hash not generated';
    END IF;

    RAISE NOTICE 'Test 6 PASSED: Auth audit hash chain maintained correctly';
END $$;

-- =============================================================================
-- Test Summary
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE '=============================================================================';
    RAISE NOTICE 'SOC 2 Audit Immutability Test Suite - ALL TESTS PASSED';
    RAISE NOTICE '=============================================================================';
    RAISE NOTICE 'Test 1: admin_audit_log UPDATE prevention - PASSED';
    RAISE NOTICE 'Test 2: admin_audit_log DELETE prevention - PASSED';
    RAISE NOTICE 'Test 3: auth_audit_log UPDATE prevention - PASSED';
    RAISE NOTICE 'Test 4: auth_audit_log DELETE prevention - PASSED';
    RAISE NOTICE 'Test 5: admin_audit_log hash chain integrity - PASSED';
    RAISE NOTICE 'Test 6: auth_audit_log hash chain integrity - PASSED';
    RAISE NOTICE '=============================================================================';
END $$;

ROLLBACK;
