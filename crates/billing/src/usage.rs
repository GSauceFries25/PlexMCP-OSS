//! Usage metering service
//!
//! Tracks API requests, enforces tier limits, and provides usage analytics.

use plexmcp_shared::SubscriptionTier;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::{BillingError, BillingResult};

/// Individual usage event for recording
#[derive(Debug, Clone)]
pub struct UsageEvent {
    pub org_id: Uuid,
    pub api_key_id: Option<Uuid>,
    pub mcp_instance_id: Option<Uuid>,
    pub request_count: i32,
    pub token_count: i32,
    pub error_count: i32,
    pub latency_ms: Option<i32>,
}

/// Usage summary for a period
#[derive(Debug, Clone)]
pub struct UsageSummary {
    pub org_id: Uuid,
    pub period_start: OffsetDateTime,
    pub period_end: OffsetDateTime,
    pub total_requests: i64,
    pub total_tokens: i64,
    pub total_errors: i64,
    pub avg_latency_ms: Option<i32>,
}

/// Current billing period usage
#[derive(Debug, Clone)]
pub struct BillingPeriodUsage {
    pub org_id: Uuid,
    pub tier: SubscriptionTier,
    pub period_start: OffsetDateTime,
    pub period_end: OffsetDateTime,
    pub requests_used: i64,
    pub requests_limit: u64,
    pub percentage_used: f64,
    pub is_over_limit: bool,
}

/// Usage metering service
#[derive(Clone)]
pub struct UsageMeter {
    pool: PgPool,
}

