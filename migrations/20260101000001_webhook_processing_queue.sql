-- Webhook Processing Queue
-- Purpose: Persist incoming webhooks before processing to prevent data loss
-- Replaces fire-and-forget pattern with reliable queue-based processing

CREATE TABLE IF NOT EXISTS webhook_processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_type TEXT NOT NULL, -- 'email.received', 'stripe.invoice.paid', etc.
    payload JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Index for finding pending webhooks to process (most common query)
CREATE INDEX idx_webhook_queue_pending ON webhook_processing_queue(created_at)
WHERE status = 'pending';

-- Index for finding failed webhooks that can be retried
CREATE INDEX idx_webhook_queue_retry ON webhook_processing_queue(last_attempt_at)
WHERE status = 'failed' AND attempts < max_attempts;

-- Index for cleanup queries (old completed/failed webhooks)
CREATE INDEX idx_webhook_queue_cleanup ON webhook_processing_queue(processed_at)
WHERE status IN ('completed', 'failed');

-- RLS: Webhooks are system-level, not user-scoped
ALTER TABLE webhook_processing_queue ENABLE ROW LEVEL SECURITY;

-- System can read/write all webhooks
CREATE POLICY webhook_queue_system_full_access ON webhook_processing_queue
    FOR ALL
    USING (true)
    WITH CHECK (true);

COMMENT ON TABLE webhook_processing_queue IS 'Persistent queue for webhook processing with retry logic';
COMMENT ON COLUMN webhook_processing_queue.webhook_type IS 'Type of webhook (e.g., email.received, stripe.invoice.paid)';
COMMENT ON COLUMN webhook_processing_queue.payload IS 'Full webhook payload as received from external service';
COMMENT ON COLUMN webhook_processing_queue.status IS 'Processing status: pending (not started), processing (in progress), completed (success), failed (permanent failure)';
COMMENT ON COLUMN webhook_processing_queue.attempts IS 'Number of processing attempts made';
COMMENT ON COLUMN webhook_processing_queue.max_attempts IS 'Maximum attempts before marking as permanently failed';
COMMENT ON COLUMN webhook_processing_queue.last_error IS 'Error message from most recent failed attempt';
