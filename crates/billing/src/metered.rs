//! Metered billing service for Stripe usage-based pricing
//!
//! Reports overage usage to Stripe for Pro and Team tier subscriptions.
//! Usage is reported in units of 1,000 API calls over the included limit.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use stripe::{CreateUsageRecord, SubscriptionItemId, UsageRecord, UsageRecordAction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::client::StripeClient;
use crate::error::BillingResult;

/// Included API calls per tier (matching types.rs source of truth)
const PRO_INCLUDED_CALLS: i64 = 50_000;
const TEAM_INCLUDED_CALLS: i64 = 250_000; // Corrected: was 200_000

/// Result of a usage report operation
#[derive(Debug, Clone, Serialize)]
pub enum UsageReportResult {
    /// No overage - within included limits
    NoOverage {
        org_id: Uuid,
        total_usage: i64,
        included_limit: i64,
    },
    /// Usage was reported to Stripe
    Reported {
        org_id: Uuid,
        total_usage: i64,
        included_limit: i64,
        overage_units: i64,
    },
    /// Error during reporting
    Error { org_id: Uuid, error: String },
    /// Subscription has no metered item (Free or Enterprise tier)
    NoMeteredItem { org_id: Uuid },
}

/// Subscription with metered billing info
#[derive(Debug, Clone)]
pub struct MeteredSubscription {
    pub org_id: Uuid,
    pub subscription_id: Uuid,
    pub stripe_metered_item_id: String,
    pub tier: String,
    pub current_period_start: OffsetDateTime,
    pub current_period_end: OffsetDateTime,
}

/// Metered billing service for reporting usage to Stripe
#[derive(Clone)]
pub struct MeteredBillingService {
    stripe: StripeClient,
    pool: PgPool,
}

impl MeteredBillingService {
    pub fn new(stripe: StripeClient, pool: PgPool) -> Self {
        Self { stripe, pool }
    }

    /// Get all active subscriptions with metered items
    pub async fn get_metered_subscriptions(&self) -> BillingResult<Vec<MeteredSubscription>> {
        let rows: Vec<(Uuid, Uuid, String, String, OffsetDateTime, OffsetDateTime)> =
            sqlx::query_as(
                r#"
            SELECT
                s.org_id,
                s.id as subscription_id,
                s.stripe_metered_item_id,
                o.subscription_tier,
                s.current_period_start,
                s.current_period_end
            FROM subscriptions s
            JOIN organizations o ON s.org_id = o.id
            WHERE s.status = 'active'
              AND s.stripe_metered_item_id IS NOT NULL
              AND o.subscription_tier IN ('pro', 'team')
            "#,
            )
            .fetch_all(&self.pool)
            .await?;

        Ok(rows
            .into_iter()
            .map(
                |(org_id, subscription_id, metered_item_id, tier, start, end)| {
                    MeteredSubscription {
                        org_id,
                        subscription_id,
                        stripe_metered_item_id: metered_item_id,
                        tier,
                        current_period_start: start,
                        current_period_end: end,
                    }
                },
            )
            .collect())
    }