impl UsageMeter {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Record a usage event
    pub async fn record_event(&self, event: UsageEvent) -> BillingResult<()> {
        let now = OffsetDateTime::now_utc();
        let period_start = now.replace_time(time::Time::MIDNIGHT);
        let period_end = period_start + Duration::days(1);

        sqlx::query(
            r#"
            INSERT INTO usage_records (
                id, org_id, api_key_id, mcp_instance_id, request_count,
                token_count, error_count, latency_ms_avg, period_start, period_end
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            )
            "#
        )
        .bind(Uuid::new_v4())
        .bind(event.org_id)
        .bind(event.api_key_id)
        .bind(event.mcp_instance_id)
        .bind(event.request_count)
        .bind(event.token_count)
        .bind(event.error_count)
        .bind(event.latency_ms)
        .bind(period_start)
        .bind(period_end)
        .execute(&self.pool)
        .await?;

        // Also update the API key's request count if provided
        if let Some(api_key_id) = event.api_key_id {
            sqlx::query(
                "UPDATE api_keys SET request_count = request_count + $1, last_used_at = NOW() WHERE id = $2"
            )
            .bind(event.request_count as i64)
            .bind(api_key_id)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    /// Record a batch of usage events efficiently
    ///
    /// Uses a transaction with a timeout to prevent lock contention issues.
    /// Default timeout is 30 seconds (configurable via USAGE_BATCH_TIMEOUT_MS).
    pub async fn record_events(&self, events: Vec<UsageEvent>) -> BillingResult<()> {
        if events.is_empty() {
            return Ok(());
        }

        let now = OffsetDateTime::now_utc();
        let period_start = now.replace_time(time::Time::MIDNIGHT);
        let period_end = period_start + Duration::days(1);

        // Get configurable timeout (default 30 seconds)
        let timeout_ms: i32 = std::env::var("USAGE_BATCH_TIMEOUT_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30_000);

        // Use a transaction for batch insert with timeout
        let mut tx = self.pool.begin().await?;

        // Set statement timeout for this transaction to prevent lock contention
        sqlx::query(&format!("SET LOCAL statement_timeout = {}", timeout_ms))
            .execute(&mut *tx)
            .await?;

        for event in &events {
            sqlx::query(
                r#"
                INSERT INTO usage_records (
                    id, org_id, api_key_id, mcp_instance_id, request_count,
                    token_count, error_count, latency_ms_avg, period_start, period_end
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                )
                "#
            )
            .bind(Uuid::new_v4())
            .bind(event.org_id)
            .bind(event.api_key_id)
            .bind(event.mcp_instance_id)
            .bind(event.request_count)
            .bind(event.token_count)
            .bind(event.error_count)
            .bind(event.latency_ms)
            .bind(period_start)
            .bind(period_end)
            .execute(&mut *tx)
            .await?;

            // Update API key request count
            if let Some(api_key_id) = event.api_key_id {
                sqlx::query(
                    "UPDATE api_keys SET request_count = request_count + $1, last_used_at = NOW() WHERE id = $2"
                )
                .bind(event.request_count as i64)
                .bind(api_key_id)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    /// Get usage summary for a period
    pub async fn get_usage_summary(
        &self,
        org_id: Uuid,
        start: OffsetDateTime,
        end: OffsetDateTime,
    ) -> BillingResult<UsageSummary> {
        tracing::info!(
            org_id = %org_id,
            start = %start,
            end = %end,
            "UsageMeter::get_usage_summary: querying database"
        );

        // Query for records where period_start falls within our date range
        // Note: period_end is typically midnight of the next day (for daily records),
        // so we only check period_start to find records in our billing period
        let result: (i64, i64, i64, Option<f64>) = sqlx::query_as(
            r#"
            SELECT
                COALESCE(SUM(request_count), 0)::BIGINT as total_requests,
                COALESCE(SUM(token_count), 0)::BIGINT as total_tokens,
                COALESCE(SUM(error_count), 0)::BIGINT as total_errors,
                AVG(latency_ms_avg)::FLOAT8 as avg_latency
            FROM usage_records
            WHERE org_id = $1
              AND period_start >= $2
              AND period_start < $3
            "#
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_one(&self.pool)
        .await?;

        tracing::info!(
            org_id = %org_id,
            total_requests = result.0,
            "UsageMeter::get_usage_summary: query returned"
        );

        Ok(UsageSummary {
            org_id,
            period_start: start,
            period_end: end,
            total_requests: result.0,
            total_tokens: result.1,
            total_errors: result.2,
            avg_latency_ms: result.3.map(|v| v as i32),
        })
    }

    /// Get current month's usage for billing
    pub async fn get_billing_period_usage(&self, org_id: Uuid) -> BillingResult<BillingPeriodUsage> {
        // Get current billing period (first of month to now)
        let now = OffsetDateTime::now_utc();
        let period_start = now.replace_day(1)
            .map_err(|e| BillingError::Database(format!("Failed to set billing period start: {}", e)))?
            .replace_time(time::Time::MIDNIGHT);
        let period_end = now;

        tracing::info!(
            org_id = %org_id,
            period_start = %period_start,
            period_end = %period_end,
            "get_billing_period_usage: querying usage"
        );

        // Get org's subscription tier
        let tier_result: Option<(String,)> = sqlx::query_as(
            "SELECT subscription_tier FROM organizations WHERE id = $1"
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;

        let tier: SubscriptionTier = tier_result
            .map(|(t,)| t.parse().unwrap_or(SubscriptionTier::Free))
            .unwrap_or(SubscriptionTier::Free);

        tracing::info!(
            org_id = %org_id,
            tier = %tier,
            "get_billing_period_usage: found tier"
        );

        // Get usage for the period
        let summary = self.get_usage_summary(org_id, period_start, period_end).await?;

        tracing::info!(
            org_id = %org_id,
            total_requests = summary.total_requests,
            "get_billing_period_usage: found usage summary"
        );

        let requests_limit = tier.monthly_requests();
        let requests_used = summary.total_requests;
        let percentage_used = if requests_limit == u64::MAX {
            0.0
        } else {
            (requests_used as f64 / requests_limit as f64) * 100.0
        };

        Ok(BillingPeriodUsage {
            org_id,
            tier,
            period_start,
            period_end,
            requests_used,
            requests_limit,
            percentage_used,
            is_over_limit: requests_used as u64 >= requests_limit,
        })
    }

    /// Check if org is within their usage limits
    pub async fn check_usage_limit(&self, org_id: Uuid) -> BillingResult<bool> {
        let usage = self.get_billing_period_usage(org_id).await?;
        Ok(!usage.is_over_limit)
    }

    /// Get total requests for a specific period (for overage calculation)
    pub async fn get_total_requests_for_period(
        &self,
        org_id: Uuid,
        start: OffsetDateTime,
        end: OffsetDateTime,
    ) -> BillingResult<u64> {
        // Query for records where period_start falls within our date range
        let result: Option<(i64,)> = sqlx::query_as(
            r#"
            SELECT COALESCE(SUM(request_count), 0)::BIGINT as total
            FROM usage_records
            WHERE org_id = $1
              AND period_start >= $2
              AND period_start < $3
            "#
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result.map(|(t,)| t as u64).unwrap_or(0))
    }

    /// Get usage breakdown by API key
    pub async fn get_usage_by_api_key(
        &self,
        org_id: Uuid,
        start: OffsetDateTime,
        end: OffsetDateTime,
    ) -> BillingResult<Vec<ApiKeyUsageBreakdown>> {
        let results: Vec<(Uuid, String, i64, i64)> = sqlx::query_as(
            r#"
            SELECT
                ur.api_key_id,
                COALESCE(ak.name, 'Unknown') as key_name,
                COALESCE(SUM(ur.request_count), 0)::BIGINT as request_count,
                COALESCE(SUM(ur.token_count), 0)::BIGINT as token_count
            FROM usage_records ur
            LEFT JOIN api_keys ak ON ur.api_key_id = ak.id
            WHERE ur.org_id = $1
              AND ur.period_start >= $2
              AND ur.period_start < $3
              AND ur.api_key_id IS NOT NULL
            GROUP BY ur.api_key_id, ak.name
            ORDER BY request_count DESC
            "#
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await?;

        Ok(results.into_iter().map(|(id, name, requests, tokens)| {
            ApiKeyUsageBreakdown {
                api_key_id: id,
                api_key_name: name,
                request_count: requests,
                token_count: tokens,
            }
        }).collect())
    }

    /// Get usage breakdown by MCP instance
    pub async fn get_usage_by_mcp(
        &self,
        org_id: Uuid,
        start: OffsetDateTime,
        end: OffsetDateTime,
    ) -> BillingResult<Vec<McpUsageBreakdown>> {
        let results: Vec<(Uuid, String, i64, i64, i64, Option<i32>)> = sqlx::query_as(
            r#"
            SELECT
                ur.mcp_instance_id,
                COALESCE(mi.name, 'Unknown') as mcp_name,
                COALESCE(SUM(ur.request_count), 0)::BIGINT as request_count,
                COALESCE(SUM(ur.token_count), 0)::BIGINT as token_count,
                COALESCE(logs.error_count, 0)::BIGINT as error_count,
                logs.avg_latency_ms::INT as avg_latency_ms
            FROM usage_records ur
            LEFT JOIN mcp_instances mi ON ur.mcp_instance_id = mi.id
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE mpl.status != 'success') as error_count,
                    AVG(mpl.latency_ms)::INT as avg_latency_ms
                FROM mcp_proxy_logs mpl
                JOIN api_keys ak ON mpl.api_key_id = ak.id
                WHERE mpl.mcp_id = ur.mcp_instance_id
                  AND ak.org_id = $1
                  AND mpl.created_at >= $2
                  AND mpl.created_at < $3
            ) logs ON true
            WHERE ur.org_id = $1
              AND ur.period_start >= $2
              AND ur.period_start < $3
              AND ur.mcp_instance_id IS NOT NULL
            GROUP BY ur.mcp_instance_id, mi.name, logs.error_count, logs.avg_latency_ms
            ORDER BY request_count DESC
            "#
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await?;

        Ok(results.into_iter().map(|(id, name, requests, tokens, errors, latency)| {
            McpUsageBreakdown {
                mcp_instance_id: id,
                mcp_name: name,
                request_count: requests,
                token_count: tokens,
                error_count: errors,
                avg_latency_ms: latency,
            }
        }).collect())
    }

    /// Get hourly usage for charts
    pub async fn get_hourly_usage(
        &self,
        org_id: Uuid,
        start: OffsetDateTime,
        end: OffsetDateTime,
    ) -> BillingResult<Vec<HourlyUsage>> {
        let results: Vec<(OffsetDateTime, i64, i64, i64)> = sqlx::query_as(
            r#"
            SELECT
                period_hour,
                total_requests,
                total_tokens,
                total_errors
            FROM usage_aggregates
            WHERE org_id = $1
              AND period_hour >= $2
              AND period_hour <= $3
            ORDER BY period_hour ASC
            "#
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await?;

        Ok(results.into_iter().map(|(hour, requests, tokens, errors)| {
            HourlyUsage {
                hour,
                requests,
                tokens,
                errors,
            }
        }).collect())
    }

    /// Aggregate usage records into hourly rollups (run periodically)
    pub async fn aggregate_hourly(&self, org_id: Uuid, hour: OffsetDateTime) -> BillingResult<()> {
        let hour_time = time::Time::from_hms(hour.hour(), 0, 0)
            .map_err(|e| BillingError::Database(format!("Failed to create hour time: {}", e)))?;
        let hour_start = hour.replace_time(hour_time);
        let hour_end = hour_start + Duration::hours(1);

        // Aggregate from usage_records
        let result: (i64, i64, i64, Option<f64>, i64, i64) = sqlx::query_as(
            r#"
            SELECT
                COALESCE(SUM(request_count), 0)::BIGINT,
                COALESCE(SUM(token_count), 0)::BIGINT,
                COALESCE(SUM(error_count), 0)::BIGINT,
                AVG(latency_ms_avg)::FLOAT8,
                COUNT(DISTINCT api_key_id)::BIGINT,
                COUNT(DISTINCT mcp_instance_id)::BIGINT
            FROM usage_records
            WHERE org_id = $1
              AND period_start >= $2
              AND period_start < $3
            "#
        )
        .bind(org_id)
        .bind(hour_start)
        .bind(hour_end)
        .fetch_one(&self.pool)
        .await?;

        // Upsert into usage_aggregates
        sqlx::query(
            r#"
            INSERT INTO usage_aggregates (
                id, org_id, period_hour, total_requests, total_tokens,
                total_errors, avg_latency_ms, unique_api_keys, unique_mcps
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9
            )
            ON CONFLICT (org_id, period_hour) DO UPDATE SET
                total_requests = EXCLUDED.total_requests,
                total_tokens = EXCLUDED.total_tokens,
                total_errors = EXCLUDED.total_errors,
                avg_latency_ms = EXCLUDED.avg_latency_ms,
                unique_api_keys = EXCLUDED.unique_api_keys,
                unique_mcps = EXCLUDED.unique_mcps
            "#
        )
        .bind(Uuid::new_v4())
        .bind(org_id)
        .bind(hour_start)
        .bind(result.0)
        .bind(result.1)
        .bind(result.2)
        .bind(result.3.map(|v| v as i32))
        .bind(result.4 as i32)
        .bind(result.5 as i32)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Aggregate all recent usage for all orgs (run hourly by background task)
    /// SOC 2 Note: This populates analytics aggregates only, does not modify usage_records audit trail
    pub async fn aggregate_all_recent(&self) -> BillingResult<usize> {
        // Get all org/hour combinations with usage in the last 2 hours
        let orgs_with_hours: Vec<(Uuid, OffsetDateTime)> = sqlx::query_as(
            r#"
            SELECT DISTINCT org_id, date_trunc('hour', period_start) as hour
            FROM usage_records
            WHERE period_start >= NOW() - INTERVAL '2 hours'
            "#
        )
        .fetch_all(&self.pool)
        .await?;

        let count = orgs_with_hours.len();
        for (org_id, hour) in orgs_with_hours {
            if let Err(e) = self.aggregate_hourly(org_id, hour).await {
                tracing::error!(org_id = %org_id, hour = %hour, "Aggregation failed: {}", e);
                // Continue with other orgs - don't fail entire batch
            }
        }

        tracing::info!(aggregated_count = count, "Completed hourly usage aggregation");
        Ok(count)
    }
}

/// Usage breakdown by API key
#[derive(Debug, Clone)]
pub struct ApiKeyUsageBreakdown {
    pub api_key_id: Uuid,
    pub api_key_name: String,
    pub request_count: i64,
    pub token_count: i64,
}

/// Usage breakdown by MCP instance
#[derive(Debug, Clone)]
pub struct McpUsageBreakdown {
    pub mcp_instance_id: Uuid,
    pub mcp_name: String,
    pub request_count: i64,
    pub token_count: i64,
    pub error_count: i64,
    pub avg_latency_ms: Option<i32>,
}

/// Hourly usage data point
#[derive(Debug, Clone)]
pub struct HourlyUsage {
    pub hour: OffsetDateTime,
    pub requests: i64,
    pub tokens: i64,
    pub errors: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subscription_tier_limits() {
        // Current tier structure: Free → Pro → Team → Enterprise
        // Starter is a legacy tier with same limits as Free
        assert_eq!(SubscriptionTier::Free.monthly_requests(), 1_000);
        assert_eq!(SubscriptionTier::Starter.monthly_requests(), 1_000); // Legacy tier
        assert_eq!(SubscriptionTier::Pro.monthly_requests(), 50_000);
        assert_eq!(SubscriptionTier::Team.monthly_requests(), 250_000);
        assert_eq!(SubscriptionTier::Enterprise.monthly_requests(), u64::MAX);
    }
}
