//! Subscription add-ons management
//!
//! This module handles paid add-ons that can be attached to subscriptions.
//!
//! ## Current Add-ons (December 2024)
//!
//! Only ONE add-on is currently available:
//! - custom_domain: Use your own domain ($10/mo) - Pro and Team tiers only
//!
//! ## Legacy Add-ons (kept for backwards compatibility with existing DB records)
//! All other add-ons have been removed from the system.
//! Legacy enum variants are retained for database compatibility only.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use stripe::{
    CreateSubscriptionItem, PriceId, SubscriptionId, SubscriptionItem, SubscriptionItemId,
    UpdateSubscriptionItem,
};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    client::StripeClient,
    customer::CustomerService,
    error::{BillingError, BillingResult},
    subscriptions::SubscriptionService,
};

/// Add-on category for UI grouping (2 categories as of Dec 2024)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddonCategory {
    /// Scale Your Plan - capacity/overflow addons
    Scale,
    /// Enhance Your Workflow - feature addons
    Enhance,
    /// Legacy categories (kept for backwards compat with existing DB records)
    #[serde(rename = "resource_packs")]
    ResourcePacks,
    #[serde(rename = "features")]
    Features,
    #[serde(rename = "premium")]
    Premium,
}

/// Supported add-on types (consolidated Dec 2024)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddonType {
    // === NEW ADDON SYSTEM (7 addons) ===

    // Scale Your Plan - capacity/overflow
    /// Request Pack: +25K requests/mo ($8/mo) - stackable
    RequestPack,
    /// Burst Mode: 2x rate limits ($15/mo)
    BurstMode,

    // Enhance Your Workflow - features
    /// Advanced Analytics: Deep insights + exports ($12/mo)
    AnalyticsPro,
    /// Webhook Notifications: Real-time alerts ($8/mo)
    WebhookNotifications,
    /// Custom Domain: Use your own domain ($10/mo)
    CustomDomain,
    /// Security Suite: IP allowlisting + SSO + audit ($20/mo)
    SecuritySuite,
    /// Extended Retention: 90-day data history ($10/mo)
    ExtendedRetention,

    // === LEGACY ADDONS (kept for backwards compat) ===
    // These map to new equivalents or are deprecated

    /// Legacy: maps to RequestPack
    #[serde(rename = "extra_requests")]
    ExtraRequests,
    /// Legacy: maps to BurstMode
    #[serde(rename = "higher_rate_limits")]
    HigherRateLimits,
    /// Legacy: maps to SecuritySuite
    #[serde(rename = "ip_allowlisting")]
    IpAllowlisting,
    /// Legacy: maps to WebhookNotifications
    #[serde(rename = "webhook_alerts")]
    WebhookAlerts,

    // Deprecated - no longer available for new purchases
    /// Deprecated: cannibalize tier value
    ExtraMcps,
    /// Deprecated: cannibalize tier value
    ExtraApiKeys,
    /// Deprecated: cannibalize tier value
    ExtraTeamMembers,
    /// Deprecated: should be tier benefit
    PrioritySupport,
    /// Deprecated: merged into AnalyticsPro
    DataExport,
}

impl AddonType {
    /// Get all available add-on types (only CustomDomain as of Dec 2024)
    pub fn all() -> Vec<Self> {
        vec![
            Self::CustomDomain,
        ]
    }

    /// Get all addon types including legacy (for existing customer support)
    /// Kept for DB compatibility - only CustomDomain is active
    pub fn all_including_legacy() -> Vec<Self> {
        vec![
            // Current active addon
            Self::CustomDomain,
            // Legacy - kept for DB compatibility only
            Self::ExtraMcps,
            Self::ExtraApiKeys,
            Self::ExtraTeamMembers,
            Self::PrioritySupport,
            Self::DataExport,
            Self::RequestPack,
            Self::BurstMode,
            Self::AnalyticsPro,
            Self::WebhookNotifications,
            Self::SecuritySuite,
            Self::ExtendedRetention,
            Self::ExtraRequests,
            Self::HigherRateLimits,
            Self::IpAllowlisting,
            Self::WebhookAlerts,
        ]
    }

    /// Check if this is a deprecated addon (no new purchases)
    /// As of Dec 2024, ALL addons except CustomDomain are deprecated
    pub fn is_deprecated(&self) -> bool {
        !matches!(self, Self::CustomDomain)
    }

