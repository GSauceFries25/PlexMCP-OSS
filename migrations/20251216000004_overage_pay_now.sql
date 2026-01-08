-- Migration: Add pay-now tracking to overage_charges
-- Enables users to pay accumulated overages before billing cycle ends

ALTER TABLE overage_charges
ADD COLUMN IF NOT EXISTS paid_early BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE overage_charges
ADD COLUMN IF NOT EXISTS early_payment_invoice_id VARCHAR(255);

-- Index for finding early-paid charges by invoice
CREATE INDEX IF NOT EXISTS idx_overage_charges_early_payment
    ON overage_charges(early_payment_invoice_id)
    WHERE early_payment_invoice_id IS NOT NULL;

-- Comments
COMMENT ON COLUMN overage_charges.paid_early IS 'True if paid via pay-now before billing cycle end';
COMMENT ON COLUMN overage_charges.early_payment_invoice_id IS 'Stripe invoice ID for early payment';
