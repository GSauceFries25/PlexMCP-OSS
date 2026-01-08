-- Add email column to user_2fa_login_tokens for OAuth users
-- who may not exist in the users table

ALTER TABLE user_2fa_login_tokens
ADD COLUMN IF NOT EXISTS email TEXT;

-- Update existing rows (if any) - set email to NULL as we can't recover it
-- This is fine because these tokens are short-lived (5 min) anyway