    /// Check if this is a legacy addon that maps to a new one
    pub fn is_legacy(&self) -> bool {
        matches!(
            self,
            Self::ExtraRequests | Self::HigherRateLimits | Self::IpAllowlisting | Self::WebhookAlerts
        )
    }

    /// Get the canonical (new) addon type for legacy addons
    pub fn canonical(&self) -> Self {
        match self {
            Self::ExtraRequests => Self::RequestPack,
            Self::HigherRateLimits => Self::BurstMode,
            Self::IpAllowlisting => Self::SecuritySuite,
            Self::WebhookAlerts => Self::WebhookNotifications,
            other => *other,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            // New system
            Self::RequestPack => "request_pack",
            Self::BurstMode => "burst_mode",
            Self::AnalyticsPro => "analytics_pro",
            Self::WebhookNotifications => "webhook_notifications",
            Self::CustomDomain => "custom_domain",
            Self::SecuritySuite => "security_suite",
            Self::ExtendedRetention => "extended_retention",
            // Legacy (still recognized)
            Self::ExtraRequests => "extra_requests",
            Self::HigherRateLimits => "higher_rate_limits",
            Self::IpAllowlisting => "ip_allowlisting",
            Self::WebhookAlerts => "webhook_alerts",
            // Deprecated
            Self::ExtraMcps => "extra_mcps",
            Self::ExtraApiKeys => "extra_api_keys",
            Self::ExtraTeamMembers => "extra_team_members",
            Self::PrioritySupport => "priority_support",
            Self::DataExport => "data_export",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            // New system
            "request_pack" => Some(Self::RequestPack),
            "burst_mode" => Some(Self::BurstMode),
            "analytics_pro" => Some(Self::AnalyticsPro),
            "webhook_notifications" => Some(Self::WebhookNotifications),
            "custom_domain" => Some(Self::CustomDomain),
            "security_suite" => Some(Self::SecuritySuite),
            "extended_retention" => Some(Self::ExtendedRetention),
            // Legacy mappings (map to canonical type for new purchases)
            "extra_requests" => Some(Self::ExtraRequests),
            "higher_rate_limits" => Some(Self::HigherRateLimits),
            "ip_allowlisting" => Some(Self::IpAllowlisting),
            "webhook_alerts" => Some(Self::WebhookAlerts),
            // Deprecated (still recognized for existing customers)
            "extra_mcps" => Some(Self::ExtraMcps),
            "extra_api_keys" => Some(Self::ExtraApiKeys),
            "extra_team_members" => Some(Self::ExtraTeamMembers),
            "priority_support" => Some(Self::PrioritySupport),
            "data_export" => Some(Self::DataExport),
            // Very old legacy name
            "custom_branding" => Some(Self::CustomDomain),
            _ => None,
        }
    }

