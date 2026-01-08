//! Stripe Checkout sessions

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use stripe::{
    CheckoutSession, CheckoutSessionMode, CreateCheckoutSession, CreateCheckoutSessionDiscounts,
    CreateCheckoutSessionLineItems, CreateCheckoutSessionLineItemsPriceData,
    CreateCheckoutSessionLineItemsPriceDataProductData, CustomerId,
};
use uuid::Uuid;

use crate::client::StripeClient;
use crate::error::{BillingError, BillingResult};
use crate::metered::MeteredBillingService;
use crate::subscriptions::SubscriptionService;

/// Billing interval for subscriptions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum BillingInterval {
    #[default]
    Monthly,
    Annual,
}

impl BillingInterval {
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "monthly" | "month" => Some(Self::Monthly),
            "annual" | "yearly" | "year" => Some(Self::Annual),
            _ => None,
        }
    }
}

/// Checkout service for creating Stripe checkout sessions
pub struct CheckoutService {
    stripe: StripeClient,
    pool: PgPool,
}

impl CheckoutService {
    pub fn new(stripe: StripeClient, pool: PgPool) -> Self {
        Self { stripe, pool }
    }

    /// Verify that a Stripe customer ID belongs to the given organization (defense-in-depth)
    /// This protects against mismatched org_id/customer_id pairs being passed to checkout functions
    async fn verify_customer_ownership(
        &self,
        org_id: Uuid,
        customer_id: &str,
    ) -> BillingResult<()> {
        let verified: Option<(String,)> = sqlx::query_as(
            "SELECT stripe_customer_id FROM organizations WHERE id = $1 AND stripe_customer_id = $2"
        )
        .bind(org_id)
        .bind(customer_id)
        .fetch_optional(&self.pool)
        .await?;

        if verified.is_none() {
            tracing::warn!(
                org_id = %org_id,
                customer_id = %customer_id,
                "Customer ID ownership verification failed"
            );
            return Err(BillingError::Unauthorized(
                "Customer ID does not belong to this organization".to_string(),
            ));
        }
        Ok(())
    }

    /// Create a checkout session for a new subscription
    pub async fn create_subscription_checkout(
        &self,
        org_id: Uuid,
        customer_id: &str,
        tier: &str,
    ) -> BillingResult<CheckoutSession> {
        // Default to monthly billing
        self.create_subscription_checkout_with_interval(
            org_id,
            customer_id,
            tier,
            BillingInterval::Monthly,
        )
        .await
    }

    /// Create a checkout session for a new subscription with specified billing interval
    pub async fn create_subscription_checkout_with_interval(
        &self,
        org_id: Uuid,
        customer_id: &str,
        tier: &str,
        billing_interval: BillingInterval,
    ) -> BillingResult<CheckoutSession> {
        // SOC 2 CC6.1: Verify customer ID belongs to this organization (defense-in-depth)
        self.verify_customer_ownership(org_id, customer_id).await?;

        // Get the appropriate price ID based on billing interval
        let price_id = match billing_interval {
            BillingInterval::Monthly => self
                .stripe
                .config()
                .price_id_for_tier(tier)
                .ok_or_else(|| BillingError::InvalidTier(tier.to_string()))?,
            BillingInterval::Annual => self
                .stripe
                .config()
                .annual_price_id_for_tier(tier)
                .ok_or_else(|| {
                    BillingError::InvalidTier(format!("{} (annual pricing not configured)", tier))
                })?,
        };

        let customer_id = customer_id
            .parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        let base_url = &self.stripe.config().app_base_url;
        let success_url = format!(
            "{}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            base_url
        );
        let cancel_url = format!("{}/billing/cancel", base_url);

        let mut metadata = std::collections::HashMap::new();
        metadata.insert("org_id".to_string(), org_id.to_string());
        metadata.insert("tier".to_string(), tier.to_string());
        metadata.insert(
            "billing_interval".to_string(),
            match billing_interval {
                BillingInterval::Monthly => "monthly".to_string(),
                BillingInterval::Annual => "annual".to_string(),
            },
        );

        // Build line items - start with the base subscription price
        let mut line_items = vec![CreateCheckoutSessionLineItems {
            price: Some(price_id.to_string()),
            quantity: Some(1),
            ..Default::default()
        }];

        // Add metered item for Pro/Team tiers (for overage billing)
        if MeteredBillingService::tier_supports_metered(tier) {
            if let Some(metered_price_id) = MeteredBillingService::get_metered_price_id(tier) {
                line_items.push(CreateCheckoutSessionLineItems {
                    price: Some(metered_price_id),
                    // No quantity for metered items - usage is reported later
                    ..Default::default()
                });
                tracing::info!(
                    tier = %tier,
                    "Adding metered billing item to checkout"
                );
            } else {
                tracing::warn!(
                    tier = %tier,
                    "Metered price ID not configured for tier"
                );
            }
        }

        let params = CreateCheckoutSession {
            customer: Some(customer_id),
            mode: Some(CheckoutSessionMode::Subscription),
            line_items: Some(line_items),
            success_url: Some(&success_url),
            cancel_url: Some(&cancel_url),
            metadata: Some(metadata),
            allow_promotion_codes: Some(true),
            billing_address_collection: Some(stripe::CheckoutSessionBillingAddressCollection::Auto),
            ..Default::default()
        };

        let session = CheckoutSession::create(self.stripe.inner(), params).await?;

        tracing::info!(
            org_id = %org_id,
            session_id = %session.id,
            tier = %tier,
            billing_interval = ?billing_interval,
            "Created checkout session"
        );

        Ok(session)
    }

