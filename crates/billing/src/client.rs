//! Stripe client configuration

use stripe::Client;

use crate::error::{BillingError, BillingResult};

/// Configuration for Stripe billing
#[derive(Debug, Clone)]
pub struct StripeConfig {
    /// Stripe secret API key
    pub secret_key: String,
    /// Stripe webhook signing secret
    pub webhook_secret: String,
    /// Price IDs for each subscription tier
    pub price_ids: PriceIds,
    /// Base URL for success/cancel redirects
    pub app_base_url: String,
}

/// Stripe price IDs for subscription tiers and add-ons
/// Tier hierarchy: Free (no price) → Pro ($29) → Team ($99) → Enterprise (custom)
#[derive(Debug, Clone)]
pub struct PriceIds {
    // Subscription tiers (monthly)
    pub pro: String,
    pub team: String,
    pub enterprise: String,

    // Annual subscription tiers (20% discount)
    pub pro_annual: Option<String>,
    pub team_annual: Option<String>,

    // Resource pack add-ons (stackable) - Free + Pro
    pub extra_requests: Option<String>,
    pub extra_mcps: Option<String>,
    pub extra_api_keys: Option<String>,
    pub extra_team_members: Option<String>,

    // Feature add-ons - Free tier upsells (included in Pro)
    pub analytics_pro: Option<String>,
    pub priority_support: Option<String>,

    // Feature add-ons - All tiers
    pub webhook_alerts: Option<String>,
    pub data_export: Option<String>,

    // Premium add-ons - Pro+ only
    pub custom_domain: Option<String>,
    pub ip_allowlisting: Option<String>,
    pub higher_rate_limits: Option<String>,
    pub extended_retention: Option<String>,

    // Add-on only subscription (for free tier users with add-ons)
    pub addon_only: Option<String>,
}

impl StripeConfig {
    /// Create config from environment variables
    pub fn from_env() -> BillingResult<Self> {
        Ok(Self {
            secret_key: std::env::var("STRIPE_SECRET_KEY")
                .map_err(|_| BillingError::Config("STRIPE_SECRET_KEY not set".to_string()))?,
            webhook_secret: std::env::var("STRIPE_WEBHOOK_SECRET")
                .map_err(|_| BillingError::Config("STRIPE_WEBHOOK_SECRET not set".to_string()))?,
            price_ids: PriceIds {
                // Subscription tiers (required)
                pro: std::env::var("STRIPE_PRICE_PRO")
                    .map_err(|_| BillingError::Config("STRIPE_PRICE_PRO not set".to_string()))?,
                team: std::env::var("STRIPE_PRICE_TEAM")
                    .map_err(|_| BillingError::Config("STRIPE_PRICE_TEAM not set".to_string()))?,
                enterprise: std::env::var("STRIPE_PRICE_ENTERPRISE")
                    .map_err(|_| BillingError::Config("STRIPE_PRICE_ENTERPRISE not set".to_string()))?,

                // Annual tiers (optional)
                pro_annual: std::env::var("STRIPE_PRICE_PRO_ANNUAL").ok(),
                team_annual: std::env::var("STRIPE_PRICE_TEAM_ANNUAL").ok(),

                // Resource pack add-ons (stackable) - Free + Pro
                extra_requests: std::env::var("STRIPE_PRICE_EXTRA_REQUESTS").ok(),
                extra_mcps: std::env::var("STRIPE_PRICE_EXTRA_MCPS").ok(),
                extra_api_keys: std::env::var("STRIPE_PRICE_EXTRA_API_KEYS").ok(),
                extra_team_members: std::env::var("STRIPE_PRICE_EXTRA_TEAM_MEMBERS").ok(),

                // Feature add-ons - Free tier upsells (included in Pro)
                analytics_pro: std::env::var("STRIPE_PRICE_ANALYTICS_PRO").ok(),
                priority_support: std::env::var("STRIPE_PRICE_PRIORITY_SUPPORT").ok(),

                // Feature add-ons - All tiers
                webhook_alerts: std::env::var("STRIPE_PRICE_WEBHOOK_ALERTS").ok(),
                data_export: std::env::var("STRIPE_PRICE_DATA_EXPORT").ok(),

                // Premium add-ons - Pro+ only
                // Support legacy env vars as fallback for CUSTOM_DOMAIN
                custom_domain: std::env::var("STRIPE_PRICE_CUSTOM_DOMAIN")
                    .or_else(|_| std::env::var("STRIPE_PRICE_CUSTOM_BRANDING"))
                    .or_else(|_| std::env::var("STRIPE_PRICE_CUSTOM_SUBDOMAIN"))
                    .ok(),
                ip_allowlisting: std::env::var("STRIPE_PRICE_IP_ALLOWLISTING").ok(),
                higher_rate_limits: std::env::var("STRIPE_PRICE_HIGHER_RATE_LIMITS").ok(),
                extended_retention: std::env::var("STRIPE_PRICE_EXTENDED_RETENTION").ok(),

                // Add-on only subscription (for free tier users)
                addon_only: std::env::var("STRIPE_PRICE_ADDON_ONLY").ok(),
            },
            app_base_url: std::env::var("APP_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
        })
    }

    /// Get price ID for a tier (monthly billing)
    pub fn price_id_for_tier(&self, tier: &str) -> Option<&str> {
        match tier.to_lowercase().as_str() {
            "pro" => Some(&self.price_ids.pro),
            "team" => Some(&self.price_ids.team),
            "enterprise" => Some(&self.price_ids.enterprise),
            _ => None,
        }
    }

    /// Get price ID for a tier (annual billing with 20% discount)
    pub fn annual_price_id_for_tier(&self, tier: &str) -> Option<&str> {
        match tier.to_lowercase().as_str() {
            "pro" => self.price_ids.pro_annual.as_deref(),
            "team" => self.price_ids.team_annual.as_deref(),
            // Enterprise uses custom pricing, no standard annual option
            _ => None,
        }
    }

    /// Get tier from price ID (handles both monthly and annual prices)
    pub fn tier_for_price_id(&self, price_id: &str) -> Option<&'static str> {
        if price_id == self.price_ids.pro {
            Some("pro")
        } else if price_id == self.price_ids.team {
            Some("team")
        } else if price_id == self.price_ids.enterprise {
            Some("enterprise")
        } else if self.price_ids.pro_annual.as_deref() == Some(price_id) {
            Some("pro")
        } else if self.price_ids.team_annual.as_deref() == Some(price_id) {
            Some("team")
        } else {
            None
        }
    }