    /// Get the display name for this add-on
    pub fn display_name(&self) -> &'static str {
        match self {
            // New system
            Self::RequestPack => "Request Pack",
            Self::BurstMode => "Burst Mode",
            Self::AnalyticsPro => "Advanced Analytics",
            Self::WebhookNotifications => "Webhook Notifications",
            Self::CustomDomain => "Custom Domain",
            Self::SecuritySuite => "Security Suite",
            Self::ExtendedRetention => "Extended Retention",
            // Legacy (use new names)
            Self::ExtraRequests => "Request Pack",
            Self::HigherRateLimits => "Burst Mode",
            Self::IpAllowlisting => "Security Suite",
            Self::WebhookAlerts => "Webhook Notifications",
            // Deprecated
            Self::ExtraMcps => "Extra MCPs Pack (Legacy)",
            Self::ExtraApiKeys => "Extra API Keys Pack (Legacy)",
            Self::ExtraTeamMembers => "Extra Team Members (Legacy)",
            Self::PrioritySupport => "Priority Support (Legacy)",
            Self::DataExport => "Data Export (Legacy)",
        }
    }

    /// Get the description for this add-on
    pub fn description(&self) -> &'static str {
        match self {
            // New system
            Self::RequestPack => "+25,000 requests per month",
            Self::BurstMode => "2x API throughput for all endpoints",
            Self::AnalyticsPro => "Deep insights, dashboards, and data exports",
            Self::WebhookNotifications => "Real-time alerts to Slack, Discord, or custom webhooks",
            Self::CustomDomain => "Use mcp.yourcompany.com with DNS verification",
            Self::SecuritySuite => "IP allowlisting, SSO, and audit log exports",
            Self::ExtendedRetention => "90-day data history (vs 7/30 day default)",
            // Legacy (use new descriptions)
            Self::ExtraRequests => "+25,000 requests per month",
            Self::HigherRateLimits => "2x API throughput for all endpoints",
            Self::IpAllowlisting => "IP allowlisting, SSO, and audit log exports",
            Self::WebhookAlerts => "Real-time alerts to Slack, Discord, or custom webhooks",
            // Deprecated
            Self::ExtraMcps => "+3 MCP instances (deprecated - upgrade instead)",
            Self::ExtraApiKeys => "+3 API keys (deprecated - upgrade instead)",
            Self::ExtraTeamMembers => "+2 team members (deprecated - upgrade instead)",
            Self::PrioritySupport => "Priority support (deprecated - included in Pro)",
            Self::DataExport => "Data export (deprecated - use Advanced Analytics)",
        }
    }

    /// Get the price in cents for this add-on
    pub fn price_cents(&self) -> i32 {
        match self {
            // New system - Scale Your Plan
            Self::RequestPack => 800,           // $8/mo (+25K requests)
            Self::BurstMode => 1500,            // $15/mo (2x rate limits)
            // New system - Enhance Your Workflow
            Self::AnalyticsPro => 1200,         // $12/mo (deep analytics + exports)
            Self::WebhookNotifications => 800,  // $8/mo (real-time alerts)
            Self::CustomDomain => 1000,         // $10/mo (DNS verified domain)
            Self::SecuritySuite => 2000,        // $20/mo (IP + SSO + audit)
            Self::ExtendedRetention => 1000,    // $10/mo (90-day history)
            // Legacy prices (use canonical pricing)
            Self::ExtraRequests => 800,         // Maps to RequestPack
            Self::HigherRateLimits => 1500,     // Maps to BurstMode
            Self::IpAllowlisting => 2000,       // Maps to SecuritySuite
            Self::WebhookAlerts => 800,         // Maps to WebhookNotifications
            // Deprecated (keep old prices for existing customers)
            Self::ExtraMcps => 500,             // $5/mo (grandfathered)
            Self::ExtraApiKeys => 400,          // $4/mo (grandfathered)
            Self::ExtraTeamMembers => 800,      // $8/mo (grandfathered)
            Self::PrioritySupport => 800,       // $8/mo (grandfathered)
            Self::DataExport => 500,            // $5/mo (grandfathered)
        }
    }

    /// Get the category for this add-on (new 2-category system)
    pub fn category(&self) -> AddonCategory {
        match self {
            // Scale Your Plan - capacity/overflow
            Self::RequestPack | Self::BurstMode
            | Self::ExtraRequests | Self::HigherRateLimits => AddonCategory::Scale,

            // Enhance Your Workflow - features
            Self::AnalyticsPro | Self::WebhookNotifications | Self::CustomDomain
            | Self::SecuritySuite | Self::ExtendedRetention
            | Self::IpAllowlisting | Self::WebhookAlerts => AddonCategory::Enhance,

            // Deprecated addons use legacy categories for existing data
            Self::ExtraMcps | Self::ExtraApiKeys | Self::ExtraTeamMembers => AddonCategory::ResourcePacks,
            Self::PrioritySupport | Self::DataExport => AddonCategory::Features,
        }
    }

    /// Whether this add-on can be purchased multiple times (stackable)
    /// CustomDomain is NOT stackable - you only need one
    pub fn is_stackable(&self) -> bool {
        // Only legacy stackable addons for existing customers
        matches!(
            self,
            Self::RequestPack | Self::ExtraRequests
                | Self::ExtraMcps | Self::ExtraApiKeys | Self::ExtraTeamMembers
        )
    }

    /// Get the resource increment for stackable add-ons
    pub fn resource_increment(&self) -> Option<i32> {
        match self {
            Self::RequestPack | Self::ExtraRequests => Some(25_000),  // +25K requests
            // Legacy (grandfathered)
            Self::ExtraMcps => Some(3),
            Self::ExtraApiKeys => Some(3),
            Self::ExtraTeamMembers => Some(2),
            _ => None,
        }
    }

    /// Whether this add-on is marked as popular
    /// Only CustomDomain is available/popular as of Dec 2024
    pub fn is_popular(&self) -> bool {
        matches!(self, Self::CustomDomain)
    }

    /// Check if this add-on is available for a given tier
    /// Returns (available, included_in_tier)
    /// As of Dec 2024, only CustomDomain is available for Pro and Team tiers
    pub fn availability_for_tier(&self, tier: &str) -> (bool, bool) {
        // Only CustomDomain is available for purchase
        if !matches!(self, Self::CustomDomain) {
            return (false, false);
        }

        // CustomDomain availability by tier
        match tier {
            // Enterprise includes custom domains
            "enterprise" => (true, true),
            // Pro and Team can purchase CustomDomain
            "pro" | "team" => (true, false),
            // Free tier cannot purchase CustomDomain
            "free" | "starter" => (false, false),
            _ => (false, false),
        }
    }

    /// Check if Pro tier includes this addon automatically
    /// No addons are included in Pro as of Dec 2024 (must purchase CustomDomain)
    pub fn is_included_in_pro(&self) -> bool {
        false
    }

    /// Check if this is a Pro+ only addon (not available to Free tier)
    /// CustomDomain requires Pro or Team tier
    pub fn is_pro_only(&self) -> bool {
        matches!(self, Self::CustomDomain)
    }
}

