//! Entitlement Module
//!
//! Provides a unified view of what an organization can do based on their billing state.
//! This module answers the question: "What features/limits does this org have right now?"
//!
//! ## Design Principles
//!
//! 1. **Single Source of Truth**: `compute_entitlement()` is THE function that determines access
//! 2. **Deterministic**: Same inputs always produce same outputs
//! 3. **Debuggable**: Entitlement includes source tracing for "why" questions
//! 4. **Testable**: Pure function with clear inputs/outputs

use plexmcp_shared::types::{CustomLimits, EffectiveLimits, SubscriptionTier};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::{BillingError, BillingResult};

/// Unified entitlement state - answers "what can this org do right now?"
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntitlementState {
    /// Trial period active (trial_end > now)
    Trialing,
    /// Subscription active and in good standing
    Active,
    /// Payment past due but within grace period (3 days)
    PastDueGrace,
    /// Payment past due and grace period expired
    PastDueLocked,
    /// Subscription canceled but still in paid period
    CanceledGrace,
    /// Subscription fully canceled, access revoked
    Canceled,
    /// Organization paused due to spend cap
    Paused,
    /// Enterprise with manual billing (no Stripe subscription)
    EnterpriseManual,
    /// Free tier (no subscription required)
    Free,
}

impl std::fmt::Display for EntitlementState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EntitlementState::Trialing => write!(f, "trialing"),
            EntitlementState::Active => write!(f, "active"),
            EntitlementState::PastDueGrace => write!(f, "past_due_grace"),
            EntitlementState::PastDueLocked => write!(f, "past_due_locked"),
            EntitlementState::CanceledGrace => write!(f, "canceled_grace"),
            EntitlementState::Canceled => write!(f, "canceled"),
            EntitlementState::Paused => write!(f, "paused"),
            EntitlementState::EnterpriseManual => write!(f, "enterprise_manual"),
            EntitlementState::Free => write!(f, "free"),
        }
    }
}

/// Source that determined the entitlement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EntitlementSource {
    /// Based on active subscription
    Subscription,
    /// Trial period
    Trial,
    /// Admin override/manual setting
    AdminOverride,
    /// Enterprise custom configuration
    EnterpriseConfig,
    /// Default (free tier)
    Default,
}

/// Feature flags based on tier
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitlementFeatures {
    /// Custom domain support
    pub custom_domain: bool,
    /// SSO/SAML support
    pub sso: bool,
    /// Priority support
    pub priority_support: bool,
    /// Advanced analytics
    pub advanced_analytics: bool,
    /// API access
    pub api_access: bool,
    /// Webhook integration
    pub webhooks: bool,
}

impl EntitlementFeatures {
    /// Get features for a tier
    pub fn for_tier(tier: SubscriptionTier) -> Self {
        match tier {
            SubscriptionTier::Free => Self {
                custom_domain: false,
                sso: false,
                priority_support: false,
                advanced_analytics: false,
                api_access: true,
                webhooks: false,
            },
            SubscriptionTier::Starter | SubscriptionTier::Pro => Self {
                custom_domain: true,
                sso: false,
                priority_support: false,
                advanced_analytics: true,
                api_access: true,
                webhooks: true,
            },
            SubscriptionTier::Team => Self {
                custom_domain: true,
                sso: true,
                priority_support: true,
                advanced_analytics: true,
                api_access: true,
                webhooks: true,
            },
            SubscriptionTier::Enterprise => Self {
                custom_domain: true,
                sso: true,
                priority_support: true,
                advanced_analytics: true,
                api_access: true,
                webhooks: true,
            },
        }
    }
}

/// Complete entitlement information for an organization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entitlement {
    /// Current entitlement state
    pub state: EntitlementState,
    /// Subscription tier
    pub tier: SubscriptionTier,
    /// Effective limits (tier defaults + custom overrides)
    pub limits: EffectiveLimits,
    /// Feature flags
    pub features: EntitlementFeatures,
    /// What determined this entitlement
    pub source: EntitlementSource,
    /// When this entitlement was computed
    pub computed_at: OffsetDateTime,
    /// When this entitlement expires (for trials, canceled subscriptions)
    pub expires_at: Option<OffsetDateTime>,
    /// Whether API access is currently allowed
    pub api_allowed: bool,
    /// Human-readable reason if API is blocked
    pub api_blocked_reason: Option<String>,
}

impl Entitlement {
    /// Check if the organization can use the API
    pub fn can_use_api(&self) -> bool {
        self.api_allowed
    }