    /// Check if a price ID is for annual billing
    pub fn is_annual_price(&self, price_id: &str) -> bool {
        self.price_ids.pro_annual.as_deref() == Some(price_id)
            || self.price_ids.team_annual.as_deref() == Some(price_id)
    }

    /// Get price ID for an add-on type
    pub fn addon_price_id(&self, addon_type: &str) -> Option<String> {
        match addon_type {
            // Resource pack add-ons
            "extra_requests" => self.price_ids.extra_requests.clone(),
            "extra_mcps" => self.price_ids.extra_mcps.clone(),
            "extra_api_keys" => self.price_ids.extra_api_keys.clone(),
            "extra_team_members" => self.price_ids.extra_team_members.clone(),
            // Feature add-ons - Free tier upsells
            "analytics_pro" => self.price_ids.analytics_pro.clone(),
            "priority_support" => self.price_ids.priority_support.clone(),
            // Feature add-ons - All tiers
            "webhook_alerts" => self.price_ids.webhook_alerts.clone(),
            "data_export" => self.price_ids.data_export.clone(),
            // Premium add-ons - Pro+ only
            "custom_domain" | "custom_branding" => self.price_ids.custom_domain.clone(),
            "ip_allowlisting" => self.price_ids.ip_allowlisting.clone(),
            "higher_rate_limits" => self.price_ids.higher_rate_limits.clone(),
            "extended_retention" => self.price_ids.extended_retention.clone(),
            _ => None,
        }
    }
}

/// Stripe billing client
#[derive(Clone)]
pub struct StripeClient {
    client: Client,
    config: StripeConfig,
}

impl StripeClient {
    /// Create a new Stripe client from config
    pub fn new(config: StripeConfig) -> Self {
        let client = Client::new(&config.secret_key);
        Self { client, config }
    }

    /// Create a new Stripe client from environment variables
    pub fn from_env() -> BillingResult<Self> {
        let config = StripeConfig::from_env()?;
        Ok(Self::new(config))
    }

    /// Get the inner Stripe client
    pub fn inner(&self) -> &Client {
        &self.client
    }

    /// Get the config
    pub fn config(&self) -> &StripeConfig {
        &self.config
    }
}