/// Subscription add-on model
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SubscriptionAddon {
    pub id: Uuid,
    pub org_id: Uuid,
    pub subscription_id: Uuid,
    pub addon_type: String,
    pub stripe_item_id: Option<String>,
    pub stripe_price_id: String,
    pub status: String,
    pub metadata: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub canceled_at: Option<OffsetDateTime>,
    /// Quantity for stackable add-ons (defaults to 1)
    #[sqlx(default)]
    pub quantity: Option<i32>,
    /// Unit price in cents at time of purchase
    #[sqlx(default)]
    pub unit_price_cents: Option<i32>,
}

/// Response for add-on info in API responses
#[derive(Debug, Clone, Serialize)]
pub struct AddonInfo {
    pub addon_type: String,
    pub name: String,
    pub description: String,
    pub price_cents: i32,
    pub category: AddonCategory,
    pub is_stackable: bool,
    pub is_popular: bool,
    pub enabled: bool,
    pub quantity: i32,
    pub included_in_tier: bool,
}

/// Request to enable an add-on
#[derive(Debug, Clone, Deserialize)]
pub struct EnableAddonRequest {
    pub quantity: Option<u32>,
}

/// Response with all add-ons and their status
#[derive(Debug, Clone, Serialize)]
pub struct AddonsListResponse {
    pub addons: Vec<AddonInfo>,
    pub tier_includes_all: bool,
    pub can_purchase: bool,
}

/// Add-on service for managing subscription add-ons
pub struct AddonService {
    stripe: StripeClient,
    pool: PgPool,
}

impl AddonService {
    pub fn new(stripe: StripeClient, pool: PgPool) -> Self {
        Self { stripe, pool }
    }