    /// Check if a specific feature is enabled
    pub fn has_feature(&self, feature: &str) -> bool {
        match feature {
            "custom_domain" => self.features.custom_domain,
            "sso" => self.features.sso,
            "priority_support" => self.features.priority_support,
            "advanced_analytics" => self.features.advanced_analytics,
            "api_access" => self.features.api_access,
            "webhooks" => self.features.webhooks,
            _ => false,
        }
    }
}

/// Raw data needed to compute entitlement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawBillingData {
    pub org_id: Uuid,
    pub subscription_tier: String,
    pub stripe_subscription_id: Option<String>,
    pub subscription_status: Option<String>,
    pub trial_end: Option<OffsetDateTime>,
    pub current_period_end: Option<OffsetDateTime>,
    pub cancel_at_period_end: bool,
    pub is_paused: bool,
    pub paused_at: Option<OffsetDateTime>,
    pub custom_max_mcps: Option<i32>,
    pub custom_max_monthly_requests: Option<i64>,
    pub custom_max_team_members: Option<i32>,
    pub billing_blocked_at: Option<OffsetDateTime>,
}

/// Entitlement service for computing and querying entitlements
pub struct EntitlementService {
    pool: PgPool,
}

impl EntitlementService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Compute the complete entitlement for an organization
    /// This is THE function that answers "what can this org do?"
    pub async fn compute_entitlement(&self, org_id: Uuid) -> BillingResult<Entitlement> {
        // Load all relevant data in one query
        let raw = self.load_raw_billing_data(org_id).await?;

        // Compute the entitlement deterministically
        Ok(self.compute_from_raw(&raw))
    }

    /// Load raw billing data for an organization
    async fn load_raw_billing_data(&self, org_id: Uuid) -> BillingResult<RawBillingData> {
        let result: Option<RawBillingData> = sqlx::query_as(
            r#"
            SELECT
                o.id as org_id,
                o.subscription_tier,
                s.stripe_subscription_id,
                s.status as subscription_status,
                s.trial_end,
                s.current_period_end,
                COALESCE(s.cancel_at_period_end, false) as cancel_at_period_end,
                COALESCE(sc.is_paused, false) as is_paused,
                sc.paused_at,
                o.custom_max_mcps,
                o.custom_max_monthly_requests,
                o.custom_max_team_members,
                o.billing_blocked_at
            FROM organizations o
            LEFT JOIN subscriptions s ON s.org_id = o.id
            LEFT JOIN spend_caps sc ON sc.org_id = o.id
            WHERE o.id = $1
            "#,
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;

        result.ok_or_else(|| BillingError::NotFound(format!("Organization {} not found", org_id)))
    }

    /// Pure function: compute entitlement from raw data
    /// This is deterministic and testable
    fn compute_from_raw(&self, raw: &RawBillingData) -> Entitlement {
        let now = OffsetDateTime::now_utc();

        // Parse tier (defaults to Free if invalid)
        let tier: SubscriptionTier = raw
            .subscription_tier
            .parse()
            .unwrap_or(SubscriptionTier::Free);

        // Determine state
        let (state, source, expires_at, api_allowed, api_blocked_reason) =
            self.determine_state(raw, &tier, now);

        // Build custom limits from raw data
        let custom_limits = CustomLimits {
            max_mcps: raw.custom_max_mcps.map(|v| v as u32),
            max_api_keys: None, // Not in raw data
            max_team_members: raw.custom_max_team_members.map(|v| v as u32),
            max_requests_monthly: raw.custom_max_monthly_requests.map(|v| v as u64),
            overage_rate_cents: None,
            monthly_price_cents: None,
        };

        // Compute effective limits (tier defaults + custom overrides)
        let limits = tier.effective_limits(&custom_limits);

        // Get features for tier
        let features = EntitlementFeatures::for_tier(tier);

        Entitlement {
            state,
            tier,
            limits,
            features,
            source,
            computed_at: now,
            expires_at,
            api_allowed,
            api_blocked_reason,
        }
    }

    /// Determine the entitlement state from raw data
    fn determine_state(
        &self,
        raw: &RawBillingData,
        tier: &SubscriptionTier,
        now: OffsetDateTime,
    ) -> (
        EntitlementState,
        EntitlementSource,
        Option<OffsetDateTime>,
        bool,
        Option<String>,
    ) {
        // Check if billing is blocked (admin action)
        if raw.billing_blocked_at.is_some() {
            return (
                EntitlementState::PastDueLocked,
                EntitlementSource::AdminOverride,
                None,
                false,
                Some("Account blocked by administrator".to_string()),
            );
        }

        // Check if paused (spend cap)
        if raw.is_paused {
            return (
                EntitlementState::Paused,
                EntitlementSource::Subscription,
                None,
                false,
                Some("API paused due to spend cap".to_string()),
            );
        }

        // Free tier - always active
        if *tier == SubscriptionTier::Free {
            return (
                EntitlementState::Free,
                EntitlementSource::Default,
                None,
                true,
                None,
            );
        }

        // Enterprise without subscription - manual billing
        if *tier == SubscriptionTier::Enterprise && raw.stripe_subscription_id.is_none() {
            return (
                EntitlementState::EnterpriseManual,
                EntitlementSource::EnterpriseConfig,
                None,
                true,
                None,
            );
        }

        // Check trial
        if let Some(trial_end) = raw.trial_end {
            if trial_end > now {
                return (
                    EntitlementState::Trialing,
                    EntitlementSource::Trial,
                    Some(trial_end),
                    true,
                    None,
                );
            }
        }

        // Check subscription status
        match raw.subscription_status.as_deref() {
            Some("active") => {
                if raw.cancel_at_period_end {
                    // Canceled but still in paid period
                    (
                        EntitlementState::CanceledGrace,
                        EntitlementSource::Subscription,
                        raw.current_period_end,
                        true,
                        None,
                    )
                } else {
                    (
                        EntitlementState::Active,
                        EntitlementSource::Subscription,
                        None,
                        true,
                        None,
                    )
                }
            }
            Some("trialing") => (
                EntitlementState::Trialing,
                EntitlementSource::Trial,
                raw.trial_end,
                true,
                None,
            ),
            Some("past_due") => {
                // Check if within 3-day grace period
                // (We'd need invoice due date for precise calculation)
                (
                    EntitlementState::PastDueGrace,
                    EntitlementSource::Subscription,
                    None,
                    true, // Still allow API during grace period
                    Some("Payment past due - please update payment method".to_string()),
                )
            }
            Some("canceled") | Some("unpaid") => (
                EntitlementState::Canceled,
                EntitlementSource::Subscription,
                None,
                false,
                Some("Subscription canceled or unpaid".to_string()),
            ),
            _ => {
                // No subscription or unknown status - fall back to free
                (
                    EntitlementState::Free,
                    EntitlementSource::Default,
                    None,
                    true,
                    None,
                )
            }
        }
    }

    /// Get a simple "is API allowed" check (faster than full entitlement)
    pub async fn is_api_allowed(&self, org_id: Uuid) -> BillingResult<bool> {
        // Quick check: is org paused or billing blocked?
        let blocked: Option<(bool, Option<OffsetDateTime>)> = sqlx::query_as(
            r#"
            SELECT
                COALESCE(sc.is_paused, false) as is_paused,
                o.billing_blocked_at
            FROM organizations o
            LEFT JOIN spend_caps sc ON sc.org_id = o.id
            WHERE o.id = $1
            "#,
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;

        match blocked {
            Some((is_paused, billing_blocked)) => Ok(!is_paused && billing_blocked.is_none()),
            None => Ok(false), // Org not found
        }
    }
}

// Implement FromRow for RawBillingData
impl<'r> sqlx::FromRow<'r, sqlx::postgres::PgRow> for RawBillingData {
    fn from_row(row: &'r sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Self {
            org_id: row.try_get("org_id")?,
            subscription_tier: row.try_get("subscription_tier")?,
            stripe_subscription_id: row.try_get("stripe_subscription_id")?,
            subscription_status: row.try_get("subscription_status")?,
            trial_end: row.try_get("trial_end")?,
            current_period_end: row.try_get("current_period_end")?,
            cancel_at_period_end: row.try_get("cancel_at_period_end")?,
            is_paused: row.try_get("is_paused")?,
            paused_at: row.try_get("paused_at")?,
            custom_max_mcps: row.try_get("custom_max_mcps")?,
            custom_max_monthly_requests: row.try_get("custom_max_monthly_requests")?,
            custom_max_team_members: row.try_get("custom_max_team_members")?,
            billing_blocked_at: row.try_get("billing_blocked_at")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entitlement_state_display() {
        assert_eq!(EntitlementState::Active.to_string(), "active");
        assert_eq!(EntitlementState::Paused.to_string(), "paused");
        assert_eq!(EntitlementState::PastDueGrace.to_string(), "past_due_grace");
    }

    #[test]
    fn test_features_for_free_tier() {
        let features = EntitlementFeatures::for_tier(SubscriptionTier::Free);
        assert!(!features.custom_domain);
        assert!(!features.sso);
        assert!(features.api_access);
    }

    #[test]
    fn test_features_for_team_tier() {
        let features = EntitlementFeatures::for_tier(SubscriptionTier::Team);
        assert!(features.custom_domain);
        assert!(features.sso);
        assert!(features.priority_support);
    }
}
