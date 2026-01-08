-- Fix missing UNIQUE constraint on user_2fa_login_tokens.user_id
-- This is needed for ON CONFLICT (user_id) to work in upsert operations

-- Note: This table might not exist yet if migrations run in order
-- It will be created in a later migration (20251208000001_user_2fa.sql)
-- So we make this conditional

DO $$
BEGIN
    -- Only run if the table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_2fa_login_tokens') THEN
        -- First, clean up any duplicate rows for the same user (keep only the most recent)
        DELETE FROM user_2fa_login_tokens a
        USING user_2fa_login_tokens b
        WHERE a.user_id = b.user_id
          AND a.created_at < b.created_at;

        -- Now add the unique constraint if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'user_2fa_login_tokens_user_id_unique'
        ) THEN
            ALTER TABLE user_2fa_login_tokens
            ADD CONSTRAINT user_2fa_login_tokens_user_id_unique UNIQUE (user_id);
        END IF;
    END IF;
END $$;
