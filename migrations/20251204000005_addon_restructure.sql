-- Migration: Restructure add-ons
-- - Merge custom_subdomain into custom_domain
-- - Rename custom_branding to custom_domain
-- - Handle users who had both (credit them, keep one subscription)

-- Step 1: Update custom_branding to custom_domain
UPDATE subscription_addons
SET addon_type = 'custom_domain',
    updated_at = NOW()
WHERE addon_type = 'custom_branding'
AND status = 'active';

-- Step 2: For users who have custom_subdomain, migrate to custom_domain
-- But only if they don't already have custom_domain (from custom_branding migration)
UPDATE subscription_addons
SET addon_type = 'custom_domain',
    updated_at = NOW()
WHERE addon_type = 'custom_subdomain'
AND status = 'active'
AND customer_id NOT IN (
    SELECT customer_id FROM subscription_addons
    WHERE addon_type = 'custom_domain' AND status = 'active'
);

-- Step 3: Cancel any remaining custom_subdomain add-ons (duplicates)
-- These users had both custom_subdomain and custom_branding, so they get
-- custom_domain from the custom_branding one (higher value)
UPDATE subscription_addons
SET status = 'canceled',
    canceled_at = NOW(),
    metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{migration_note}',
        '"Merged into custom_domain during addon restructure 2025-12-04"'
    )
WHERE addon_type = 'custom_subdomain'
AND status = 'active';

-- Note: The Stripe subscription items for canceled add-ons should be cleaned up
-- manually or via a background job. The DB migration only updates our records.
