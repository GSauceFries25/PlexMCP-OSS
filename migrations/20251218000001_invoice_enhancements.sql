-- Invoice System Enhancements
-- Adds human-readable invoice numbers, line items, disputes, and grace period tracking

-- Human-readable invoice number sequence
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- Add new columns to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(20) UNIQUE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_due_cents INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_reason VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hosted_invoice_url TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Invoice line items table for detailed breakdown
CREATE TABLE IF NOT EXISTS invoice_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    stripe_line_item_id VARCHAR(255),
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_amount_cents INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'usd',
    type VARCHAR(50) NOT NULL DEFAULT 'invoiceitem',
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    proration BOOLEAN NOT NULL DEFAULT false,
    stripe_price_id VARCHAR(255),
    stripe_product_id VARCHAR(255),
    product_name VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invoice disputes table for billing support tickets
CREATE TABLE IF NOT EXISTS invoice_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment attempts table for tracking retry history
CREATE TABLE IF NOT EXISTS payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    stripe_payment_intent_id VARCHAR(255),
    stripe_charge_id VARCHAR(255),
    amount_cents INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'usd',
    status VARCHAR(50) NOT NULL,
    failure_code VARCHAR(100),
    failure_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add billing block columns to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_blocked_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_block_reason TEXT;

-- Function to generate human-readable invoice numbers (INV-YYYY-NNNNN)
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS VARCHAR(20) AS $$
BEGIN
    RETURN 'INV-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(NEXTVAL('invoice_number_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate invoice number and grace period on insert
CREATE OR REPLACE FUNCTION set_invoice_defaults()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-generate invoice number if not provided
    IF NEW.invoice_number IS NULL THEN
        NEW.invoice_number := generate_invoice_number();
    END IF;

    -- Auto-set grace period (due_date + 30 days) if not provided
    IF NEW.due_date IS NOT NULL AND NEW.grace_period_ends_at IS NULL THEN
        NEW.grace_period_ends_at := NEW.due_date + INTERVAL '30 days';
    END IF;

    -- Set updated_at on update
    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists and create new one
DROP TRIGGER IF EXISTS trigger_set_invoice_defaults ON invoices;
CREATE TRIGGER trigger_set_invoice_defaults
    BEFORE INSERT OR UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION set_invoice_defaults();

-- Updated_at trigger for invoice_disputes
CREATE OR REPLACE FUNCTION update_invoice_disputes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_invoice_disputes_updated_at ON invoice_disputes;
CREATE TRIGGER trigger_update_invoice_disputes_updated_at
    BEFORE UPDATE ON invoice_disputes
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_disputes_updated_at();

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_disputes_invoice_id ON invoice_disputes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_disputes_org_id ON invoice_disputes(org_id);
CREATE INDEX IF NOT EXISTS idx_invoice_disputes_status ON invoice_disputes(status);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice_id ON payment_attempts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_grace_period ON invoices(grace_period_ends_at)
    WHERE status IN ('open', 'uncollectible');
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices(org_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_orgs_billing_blocked ON organizations(billing_blocked_at)
    WHERE billing_blocked_at IS NOT NULL;

-- Enable RLS on new tables
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for invoice_line_items (same org access as parent invoice)
DROP POLICY IF EXISTS invoice_line_items_org_access ON invoice_line_items;
CREATE POLICY invoice_line_items_org_access ON invoice_line_items
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM invoices i
            JOIN organizations o ON i.org_id = o.id
            JOIN users u ON u.org_id = o.id
            WHERE i.id = invoice_line_items.invoice_id
            AND u.id = auth.uid()
        )
    );

-- RLS Policies for invoice_disputes
DROP POLICY IF EXISTS invoice_disputes_org_access ON invoice_disputes;
CREATE POLICY invoice_disputes_org_access ON invoice_disputes
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM organizations o
            JOIN users u ON u.org_id = o.id
            WHERE o.id = invoice_disputes.org_id
            AND u.id = auth.uid()
        )
    );

-- RLS Policies for payment_attempts
DROP POLICY IF EXISTS payment_attempts_org_access ON payment_attempts;
CREATE POLICY payment_attempts_org_access ON payment_attempts
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM invoices i
            JOIN organizations o ON i.org_id = o.id
            JOIN users u ON u.org_id = o.id
            WHERE i.id = payment_attempts.invoice_id
            AND u.id = auth.uid()
        )
    );

-- View for overdue invoices requiring attention (for worker job)
CREATE OR REPLACE VIEW overdue_invoices_view AS
SELECT
    i.id,
    i.org_id,
    i.invoice_number,
    i.amount_cents,
    i.amount_due_cents,
    i.status,
    i.due_date,
    i.grace_period_ends_at,
    o.name AS org_name,
    o.billing_blocked_at,
    CASE
        WHEN NOW() > i.grace_period_ends_at THEN 'past_grace_period'
        WHEN NOW() > i.due_date THEN 'in_grace_period'
        ELSE 'current'
    END AS urgency_status,
    EXTRACT(DAY FROM NOW() - i.due_date)::INTEGER AS days_overdue,
    EXTRACT(DAY FROM i.grace_period_ends_at - NOW())::INTEGER AS days_until_block
FROM invoices i
JOIN organizations o ON i.org_id = o.id
WHERE i.status IN ('open', 'uncollectible')
ORDER BY i.grace_period_ends_at ASC NULLS LAST;

-- Backfill invoice_number for existing invoices without one
UPDATE invoices
SET invoice_number = generate_invoice_number()
WHERE invoice_number IS NULL;

-- Backfill grace_period_ends_at for existing invoices
UPDATE invoices
SET grace_period_ends_at = due_date + INTERVAL '30 days'
WHERE due_date IS NOT NULL AND grace_period_ends_at IS NULL;

-- Comments for documentation
COMMENT ON TABLE invoice_line_items IS 'Line item breakdown for each invoice, synced from Stripe';
COMMENT ON TABLE invoice_disputes IS 'Customer-initiated billing disputes and support tickets';
COMMENT ON TABLE payment_attempts IS 'History of payment attempts for each invoice';
COMMENT ON COLUMN invoices.invoice_number IS 'Human-readable invoice number (INV-YYYY-NNNNN format)';
COMMENT ON COLUMN invoices.grace_period_ends_at IS 'Date when service will be blocked if unpaid (due_date + 30 days)';
COMMENT ON COLUMN organizations.billing_blocked_at IS 'When organization was blocked due to non-payment';
COMMENT ON VIEW overdue_invoices_view IS 'View of all overdue invoices with urgency status for enforcement';
