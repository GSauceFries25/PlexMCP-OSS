-- Expanded add-ons: quantity support for stackable add-ons
-- Date: 2024-12-04

-- Add quantity column for stackable add-ons (e.g., Extra Requests can be bought multiple times)
ALTER TABLE subscription_addons
ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS unit_price_cents INTEGER;

-- Add index for efficient quantity lookups
CREATE INDEX IF NOT EXISTS idx_subscription_addons_quantity
ON subscription_addons(customer_id, addon_type, quantity);

-- Add comments for documentation
COMMENT ON COLUMN subscription_addons.quantity IS 'Number of units purchased (for stackable add-ons like Extra Requests)';
COMMENT ON COLUMN subscription_addons.unit_price_cents IS 'Price per unit in cents at time of purchase';
