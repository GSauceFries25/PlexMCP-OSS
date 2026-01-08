-- Add contact information fields for public inquiries (enterprise inquiries without user accounts)
-- These fields allow us to identify the exact person who submitted a ticket even if they don't have a user account

ALTER TABLE support_tickets
ADD COLUMN IF NOT EXISTS contact_name TEXT,
ADD COLUMN IF NOT EXISTS contact_email TEXT,
ADD COLUMN IF NOT EXISTS contact_company TEXT;

-- Create index for searching by contact email
CREATE INDEX IF NOT EXISTS idx_tickets_contact_email ON support_tickets(contact_email) WHERE contact_email IS NOT NULL;

COMMENT ON COLUMN support_tickets.contact_name IS 'Name of contact person for public inquiries (when user_id is NULL)';
COMMENT ON COLUMN support_tickets.contact_email IS 'Email of contact person for public inquiries (when user_id is NULL)';
COMMENT ON COLUMN support_tickets.contact_company IS 'Company name for public inquiries (when user_id is NULL)';
