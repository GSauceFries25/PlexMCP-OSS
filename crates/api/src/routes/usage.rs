//! Usage tracking API routes

use axum::{
    extract::{Extension, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{auth::AuthUser, error::ApiError, state::AppState};

/// Usage summary response
#[derive(Debug, Serialize)]
pub struct UsageSummaryResponse {
    pub org_id: Uuid,
    pub period_start: String,
    pub period_end: String,
    pub total_requests: i64,
    pub total_tokens: i64,
    pub total_errors: i64,
    pub avg_latency_ms: Option<i32>,
}

/// Billing period usage response
#[derive(Debug, Serialize)]
pub struct BillingUsageResponse {
    pub org_id: Uuid,
    pub tier: String,
    pub period_start: String,
    pub period_end: String,
    pub requests_used: i64,
    pub requests_limit: u64,
    pub percentage_used: f64,
    pub is_over_limit: bool,
}

/// Query params for usage summary
#[derive(Debug, Deserialize)]
pub struct UsagePeriodQuery {
    pub start: Option<String>,
    pub end: Option<String>,
}

/// API key usage breakdown
#[derive(Debug, Serialize)]
pub struct ApiKeyUsageItem {
    pub api_key_id: Uuid,
    pub api_key_name: String,
    pub request_count: i64,
    pub token_count: i64,
}

/// MCP usage breakdown
#[derive(Debug, Serialize)]
pub struct McpUsageItem {
    pub mcp_instance_id: Uuid,
    pub mcp_name: String,
    pub request_count: i64,
    pub token_count: i64,
    pub error_count: i64,
    pub avg_latency_ms: Option<i32>,
}

/// Hourly usage data point
#[derive(Debug, Serialize)]
pub struct HourlyUsageItem {
    pub hour: String,
    pub requests: i64,
    pub tokens: i64,
    pub errors: i64,
}

/// Get current billing period usage
pub async fn get_billing_usage(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<BillingUsageResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    tracing::info!(
        org_id = %org_id,
        "get_billing_usage called"
    );

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let usage = billing
        .usage
        .get_billing_period_usage(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get billing usage: {}", e)))?;

    tracing::info!(
        org_id = %org_id,
        requests_used = usage.requests_used,
        requests_limit = usage.requests_limit,
        tier = %usage.tier,
        period_start = %usage.period_start,
        period_end = %usage.period_end,
        "get_billing_usage result"
    );

    Ok(Json(BillingUsageResponse {
        org_id: usage.org_id,
        tier: usage.tier.to_string(),
        period_start: format_datetime(usage.period_start),
        period_end: format_datetime(usage.period_end),
        requests_used: usage.requests_used,
        requests_limit: usage.requests_limit,
        percentage_used: usage.percentage_used,
        is_over_limit: usage.is_over_limit,
    }))
}

/// Get usage summary for a period
pub async fn get_usage_summary(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<UsagePeriodQuery>,
) -> Result<Json<UsageSummaryResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    tracing::info!(
        org_id = %org_id,
        "get_usage_summary: starting"
    );

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    // Default to current month if not specified
    let now = OffsetDateTime::now_utc();
    let default_start = now
        .replace_day(1)
        .map_err(|e| ApiError::Database(format!("Failed to set start date: {}", e)))?
        .replace_time(time::Time::MIDNIGHT);

    let start = query
        .start
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(default_start);
    let end = query
        .end
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(now);

    tracing::info!(
        org_id = %org_id,
        start = %start,
        end = %end,
        "get_usage_summary: querying with date range"
    );

    let summary = billing
        .usage
        .get_usage_summary(org_id, start, end)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get usage summary: {}", e)))?;

    tracing::info!(
        org_id = %org_id,
        total_requests = summary.total_requests,
        "get_usage_summary: got result"
    );

    Ok(Json(UsageSummaryResponse {
        org_id: summary.org_id,
        period_start: format_datetime(summary.period_start),
        period_end: format_datetime(summary.period_end),
        total_requests: summary.total_requests,
        total_tokens: summary.total_tokens,
        total_errors: summary.total_errors,
        avg_latency_ms: summary.avg_latency_ms,
    }))
}

/// Get usage breakdown by API key
pub async fn get_usage_by_api_key(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<UsagePeriodQuery>,
) -> Result<Json<Vec<ApiKeyUsageItem>>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    // Default to current month
    let now = OffsetDateTime::now_utc();
    let default_start = now
        .replace_day(1)
        .map_err(|e| ApiError::Database(format!("Failed to set start date: {}", e)))?
        .replace_time(time::Time::MIDNIGHT);

    let start = query
        .start
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(default_start);
    let end = query
        .end
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(now);

    let breakdown = billing
        .usage
        .get_usage_by_api_key(org_id, start, end)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get API key usage: {}", e)))?;

    Ok(Json(
        breakdown
            .into_iter()
            .map(|item| ApiKeyUsageItem {
                api_key_id: item.api_key_id,
                api_key_name: item.api_key_name,
                request_count: item.request_count,
                token_count: item.token_count,
            })
            .collect(),
    ))
}

/// Get usage breakdown by MCP instance
pub async fn get_usage_by_mcp(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<UsagePeriodQuery>,
) -> Result<Json<Vec<McpUsageItem>>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    // Default to current month
    let now = OffsetDateTime::now_utc();
    let default_start = now
        .replace_day(1)
        .map_err(|e| ApiError::Database(format!("Failed to set start date: {}", e)))?
        .replace_time(time::Time::MIDNIGHT);

    let start = query
        .start
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(default_start);
    let end = query
        .end
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(now);

    let breakdown = billing
        .usage
        .get_usage_by_mcp(org_id, start, end)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get MCP usage: {}", e)))?;

    Ok(Json(
        breakdown
            .into_iter()
            .map(|item| McpUsageItem {
                mcp_instance_id: item.mcp_instance_id,
                mcp_name: item.mcp_name,
                request_count: item.request_count,
                token_count: item.token_count,
                error_count: item.error_count,
                avg_latency_ms: item.avg_latency_ms,
            })
            .collect(),
    ))
}

