-- Fix ticket number trigger to respect pre-set ticket numbers
-- This allows different sources (email, web, api) to use different ticket number formats

-- Replace the trigger function to only generate ticket_number if not already set
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Only generate ticket number if not already set
  -- This allows email tickets to use 'EMAIL-' prefix and other sources to use custom prefixes
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := 'PLX-' || LPAD(nextval('ticket_number_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_ticket_number() IS 'Generates PLX-XXXXX ticket number if not already set. Allows custom prefixes for different sources.';
