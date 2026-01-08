-- Add enterprise_inquiry category to ticket_category enum
-- This allows the support ticket system to track enterprise sales inquiries

ALTER TYPE ticket_category ADD VALUE IF NOT EXISTS 'enterprise_inquiry';