/// Get hourly usage data for charts
pub async fn get_hourly_usage(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<UsagePeriodQuery>,
) -> Result<Json<Vec<HourlyUsageItem>>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    // Default to last 24 hours
    let now = OffsetDateTime::now_utc();
    let start = query
        .start
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or_else(|| now - time::Duration::hours(24));
    let end = query
        .end
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(now);

    let hourly = billing
        .usage
        .get_hourly_usage(org_id, start, end)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get hourly usage: {}", e)))?;

    Ok(Json(
        hourly
            .into_iter()
            .map(|item| HourlyUsageItem {
                hour: format_datetime(item.hour),
                requests: item.requests,
                tokens: item.tokens,
                errors: item.errors,
            })
            .collect(),
    ))
}

/// Check if current usage is within limits
pub async fn check_usage_limit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<UsageLimitCheck>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let within_limit = billing
        .usage
        .check_usage_limit(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to check usage limit: {}", e)))?;

    Ok(Json(UsageLimitCheck { within_limit }))
}

#[derive(Debug, Serialize)]
pub struct UsageLimitCheck {
    pub within_limit: bool,
}

/// Effective limits response with base tier + add-on boosts
#[derive(Debug, Serialize)]
pub struct EffectiveLimitsResponse {
    pub tier: String,
    /// Base monthly requests from tier
    pub base_requests: u64,
    /// Extra requests from add-ons
    pub addon_requests: u64,
    /// Total effective monthly request limit
    pub effective_requests: u64,
    /// Base MCP limit from tier
    pub base_mcps: u32,
    /// Extra MCPs from add-ons
    pub addon_mcps: u32,
    /// Total effective MCP limit
    pub effective_mcps: u32,
    /// Base API key limit from tier
    pub base_api_keys: u32,
    /// Extra API keys from add-ons
    pub addon_api_keys: u32,
    /// Total effective API key limit
    pub effective_api_keys: u32,
    /// Base team member limit from tier
    pub base_team_members: u32,
    /// Extra team members from add-ons
    pub addon_team_members: u32,
    /// Total effective team member limit
    pub effective_team_members: u32,
    /// Whether this tier has unlimited resources (Team/Enterprise)
    pub is_unlimited: bool,
    /// Add-on quantities purchased
    pub addon_quantities: AddonQuantitiesResponse,
}

/// Add-on quantities breakdown
#[derive(Debug, Serialize)]
pub struct AddonQuantitiesResponse {
    pub extra_requests: u32,
    pub extra_mcps: u32,
    pub extra_api_keys: u32,
    pub extra_team_members: u32,
}