    /// Enable an add-on for an organization (with optional quantity for stackable add-ons)
    pub async fn enable_addon(
        &self,
        org_id: Uuid,
        addon_type: AddonType,
        quantity: Option<u32>,
    ) -> BillingResult<SubscriptionAddon> {
        let quantity = quantity.unwrap_or(1).max(1); // Minimum 1

        // Validate quantity for non-stackable add-ons
        if !addon_type.is_stackable() && quantity > 1 {
            return Err(BillingError::InvalidInput(
                format!("{} is not a stackable add-on", addon_type.display_name())
            ));
        }

        // Get the organization's active subscription
        let subscription: Option<(Uuid, Option<String>)> = sqlx::query_as(
            "SELECT id, stripe_subscription_id FROM subscriptions
             WHERE org_id = $1 AND status = 'active'
             LIMIT 1"
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        // If no subscription exists, create an add-on only subscription for free tier users
        let (subscription_id, stripe_subscription_id) = match subscription {
            Some((id, Some(stripe_id))) => (id, stripe_id),
            _ => {
                // No active subscription - create add-on only subscription
                let _stripe_sub = self.create_addon_only_subscription_for_org(org_id).await?;

                // Get the newly created subscription from DB
                let new_sub: (Uuid, Option<String>) = sqlx::query_as(
                    "SELECT id, stripe_subscription_id FROM subscriptions
                     WHERE org_id = $1 AND status = 'active'
                     LIMIT 1"
                )
                .bind(org_id)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| BillingError::Database(e.to_string()))?;

                let stripe_id = new_sub.1.ok_or_else(||
                    BillingError::Internal("Failed to create add-on subscription".to_string())
                )?;

                (new_sub.0, stripe_id)
            }
        };

        // Get the price ID for this add-on type
        let price_id = self.get_price_id_for_addon(addon_type)?;

        // Check if add-on already exists (active OR canceled)
        let existing: Option<(Uuid, Option<String>, Option<i32>, String)> = sqlx::query_as(
            "SELECT id, stripe_item_id, quantity, status FROM subscription_addons
             WHERE org_id = $1 AND addon_type = $2
             ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END
             LIMIT 1"
        )
        .bind(org_id)
        .bind(addon_type.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        // Handle existing records (active or canceled)
        if let Some((existing_id, stripe_item_id, current_qty, status)) = existing {
            if status == "active" {
                // Already active - handle stackable or return error
                if addon_type.is_stackable() {
                    let new_quantity = current_qty.unwrap_or(1) as u32 + quantity;
                    return self.update_addon_quantity(
                        existing_id,
                        stripe_item_id,
                        new_quantity,
                        addon_type,
                    ).await;
                } else {
                    return Err(BillingError::AlreadyExists("Add-on already enabled".to_string()));
                }
            } else {
                // Canceled in DB - check if Stripe item still exists and reactivate
                if stripe_item_id.is_some() {
                    // Check if the Stripe subscription still has this price
                    let stripe_sub_id = stripe_subscription_id
                        .parse::<SubscriptionId>()
                        .map_err(|e| BillingError::StripeApi(format!("Invalid subscription ID: {}", e)))?;

                    let stripe_sub = stripe::Subscription::retrieve(
                        self.stripe.inner(),
                        &stripe_sub_id,
                        &[]
                    ).await?;

                    let price_id = self.get_price_id_for_addon(addon_type)?;
                    let existing_item = stripe_sub.items.data.iter().find(|item| {
                        item.price.as_ref()
                            .map(|p| p.id.as_str() == price_id)
                            .unwrap_or(false)
                    });

                    if let Some(item) = existing_item {
                        // Stripe item still exists - just reactivate the DB record
                        tracing::info!(
                            org_id = %org_id,
                            addon_type = addon_type.as_str(),
                            stripe_item_id = %item.id,
                            "Reactivating existing addon - Stripe item still exists"
                        );

                        let addon: SubscriptionAddon = sqlx::query_as(
                            "UPDATE subscription_addons
                             SET status = 'active', canceled_at = NULL, updated_at = NOW(),
                                 stripe_item_id = $3, quantity = $4
                             WHERE id = $1 AND org_id = $2
                             RETURNING *"
                        )
                        .bind(existing_id)
                        .bind(org_id)
                        .bind(item.id.to_string())
                        .bind(quantity as i32)
                        .fetch_one(&self.pool)
                        .await
                        .map_err(|e| BillingError::Database(e.to_string()))?;

                        return Ok(addon);
                    }
                }
                // Stripe item doesn't exist - will create new one below
            }
        }

        // Parse Stripe types
        let stripe_sub_id = stripe_subscription_id
            .parse::<SubscriptionId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid subscription ID: {}", e)))?;

        // Check if Stripe subscription already has this price (handles orphaned items)
        let stripe_sub = stripe::Subscription::retrieve(
            self.stripe.inner(),
            &stripe_sub_id,
            &[]
        ).await?;

        let existing_stripe_item = stripe_sub.items.data.iter().find(|item| {
            item.price.as_ref()
                .map(|p| p.id.as_str() == price_id)
                .unwrap_or(false)
        });

        let stripe_item = if let Some(existing_item) = existing_stripe_item {
            // Stripe item already exists - use it instead of creating new one
            tracing::info!(
                org_id = %org_id,
                addon_type = addon_type.as_str(),
                stripe_item_id = %existing_item.id,
                "Found existing Stripe item - creating DB record to link"
            );
            existing_item.clone()
        } else {
            // Create new subscription item in Stripe
            let price_id_parsed = price_id
                .parse::<PriceId>()
                .map_err(|e| BillingError::StripeApi(format!("Invalid price ID: {}", e)))?;

            let mut create_item = CreateSubscriptionItem::new(stripe_sub_id);
            create_item.price = Some(price_id_parsed);
            create_item.quantity = Some(quantity as u64);

            SubscriptionItem::create(self.stripe.inner(), create_item)
                .await?
        };

        // Insert into database with quantity
        let addon: SubscriptionAddon = sqlx::query_as(
            "INSERT INTO subscription_addons (
                org_id, subscription_id, addon_type, stripe_item_id, stripe_price_id,
                status, metadata, quantity, unit_price_cents
            )
            VALUES ($1, $2, $3, $4, $5, 'active', '{}'::jsonb, $6, $7)
            ON CONFLICT (org_id, addon_type) DO UPDATE SET
                status = 'active',
                stripe_item_id = EXCLUDED.stripe_item_id,
                stripe_price_id = EXCLUDED.stripe_price_id,
                subscription_id = EXCLUDED.subscription_id,
                quantity = EXCLUDED.quantity,
                canceled_at = NULL,
                updated_at = NOW()
            RETURNING *"
        )
        .bind(org_id)
        .bind(subscription_id)
        .bind(addon_type.as_str())
        .bind(stripe_item.id.to_string())
        .bind(&price_id)
        .bind(quantity as i32)
        .bind(addon_type.price_cents())
        .fetch_one(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        Ok(addon)
    }

    /// Update quantity for a stackable add-on
    async fn update_addon_quantity(
        &self,
        addon_id: Uuid,
        stripe_item_id: Option<String>,
        new_quantity: u32,
        addon_type: AddonType,
    ) -> BillingResult<SubscriptionAddon> {
        // Update Stripe subscription item quantity
        if let Some(item_id) = stripe_item_id {
            let item_id_parsed = item_id
                .parse::<SubscriptionItemId>()
                .map_err(|e| BillingError::StripeApi(format!("Invalid subscription item ID: {}", e)))?;

            let mut update_item = UpdateSubscriptionItem::new();
            update_item.quantity = Some(new_quantity as u64);

            SubscriptionItem::update(self.stripe.inner(), &item_id_parsed, update_item)
                .await?;
        }

        // Update database
        let addon: SubscriptionAddon = sqlx::query_as(
            "UPDATE subscription_addons
             SET quantity = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *"
        )
        .bind(new_quantity as i32)
        .bind(addon_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        tracing::info!(
            addon_id = %addon_id,
            addon_type = addon_type.as_str(),
            new_quantity = new_quantity,
            "Updated add-on quantity"
        );

        Ok(addon)
    }

    /// Set the exact quantity for a stackable add-on (not additive)
    pub async fn set_addon_quantity(
        &self,
        org_id: Uuid,
        addon_type: AddonType,
        quantity: u32,
    ) -> BillingResult<SubscriptionAddon> {
        if !addon_type.is_stackable() {
            return Err(BillingError::InvalidInput(
                format!("{} is not a stackable add-on", addon_type.display_name())
            ));
        }

        // Get existing add-on
        let existing: Option<(Uuid, Option<String>)> = sqlx::query_as(
            "SELECT id, stripe_item_id FROM subscription_addons
             WHERE org_id = $1 AND addon_type = $2 AND status = 'active'"
        )
        .bind(org_id)
        .bind(addon_type.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        match existing {
            Some((addon_id, stripe_item_id)) if quantity > 0 => {
                self.update_addon_quantity(addon_id, stripe_item_id, quantity, addon_type).await
            }
            Some(_) if quantity == 0 => {
                // Disable add-on if quantity is 0
                self.disable_addon(org_id, addon_type).await?;
                Err(BillingError::NotFound("Add-on disabled due to zero quantity".to_string()))
            }
            None if quantity > 0 => {
                // Create new add-on
                self.enable_addon(org_id, addon_type, Some(quantity)).await
            }
            _ => Err(BillingError::NotFound("Add-on not found".to_string())),
        }
    }

    /// Disable an add-on for an organization
    pub async fn disable_addon(
        &self,
        org_id: Uuid,
        addon_type: AddonType,
    ) -> BillingResult<()> {
        // Get the add-on
        let addon: Option<(Uuid, Option<String>)> = sqlx::query_as(
            "SELECT id, stripe_item_id FROM subscription_addons
             WHERE org_id = $1 AND addon_type = $2 AND status = 'active'"
        )
        .bind(org_id)
        .bind(addon_type.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let (addon_id, stripe_item_id) = addon
            .ok_or_else(|| BillingError::NotFound("Add-on not found".to_string()))?;

        // Delete the subscription item in Stripe
        if let Some(stripe_item_id) = stripe_item_id {
            let item_id = stripe_item_id
                .parse::<SubscriptionItemId>()
                .map_err(|e| BillingError::StripeApi(format!("Invalid subscription item ID: {}", e)))?;
            SubscriptionItem::delete(self.stripe.inner(), &item_id)
                .await?;
        }

        // Update database status
        sqlx::query(
            "UPDATE subscription_addons SET status = 'canceled', canceled_at = NOW() WHERE id = $1"
        )
        .bind(addon_id)
        .execute(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        Ok(())
    }

    /// List all active add-ons for an organization
    pub async fn list_addons(&self, org_id: Uuid) -> BillingResult<Vec<SubscriptionAddon>> {
        let addons: Vec<SubscriptionAddon> = sqlx::query_as(
            "SELECT id, org_id, subscription_id, addon_type, stripe_item_id, stripe_price_id,
                    status, metadata, created_at, updated_at, canceled_at, quantity, unit_price_cents
             FROM subscription_addons
             WHERE org_id = $1 AND status = 'active'
             ORDER BY created_at DESC"
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        Ok(addons)
    }

    /// Check if an organization has a specific add-on enabled
    pub async fn has_addon(&self, org_id: Uuid, addon_type: AddonType) -> BillingResult<bool> {
        let result: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM subscription_addons WHERE org_id = $1 AND addon_type = $2 AND status = 'active'"
        )
        .bind(org_id)
        .bind(addon_type.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        Ok(result.is_some())
    }

    /// Get the Stripe price ID for an add-on type
    fn get_price_id_for_addon(&self, addon_type: AddonType) -> BillingResult<String> {
        let config = self.stripe.config();
        let price_id = match addon_type {
            // New system addons - map to existing config fields
            AddonType::RequestPack => config.price_ids.extra_requests.as_ref(),
            AddonType::BurstMode => config.price_ids.higher_rate_limits.as_ref(),
            AddonType::WebhookNotifications => config.price_ids.webhook_alerts.as_ref(),
            AddonType::SecuritySuite => config.price_ids.ip_allowlisting.as_ref(),

            // Addons that keep their config mapping
            AddonType::AnalyticsPro => config.price_ids.analytics_pro.as_ref(),
            AddonType::CustomDomain => config.price_ids.custom_domain.as_ref(),
            AddonType::ExtendedRetention => config.price_ids.extended_retention.as_ref(),

            // Legacy addons (map to same config)
            AddonType::ExtraRequests => config.price_ids.extra_requests.as_ref(),
            AddonType::HigherRateLimits => config.price_ids.higher_rate_limits.as_ref(),
            AddonType::IpAllowlisting => config.price_ids.ip_allowlisting.as_ref(),
            AddonType::WebhookAlerts => config.price_ids.webhook_alerts.as_ref(),

            // Deprecated addons (keep config for existing customers)
            AddonType::ExtraMcps => config.price_ids.extra_mcps.as_ref(),
            AddonType::ExtraApiKeys => config.price_ids.extra_api_keys.as_ref(),
            AddonType::ExtraTeamMembers => config.price_ids.extra_team_members.as_ref(),
            AddonType::PrioritySupport => config.price_ids.priority_support.as_ref(),
            AddonType::DataExport => config.price_ids.data_export.as_ref(),
        };
        price_id
            .cloned()
            .ok_or_else(|| BillingError::Config(format!(
                "Stripe price ID for {} add-on is not configured",
                addon_type.as_str()
            )))
    }

    /// Create an add-on only subscription for free tier users
    /// This creates a $0 base subscription that add-on items can be attached to
    async fn create_addon_only_subscription_for_org(&self, org_id: Uuid) -> BillingResult<stripe::Subscription> {
        // Get the org's details including stripe_customer_id and owner info
        let org_info: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT o.name, o.stripe_customer_id FROM organizations o WHERE o.id = $1"
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let (org_name, existing_customer_id) = org_info
            .ok_or_else(|| BillingError::NotFound("Organization not found".to_string()))?;

        // Get or create the Stripe customer
        let customer_id = match existing_customer_id {
            Some(id) => id,
            None => {
                // Get the org owner's email for customer creation
                let owner_email: Option<(String,)> = sqlx::query_as(
                    "SELECT u.email FROM users u
                     JOIN org_members om ON u.id = om.user_id
                     WHERE om.org_id = $1 AND om.role = 'owner'
                     LIMIT 1"
                )
                .bind(org_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| BillingError::Database(e.to_string()))?;

                let email = owner_email
                    .map(|(e,)| e)
                    .unwrap_or_else(|| format!("org-{}@plexmcp.com", org_id));

                // Create Stripe customer
                let customer_service = CustomerService::new(self.stripe.clone(), self.pool.clone());
                let customer = customer_service.create_customer(org_id, &email, &org_name).await?;

                tracing::info!(
                    org_id = %org_id,
                    customer_id = %customer.id,
                    "Created Stripe customer for add-on subscription"
                );

                customer.id.to_string()
            }
        };

        // Create the subscription service and call it
        let sub_service = SubscriptionService::new(self.stripe.clone(), self.pool.clone());
        let subscription = sub_service.create_addon_only_subscription(org_id, &customer_id).await?;

        tracing::info!(
            org_id = %org_id,
            subscription_id = %subscription.id,
            "Created add-on only subscription for free tier user"
        );

        Ok(subscription)
    }

    /// Get add-on quantities for an org (for calculating effective limits)
    pub async fn get_addon_quantities(&self, org_id: Uuid) -> BillingResult<AddonQuantities> {
        let addons: Vec<(String, i32)> = sqlx::query_as(
            "SELECT addon_type, COALESCE(quantity, 1)
             FROM subscription_addons
             WHERE org_id = $1 AND status = 'active'"
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let mut quantities = AddonQuantities::default();
        for (addon_type, qty) in addons {
            match addon_type.as_str() {
                "extra_requests" => quantities.extra_requests += qty as u32,
                "extra_mcps" => quantities.extra_mcps += qty as u32,
                "extra_api_keys" => quantities.extra_api_keys += qty as u32,
                "extra_team_members" => quantities.extra_team_members += qty as u32,
                _ => {}
            }
        }

        Ok(quantities)
    }

    /// Build the full add-ons list response with all add-ons and their status
    pub async fn build_addons_response(
        &self,
        org_id: Uuid,
        tier_includes_all: bool,
        can_purchase: bool,
    ) -> BillingResult<AddonsListResponse> {
        let active_addons = self.list_addons(org_id).await?;

        let addons: Vec<AddonInfo> = AddonType::all()
            .into_iter()
            .map(|addon_type| {
                let active = active_addons.iter().find(|a| a.addon_type == addon_type.as_str());
                let enabled = tier_includes_all || active.is_some();
                let quantity = active.and_then(|a| a.quantity).unwrap_or(if enabled { 1 } else { 0 });

                AddonInfo {
                    addon_type: addon_type.as_str().to_string(),
                    name: addon_type.display_name().to_string(),
                    description: addon_type.description().to_string(),
                    price_cents: addon_type.price_cents(),
                    category: addon_type.category(),
                    is_stackable: addon_type.is_stackable(),
                    is_popular: addon_type.is_popular(),
                    enabled,
                    quantity,
                    included_in_tier: tier_includes_all,
                }
            })
            .collect();

        Ok(AddonsListResponse {
            addons,
            tier_includes_all,
            can_purchase,
        })
    }
}

/// Quantities of stackable add-ons for an org
#[derive(Debug, Clone, Default, Serialize)]
pub struct AddonQuantities {
    pub extra_requests: u32,
    pub extra_mcps: u32,
    pub extra_api_keys: u32,
    pub extra_team_members: u32,
}
