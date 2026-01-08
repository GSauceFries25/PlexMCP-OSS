-- Migration: Fix webhook_events table to support both Stripe and Resend webhooks
-- Date: 2025-12-27
-- Purpose: Add source and event_id columns to support email webhooks

-- Step 1: Add source column (defaults to 'stripe' for existing rows)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'webhook_events' AND column_name = 'source') THEN
    ALTER TABLE webhook_events ADD COLUMN source TEXT NOT NULL DEFAULT 'stripe';
    RAISE NOTICE 'Added source column to webhook_events';
  ELSE
    RAISE NOTICE 'source column already exists';
  END IF;
END $$;

-- Step 2: Rename stripe_event_id to event_id for generic use
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'webhook_events' AND column_name = 'stripe_event_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'webhook_events' AND column_name = 'event_id') THEN
    ALTER TABLE webhook_events RENAME COLUMN stripe_event_id TO event_id;
    RAISE NOTICE 'Renamed stripe_event_id to event_id';
  ELSE
    RAISE NOTICE 'Column migration already done';
  END IF;
END $$;

-- Step 3: Drop old unique constraint on stripe_event_id (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'webhook_events_stripe_event_id_key') THEN
    ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_stripe_event_id_key;
    RAISE NOTICE 'Dropped old stripe_event_id unique constraint';
  END IF;
END $$;

-- Step 4: Drop old index on stripe_event_id (if exists)
DROP INDEX IF EXISTS idx_webhook_events_stripe_id;

-- Step 5: Create new composite unique constraint on (source, event_id)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'webhook_events_source_event_id_key') THEN
    ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_source_event_id_key
      UNIQUE (source, event_id);
    RAISE NOTICE 'Added unique constraint on (source, event_id)';
  END IF;
END $$;

-- Step 6: Create index on source for filtering
CREATE INDEX IF NOT EXISTS idx_webhook_events_source ON webhook_events(source);

-- Step 7: Create index on (source, event_id) for lookups
CREATE INDEX IF NOT EXISTS idx_webhook_events_source_event ON webhook_events(source, event_id);

-- Verify the changes
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'webhook_events'
  AND column_name IN ('source', 'event_id');

  IF col_count = 2 THEN
    RAISE NOTICE '✓ webhook_events table successfully updated for multi-source support';
  ELSE
    RAISE EXCEPTION 'Migration failed: missing required columns';
  END IF;
END $$;

-- Rollback instructions (commented):
-- ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS webhook_events_source_event_id_key;
-- DROP INDEX IF EXISTS idx_webhook_events_source;
-- DROP INDEX IF EXISTS idx_webhook_events_source_event;
-- ALTER TABLE webhook_events RENAME COLUMN event_id TO stripe_event_id;
-- ALTER TABLE webhook_events DROP COLUMN IF EXISTS source;
-- ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_stripe_event_id_key UNIQUE (stripe_event_id);
-- CREATE INDEX idx_webhook_events_stripe_id ON webhook_events(stripe_event_id);
