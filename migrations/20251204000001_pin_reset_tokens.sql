-- PIN reset tokens table for "forgot PIN" functionality
-- Tokens are hashed and stored separately from user_pins to maintain security

CREATE TABLE pin_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Reference to the user (not enforced with FK to allow flexibility with auth providers)
    CONSTRAINT pin_reset_tokens_user_id_check CHECK (user_id IS NOT NULL)
);

-- Index for efficient token lookups
CREATE INDEX idx_pin_reset_tokens_user ON pin_reset_tokens(user_id);
CREATE INDEX idx_pin_reset_tokens_created ON pin_reset_tokens(created_at);

-- Clean up old/expired tokens automatically (tokens older than 24 hours)
-- This can be done via a scheduled job or on-demand cleanup
COMMENT ON TABLE pin_reset_tokens IS 'Stores hashed PIN reset tokens for forgot PIN functionality. Tokens expire after 1 hour.';