    /// Create a checkout session with a coupon applied (for reactivation with credit)
    pub async fn create_subscription_checkout_with_coupon(
        &self,
        org_id: Uuid,
        customer_id: &str,
        tier: &str,
        billing_interval: BillingInterval,
        coupon_id: &str,
    ) -> BillingResult<CheckoutSession> {
        // SOC 2 CC6.1: Verify customer ID belongs to this organization (defense-in-depth)
        self.verify_customer_ownership(org_id, customer_id).await?;

        let price_id = match billing_interval {
            BillingInterval::Monthly => self
                .stripe
                .config()
                .price_id_for_tier(tier)
                .ok_or_else(|| BillingError::InvalidTier(tier.to_string()))?,
            BillingInterval::Annual => self
                .stripe
                .config()
                .annual_price_id_for_tier(tier)
                .ok_or_else(|| {
                    BillingError::InvalidTier(format!("{} (annual pricing not configured)", tier))
                })?,
        };

        let customer_id = customer_id
            .parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        let base_url = &self.stripe.config().app_base_url;
        let success_url = format!(
            "{}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            base_url
        );
        let cancel_url = format!("{}/billing/cancel", base_url);

        let mut metadata = std::collections::HashMap::new();
        metadata.insert("org_id".to_string(), org_id.to_string());
        metadata.insert("tier".to_string(), tier.to_string());
        metadata.insert(
            "billing_interval".to_string(),
            match billing_interval {
                BillingInterval::Monthly => "monthly".to_string(),
                BillingInterval::Annual => "annual".to_string(),
            },
        );
        metadata.insert("reactivation_coupon".to_string(), coupon_id.to_string());

        // Build line items
        let mut line_items = vec![CreateCheckoutSessionLineItems {
            price: Some(price_id.to_string()),
            quantity: Some(1),
            ..Default::default()
        }];

        // Add metered item for Pro/Team tiers (for overage billing)
        if MeteredBillingService::tier_supports_metered(tier) {
            if let Some(metered_price_id) = MeteredBillingService::get_metered_price_id(tier) {
                line_items.push(CreateCheckoutSessionLineItems {
                    price: Some(metered_price_id),
                    ..Default::default()
                });
            }
        }

        // Apply the coupon discount
        let discounts = vec![CreateCheckoutSessionDiscounts {
            coupon: Some(coupon_id.to_string()),
            ..Default::default()
        }];

        let params = CreateCheckoutSession {
            customer: Some(customer_id),
            mode: Some(CheckoutSessionMode::Subscription),
            line_items: Some(line_items),
            success_url: Some(&success_url),
            cancel_url: Some(&cancel_url),
            metadata: Some(metadata),
            discounts: Some(discounts),
            // Don't allow promotion codes when a coupon is already applied
            allow_promotion_codes: None,
            billing_address_collection: Some(stripe::CheckoutSessionBillingAddressCollection::Auto),
            ..Default::default()
        };

        let session = CheckoutSession::create(self.stripe.inner(), params).await?;

        tracing::info!(
            org_id = %org_id,
            session_id = %session.id,
            tier = %tier,
            billing_interval = ?billing_interval,
            coupon_id = %coupon_id,
            "Created checkout session with coupon"
        );

        Ok(session)
    }

    /// Create a checkout session for upgrading an existing subscription
    /// This includes any pending overages in the checkout total
    pub async fn create_upgrade_checkout(
        &self,
        org_id: Uuid,
        customer_id: &str,
        new_tier: &str,
    ) -> BillingResult<CheckoutSession> {
        self.create_upgrade_checkout_with_interval(
            org_id,
            customer_id,
            new_tier,
            BillingInterval::Monthly,
        )
        .await
    }