/// Get effective limits including add-on boosts
pub async fn get_effective_limits(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<EffectiveLimitsResponse>, ApiError> {
    let org_id = auth_user
        .org_id
        .or(auth_user.user_id)
        .ok_or(ApiError::NoOrganization)?;

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    // Get the org's subscription tier
    let tier_result: Option<(String,)> = sqlx::query_as(
        "SELECT COALESCE(subscription_tier, 'free') as tier FROM organizations
         WHERE id = $1
         LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Database error: {}", e)))?;

    let tier_str = tier_result
        .map(|(t,)| t)
        .unwrap_or_else(|| "free".to_string());
    let tier: plexmcp_shared::SubscriptionTier = tier_str
        .parse()
        .unwrap_or(plexmcp_shared::SubscriptionTier::Free);

    // Get add-on quantities
    let addon_service = plexmcp_billing::AddonService::new(
        billing.subscriptions.stripe().clone(),
        state.pool.clone(),
    );

    let quantities = addon_service
        .get_addon_quantities(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get addon quantities: {}", e)))?;

    // Calculate effective limits
    let is_unlimited = matches!(
        tier,
        plexmcp_shared::SubscriptionTier::Team | plexmcp_shared::SubscriptionTier::Enterprise
    );

    let base_requests = tier.monthly_requests();
    // NOTE: Request pack addons are deprecated (Dec 2024) - only custom_domain addon is active
    // Setting addon_requests to 0 to prevent showing inflated limits from deprecated addons
    let addon_requests = 0u64;
    let effective_requests = if base_requests == u64::MAX {
        u64::MAX
    } else {
        base_requests + addon_requests
    };

    let base_mcps = tier.max_mcps();
    let addon_mcps = quantities.extra_mcps * 5;
    let effective_mcps = if base_mcps == u32::MAX {
        u32::MAX
    } else {
        base_mcps + addon_mcps
    };

    let base_api_keys = tier.max_api_keys();
    let addon_api_keys = quantities.extra_api_keys * 5;
    let effective_api_keys = if base_api_keys == u32::MAX {
        u32::MAX
    } else {
        base_api_keys + addon_api_keys
    };

    let base_team_members = tier.max_team_members();
    let addon_team_members = quantities.extra_team_members * 3;
    let effective_team_members = if base_team_members == u32::MAX {
        u32::MAX
    } else {
        base_team_members + addon_team_members
    };

    Ok(Json(EffectiveLimitsResponse {
        tier: tier.to_string(),
        base_requests,
        addon_requests,
        effective_requests,
        base_mcps,
        addon_mcps,
        effective_mcps,
        base_api_keys,
        addon_api_keys,
        effective_api_keys,
        base_team_members,
        addon_team_members,
        effective_team_members,
        is_unlimited,
        addon_quantities: AddonQuantitiesResponse {
            extra_requests: quantities.extra_requests,
            extra_mcps: quantities.extra_mcps,
            extra_api_keys: quantities.extra_api_keys,
            extra_team_members: quantities.extra_team_members,
        },
    }))
}

/// Helper to format datetime as RFC3339
fn format_datetime(dt: OffsetDateTime) -> String {
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| dt.to_string())
}

/// Recent error entry from proxy logs
#[derive(Debug, Serialize)]
pub struct RecentErrorItem {
    pub id: Uuid,
    pub method: String,
    pub tool_name: Option<String>,
    pub resource_uri: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub latency_ms: Option<i32>,
    pub created_at: String,
}

/// Query params for errors endpoint
#[derive(Debug, Deserialize)]
pub struct ErrorsQuery {
    pub limit: Option<i64>,
    pub start: Option<String>,
    pub end: Option<String>,
}

/// Get recent errors from proxy logs
pub async fn get_recent_errors(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<ErrorsQuery>,
) -> Result<Json<Vec<RecentErrorItem>>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let limit = query.limit.unwrap_or(10).min(100);

    // Default to last 7 days if not specified
    let now = OffsetDateTime::now_utc();
    let start = query
        .start
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or_else(|| now - time::Duration::days(7));
    let end = query
        .end
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(now);

    // Query errors from mcp_proxy_logs for this org's API keys
    #[allow(clippy::type_complexity)]
    let errors: Vec<(
        Uuid,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<i32>,
        OffsetDateTime,
    )> = sqlx::query_as(
        r#"
        SELECT
            pl.id,
            pl.method,
            pl.tool_name,
            pl.resource_uri,
            pl.status,
            pl.error_message,
            pl.latency_ms,
            pl.created_at
        FROM mcp_proxy_logs pl
        JOIN api_keys ak ON pl.api_key_id = ak.id
        WHERE ak.org_id = $1
          AND pl.status = 'error'
          AND pl.created_at >= $2
          AND pl.created_at <= $3
        ORDER BY pl.created_at DESC
        LIMIT $4
        "#,
    )
    .bind(org_id)
    .bind(start)
    .bind(end)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch errors: {}", e)))?;

    Ok(Json(
        errors
            .into_iter()
            .map(
                |(
                    id,
                    method,
                    tool_name,
                    resource_uri,
                    status,
                    error_message,
                    latency_ms,
                    created_at,
                )| {
                    RecentErrorItem {
                        id,
                        method,
                        tool_name,
                        resource_uri,
                        status,
                        error_message,
                        latency_ms,
                        created_at: format_datetime(created_at),
                    }
                },
            )
            .collect(),
    ))
}

/// Latency bucket for distribution
#[derive(Debug, Serialize)]
pub struct LatencyBucket {
    pub range: String,
    pub count: i64,
    pub percentage: f64,
}

/// Latency distribution response
#[derive(Debug, Serialize)]
pub struct LatencyDistributionResponse {
    pub buckets: Vec<LatencyBucket>,
    pub p50_ms: i32,
    pub p95_ms: i32,
    pub p99_ms: i32,
    pub total_requests: i64,
}

/// Get latency distribution from proxy logs
pub async fn get_latency_distribution(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<UsagePeriodQuery>,
) -> Result<Json<LatencyDistributionResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Default to last 7 days if not specified
    let now = OffsetDateTime::now_utc();
    let start = query
        .start
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or_else(|| now - time::Duration::days(7));
    let end = query
        .end
        .as_ref()
        .and_then(|s| {
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
        })
        .unwrap_or(now);

    // First check if there's any data at all to avoid issues with empty aggregates
    let count_check: Option<(i64,)> = sqlx::query_as(
        r#"
        SELECT COUNT(*) as cnt
        FROM mcp_proxy_logs pl
        JOIN api_keys ak ON pl.api_key_id = ak.id
        WHERE ak.org_id = $1
          AND pl.latency_ms IS NOT NULL
          AND pl.created_at >= $2
          AND pl.created_at <= $3
        "#,
    )
    .bind(org_id)
    .bind(start)
    .bind(end)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("get_latency_distribution: count check failed: {}", e);
        ApiError::Database(format!("Failed to check latency data: {}", e))
    })?;

    let total_count = count_check.map(|(c,)| c).unwrap_or(0);
    tracing::debug!("get_latency_distribution: total_count = {}", total_count);

    // If no data, return empty response immediately
    if total_count == 0 {
        return Ok(Json(LatencyDistributionResponse {
            buckets: vec![],
            p50_ms: 0,
            p95_ms: 0,
            p99_ms: 0,
            total_requests: 0,
        }));
    }

    // Get latency bucket counts
    let bucket_counts: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT bucket, count FROM (
            SELECT
                CASE
                    WHEN latency_ms < 100 THEN '< 100ms'
                    WHEN latency_ms < 200 THEN '100-200ms'
                    WHEN latency_ms < 500 THEN '200-500ms'
                    ELSE '> 500ms'
                END as bucket,
                COUNT(*) as count,
                MIN(latency_ms) as min_latency
            FROM mcp_proxy_logs pl
            JOIN api_keys ak ON pl.api_key_id = ak.id
            WHERE ak.org_id = $1
              AND pl.latency_ms IS NOT NULL
              AND pl.created_at >= $2
              AND pl.created_at <= $3
            GROUP BY 1
        ) sub
        ORDER BY min_latency
        "#,
    )
    .bind(org_id)
    .bind(start)
    .bind(end)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("get_latency_distribution: bucket query failed: {}", e);
        ApiError::Database(format!("Failed to fetch latency buckets: {}", e))
    })?;

    tracing::debug!(
        "get_latency_distribution: got {} buckets",
        bucket_counts.len()
    );

    // Get percentiles
    #[allow(clippy::type_complexity)]
    let percentiles: Option<(Option<f64>, Option<f64>, Option<f64>, i64)> = sqlx::query_as(
        r#"
        SELECT
            percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms) as p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99,
            COUNT(*) as total
        FROM mcp_proxy_logs pl
        JOIN api_keys ak ON pl.api_key_id = ak.id
        WHERE ak.org_id = $1
          AND pl.latency_ms IS NOT NULL
          AND pl.created_at >= $2
          AND pl.created_at <= $3
        "#,
    )
    .bind(org_id)
    .bind(start)
    .bind(end)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("get_latency_distribution: percentile query failed: {}", e);
        ApiError::Database(format!("Failed to fetch percentiles: {}", e))
    })?;

    tracing::debug!("get_latency_distribution: percentiles = {:?}", percentiles);
    let (p50, p95, p99, total) = percentiles.unwrap_or((None, None, None, 0));
    let total_requests = total;

    // Build buckets with percentages
    let buckets: Vec<LatencyBucket> = bucket_counts
        .into_iter()
        .map(|(range, count)| {
            let percentage = if total_requests > 0 {
                (count as f64 / total_requests as f64) * 100.0
            } else {
                0.0
            };
            LatencyBucket {
                range,
                count,
                percentage,
            }
        })
        .collect();

    Ok(Json(LatencyDistributionResponse {
        buckets,
        p50_ms: p50.unwrap_or(0.0) as i32,
        p95_ms: p95.unwrap_or(0.0) as i32,
        p99_ms: p99.unwrap_or(0.0) as i32,
        total_requests,
    }))
}