    /// Get total API calls for an organization in a billing period
    pub async fn get_period_usage(
        &self,
        org_id: Uuid,
        period_start: OffsetDateTime,
    ) -> BillingResult<i64> {
        // Truncate billing period start to day boundary since usage_records use daily periods
        // (e.g., billing period might start at 03:42:05, but usage records start at 00:00:00)
        let result: Option<(i64,)> = sqlx::query_as(
            r#"
            SELECT COALESCE(SUM(request_count), 0)::BIGINT as total
            FROM usage_records
            WHERE org_id = $1
              AND period_start >= date_trunc('day', $2::timestamptz)
            "#,
        )
        .bind(org_id)
        .bind(period_start)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result.map(|(t,)| t).unwrap_or(0))
    }

    /// Get included call limit for a tier
    fn get_included_limit(&self, tier: &str) -> i64 {
        match tier {
            "pro" => PRO_INCLUDED_CALLS,
            "team" => TEAM_INCLUDED_CALLS,
            _ => 0,
        }
    }

    /// Report usage for a single organization to Stripe
    pub async fn report_usage_for_subscription(
        &self,
        subscription: &MeteredSubscription,
    ) -> UsageReportResult {
        // Get total usage for the billing period
        let total_usage = match self
            .get_period_usage(subscription.org_id, subscription.current_period_start)
            .await
        {
            Ok(usage) => usage,
            Err(e) => {
                return UsageReportResult::Error {
                    org_id: subscription.org_id,
                    error: format!("Failed to get usage: {}", e),
                };
            }
        };

        let included_limit = self.get_included_limit(&subscription.tier);
        let overage_calls = (total_usage - included_limit).max(0);

        // Calculate overage units (1 unit = 1,000 calls)
        // Use ceiling division to ensure we charge for partial units
        let overage_units = if overage_calls > 0 {
            (overage_calls + 999) / 1000 // Ceiling division
        } else {
            0
        };

        // If no overage, still report 0 to reset any previous values
        let item_id = match subscription
            .stripe_metered_item_id
            .parse::<SubscriptionItemId>()
        {
            Ok(id) => id,
            Err(e) => {
                return UsageReportResult::Error {
                    org_id: subscription.org_id,
                    error: format!("Invalid metered item ID: {}", e),
                };
            }
        };

        // Report to Stripe - use Set action to set the absolute value
        let params = CreateUsageRecord {
            quantity: overage_units as u64,
            action: Some(UsageRecordAction::Set),
            timestamp: Some(OffsetDateTime::now_utc().unix_timestamp()),
        };

        match UsageRecord::create(self.stripe.inner(), &item_id, params).await {
            Ok(_record) => {
                // Store the report in our database for audit trail
                if let Err(e) = self
                    .store_usage_report(subscription, total_usage, included_limit, overage_units)
                    .await
                {
                    tracing::warn!(
                        org_id = %subscription.org_id,
                        error = %e,
                        "Failed to store usage report record"
                    );
                }

                if overage_units > 0 {
                    tracing::info!(
                        org_id = %subscription.org_id,
                        total_usage = %total_usage,
                        overage_units = %overage_units,
                        "Reported overage usage to Stripe"
                    );
                    UsageReportResult::Reported {
                        org_id: subscription.org_id,
                        total_usage,
                        included_limit,
                        overage_units,
                    }
                } else {
                    UsageReportResult::NoOverage {
                        org_id: subscription.org_id,
                        total_usage,
                        included_limit,
                    }
                }
            }
            Err(e) => {
                tracing::error!(
                    org_id = %subscription.org_id,
                    error = %e,
                    "Failed to report usage to Stripe"
                );
                UsageReportResult::Error {
                    org_id: subscription.org_id,
                    error: format!("Stripe API error: {}", e),
                }
            }
        }
    }

    /// Store a usage report record for audit trail
    async fn store_usage_report(
        &self,
        subscription: &MeteredSubscription,
        total_usage: i64,
        included_limit: i64,
        overage_units: i64,
    ) -> BillingResult<()> {
        sqlx::query(
            r#"
            INSERT INTO stripe_usage_reports (
                org_id, subscription_id, metered_item_id,
                period_start, period_end, total_usage,
                included_limit, overage_units
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(subscription.org_id)
        .bind(subscription.subscription_id)
        .bind(&subscription.stripe_metered_item_id)
        .bind(subscription.current_period_start)
        .bind(subscription.current_period_end)
        .bind(total_usage)
        .bind(included_limit)
        .bind(overage_units)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Report usage for all active metered subscriptions
    pub async fn report_all_usage(&self) -> Vec<UsageReportResult> {
        let subscriptions = match self.get_metered_subscriptions().await {
            Ok(subs) => subs,
            Err(e) => {
                tracing::error!(error = %e, "Failed to get metered subscriptions");
                return vec![];
            }
        };

        tracing::info!(
            count = subscriptions.len(),
            "Starting usage report for metered subscriptions"
        );

        let mut results = Vec::with_capacity(subscriptions.len());

        for subscription in subscriptions {
            let result = self.report_usage_for_subscription(&subscription).await;
            results.push(result);
        }

        // Log summary
        let reported_count = results
            .iter()
            .filter(|r| matches!(r, UsageReportResult::Reported { .. }))
            .count();
        let no_overage_count = results
            .iter()
            .filter(|r| matches!(r, UsageReportResult::NoOverage { .. }))
            .count();
        let error_count = results
            .iter()
            .filter(|r| matches!(r, UsageReportResult::Error { .. }))
            .count();

        tracing::info!(
            reported = reported_count,
            no_overage = no_overage_count,
            errors = error_count,
            "Completed usage report cycle"
        );

        results
    }

    /// Get metered price ID for a tier from environment variables
    pub fn get_metered_price_id(tier: &str) -> Option<String> {
        match tier {
            "pro" => std::env::var("STRIPE_METERED_PRICE_PRO").ok(),
            "team" => std::env::var("STRIPE_METERED_PRICE_TEAM").ok(),
            _ => None,
        }
    }

    /// Check if a tier supports metered billing
    pub fn tier_supports_metered(tier: &str) -> bool {
        matches!(tier, "pro" | "team")
    }
}

/// Request to manually trigger usage reporting (for admin/testing)
#[derive(Debug, Deserialize)]
pub struct TriggerUsageReportRequest {
    pub org_id: Option<Uuid>,
}

/// Response from usage reporting
#[derive(Debug, Serialize)]
pub struct UsageReportResponse {
    pub results: Vec<UsageReportResult>,
    pub total_processed: usize,
    pub total_reported: usize,
    pub total_errors: usize,
}