    /// Create a checkout session for upgrading with specific billing interval
    /// This creates a PAYMENT mode checkout for the prorated upgrade amount + overages
    /// The subscription is updated to the new tier after payment succeeds (via webhook)
    pub async fn create_upgrade_checkout_with_interval(
        &self,
        org_id: Uuid,
        customer_id: &str,
        new_tier: &str,
        billing_interval: BillingInterval,
    ) -> BillingResult<CheckoutSession> {
        // SOC 2 CC6.1: Verify customer ID belongs to this organization (defense-in-depth)
        self.verify_customer_ownership(org_id, customer_id).await?;

        let customer_id_parsed = customer_id
            .parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        // Get pending overages
        let pending_overages = self.get_pending_overages(org_id).await?;

        // Calculate proration using subscription service
        let sub_service = SubscriptionService::new(self.stripe.clone(), self.pool.clone());
        let proration_preview = sub_service
            .preview_upgrade_proration(org_id, new_tier)
            .await?;

        let proration_cents = proration_preview.proration_amount_cents;

        // IMPORTANT: Overages must always be paid in full. Proration credits should not
        // offset overage charges. Calculate total carefully:
        // - If proration is positive (user owes for upgrade): add both
        // - If proration is negative (credit from unused time): don't let it offset overages
        let adjusted_proration = if proration_cents < 0 && pending_overages > 0 {
            // Cap the credit so it doesn't exceed overages
            // This ensures overages are always paid
            tracing::warn!(
                org_id = %org_id,
                proration_credit = proration_cents,
                pending_overages = pending_overages,
                "Proration credit would offset overages - limiting credit application"
            );
            0_i64 // Don't apply credit at checkout, let Stripe handle it on subscription
        } else {
            proration_cents
        };

        let total_amount = adjusted_proration + pending_overages;

        tracing::info!(
            org_id = %org_id,
            new_tier = %new_tier,
            original_proration_cents = proration_cents,
            adjusted_proration_cents = adjusted_proration,
            overage_cents = pending_overages,
            total_amount = total_amount,
            "Creating upgrade payment checkout"
        );

        if total_amount <= 0 {
            // No payment needed - upgrade directly without checkout
            return Err(BillingError::Internal(
                "No payment required for upgrade - please contact support".to_string(),
            ));
        }

        // Mark overages as pending payment so they don't get double-billed
        if pending_overages > 0 {
            self.mark_overages_pending_payment(org_id).await?;
        }

        let base_url = &self.stripe.config().app_base_url;
        let success_url = format!(
            "{}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            base_url
        );
        let cancel_url = format!("{}/billing/cancel", base_url);

        // Build metadata for webhook processing
        let mut metadata = std::collections::HashMap::new();
        metadata.insert("org_id".to_string(), org_id.to_string());
        metadata.insert("checkout_type".to_string(), "upgrade_payment".to_string());
        metadata.insert("new_tier".to_string(), new_tier.to_string());
        metadata.insert(
            "billing_interval".to_string(),
            match billing_interval {
                BillingInterval::Monthly => "monthly".to_string(),
                BillingInterval::Annual => "annual".to_string(),
            },
        );
        metadata.insert("proration_cents".to_string(), proration_cents.to_string());
        metadata.insert("overage_cents".to_string(), pending_overages.to_string());

        // Build description for the line item
        let tier_display = match new_tier {
            "team" => "Team",
            "pro" => "Pro",
            "enterprise" => "Enterprise",
            _ => new_tier,
        };

        let description = if pending_overages > 0 {
            format!(
                "Prorated upgrade to {} (${:.2}) + Outstanding overages (${:.2})",
                tier_display,
                proration_cents as f64 / 100.0,
                pending_overages as f64 / 100.0
            )
        } else {
            format!(
                "Prorated upgrade to {} Plan ({} days remaining)",
                tier_display, proration_preview.days_remaining
            )
        };

        // Create a payment-mode checkout (not subscription mode)
        // This charges for the proration + overages, then webhook upgrades the subscription
        let line_item = CreateCheckoutSessionLineItems {
            price_data: Some(CreateCheckoutSessionLineItemsPriceData {
                currency: stripe::Currency::USD,
                unit_amount: Some(total_amount),
                product_data: Some(CreateCheckoutSessionLineItemsPriceDataProductData {
                    name: format!("Upgrade to {} Plan", tier_display),
                    description: Some(description),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            quantity: Some(1),
            ..Default::default()
        };

        let params = CreateCheckoutSession {
            customer: Some(customer_id_parsed),
            mode: Some(CheckoutSessionMode::Payment),
            line_items: Some(vec![line_item]),
            success_url: Some(&success_url),
            cancel_url: Some(&cancel_url),
            metadata: Some(metadata),
            ..Default::default()
        };

        let session = CheckoutSession::create(self.stripe.inner(), params).await?;

        tracing::info!(
            org_id = %org_id,
            session_id = %session.id,
            new_tier = %new_tier,
            total_amount_cents = total_amount,
            "Created upgrade payment checkout session"
        );

        Ok(session)
    }

    /// Get total pending overages in cents for an organization
    async fn get_pending_overages(&self, org_id: Uuid) -> BillingResult<i64> {
        let result: Option<(Option<i64>,)> = sqlx::query_as(
            r#"
            SELECT SUM(total_charge_cents)
            FROM overage_charges
            WHERE org_id = $1 AND status IN ('pending', 'awaiting_payment')
            "#,
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result.and_then(|(sum,)| sum).unwrap_or(0))
    }

    /// Mark pending overages as being included in an upgrade payment
    async fn mark_overages_pending_payment(&self, org_id: Uuid) -> BillingResult<()> {
        sqlx::query(
            r#"
            UPDATE overage_charges
            SET status = 'pending_upgrade_payment',
                early_payment_invoice_id = NULL
            WHERE org_id = $1 AND status IN ('pending', 'awaiting_payment')
            "#,
        )
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Retrieve a checkout session by ID
    pub async fn get_session(&self, session_id: &str) -> BillingResult<CheckoutSession> {
        let session_id = session_id
            .parse::<stripe::CheckoutSessionId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid session ID: {}", e)))?;

        let session = CheckoutSession::retrieve(self.stripe.inner(), &session_id, &[]).await?;
        Ok(session)
    }

    /// Create a checkout session for purchasing add-ons (when customer has no payment method)
    pub async fn create_addon_checkout(
        &self,
        org_id: Uuid,
        customer_id: &str,
        addon_type: &str,
        addon_price_id: &str,
        quantity: u32,
    ) -> BillingResult<CheckoutSession> {
        // SOC 2 CC6.1: Verify customer ID belongs to this organization (defense-in-depth)
        self.verify_customer_ownership(org_id, customer_id).await?;

        let customer_id = customer_id
            .parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        let base_url = &self.stripe.config().app_base_url;
        // Redirect to settings/domains page after successful addon checkout
        let success_url = format!(
            "{}/settings?tab=domains&addon_success=true&addon_type={}&session_id={{CHECKOUT_SESSION_ID}}",
            base_url, addon_type
        );
        // Redirect back to settings/domains on cancel (shows paywall again)
        let cancel_url = format!("{}/settings?tab=domains&addon_cancel=true", base_url);

        let mut metadata = std::collections::HashMap::new();
        metadata.insert("org_id".to_string(), org_id.to_string());
        metadata.insert("addon_type".to_string(), addon_type.to_string());
        metadata.insert("quantity".to_string(), quantity.to_string());
        metadata.insert("checkout_type".to_string(), "addon".to_string());

        let params = CreateCheckoutSession {
            customer: Some(customer_id),
            mode: Some(CheckoutSessionMode::Subscription),
            line_items: Some(vec![CreateCheckoutSessionLineItems {
                price: Some(addon_price_id.to_string()),
                quantity: Some(quantity as u64),
                ..Default::default()
            }]),
            success_url: Some(&success_url),
            cancel_url: Some(&cancel_url),
            metadata: Some(metadata),
            allow_promotion_codes: Some(true),
            billing_address_collection: Some(stripe::CheckoutSessionBillingAddressCollection::Auto),
            ..Default::default()
        };

        let session = CheckoutSession::create(self.stripe.inner(), params).await?;

        tracing::info!(
            org_id = %org_id,
            session_id = %session.id,
            addon_type = %addon_type,
            quantity = %quantity,
            "Created addon checkout session"
        );

        Ok(session)
    }
}

/// Response for creating a checkout session
#[derive(Debug, serde::Serialize)]
pub struct CheckoutResponse {
    pub session_id: String,
    pub url: Option<String>,
}

impl From<CheckoutSession> for CheckoutResponse {
    fn from(session: CheckoutSession) -> Self {
        Self {
            session_id: session.id.to_string(),
            url: session.url,
        }
    }
}
