//! Organization management routes

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    routing::RESERVED_SUBDOMAINS,
    state::AppState,
};

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOrgRequest {
    pub name: Option<String>,
    pub settings: Option<serde_json::Value>,
    pub custom_subdomain: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OrgResponse {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub auto_subdomain: Option<String>,
    pub custom_subdomain: Option<String>,
    pub subscription_tier: String,
    pub settings: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct OrgStatsResponse {
    pub member_count: i64,
    pub api_key_count: i64,
    pub mcp_count: i64,
    pub current_period_requests: i64,
    pub current_period_tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct SubscriptionResponse {
    pub tier: String,
    pub status: String,
    pub current_period_start: Option<OffsetDateTime>,
    pub current_period_end: Option<OffsetDateTime>,
    pub cancel_at_period_end: bool,
    pub limits: TierLimits,
    pub usage: TierUsage,
}

#[derive(Debug, Serialize)]
pub struct TierLimits {
    pub max_users: i64,
    pub max_api_keys: i64,
    pub max_mcps: i64,
    pub max_requests_per_month: i64,
    pub max_tokens_per_month: i64,
}

#[derive(Debug, Serialize)]
pub struct TierUsage {
    pub users: i64,
    pub api_keys: i64,
    pub mcps: i64,
    pub requests_this_month: i64,
    pub tokens_this_month: i64,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
struct OrgRow {
    id: Uuid,
    name: String,
    slug: String,
    auto_subdomain: Option<String>,
    custom_subdomain: Option<String>,
    subscription_tier: String,
    settings: serde_json::Value,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct SubscriptionRow {
    status: String,
    current_period_start: Option<OffsetDateTime>,
    current_period_end: Option<OffsetDateTime>,
    cancel_at_period_end: bool,
}

// =============================================================================
// Handlers
// =============================================================================

/// Get current organization details
pub async fn get_org(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<OrgResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let org: OrgRow = sqlx::query_as(
        r#"
        SELECT id, name, slug, auto_subdomain, custom_subdomain, subscription_tier, settings, created_at, updated_at
        FROM organizations
        WHERE id = $1
        "#
    )
    .bind(org_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(OrgResponse {
        id: org.id,
        name: org.name,
        slug: org.slug,
        auto_subdomain: org.auto_subdomain,
        custom_subdomain: org.custom_subdomain,
        subscription_tier: org.subscription_tier,
        settings: org.settings,
        created_at: org.created_at,
        updated_at: org.updated_at,
    }))
}

/// Get organization by ID
/// Used when frontend needs to fetch a specific org by its UUID
pub async fn get_org_by_id(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(org_id): Path<Uuid>,
) -> ApiResult<Json<OrgResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Verify user is a member of this organization
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM organization_members WHERE org_id = $1 AND user_id = $2")
            .bind(org_id)
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?;

    if is_member.is_none() {
        return Err(ApiError::NotFound);
    }

    let org: OrgRow = sqlx::query_as(
        r#"
        SELECT id, name, slug, auto_subdomain, custom_subdomain, subscription_tier, settings, created_at, updated_at
        FROM organizations
        WHERE id = $1
        "#
    )
    .bind(org_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(OrgResponse {
        id: org.id,
        name: org.name,
        slug: org.slug,
        auto_subdomain: org.auto_subdomain,
        custom_subdomain: org.custom_subdomain,
        subscription_tier: org.subscription_tier,
        settings: org.settings,
        created_at: org.created_at,
        updated_at: org.updated_at,
    }))
}

/// Update organization details
pub async fn update_org(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<UpdateOrgRequest>,
) -> ApiResult<Json<OrgResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Only owners and admins can update org
    if !["owner", "admin"].contains(&auth_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    // Update name if provided
    if let Some(ref name) = req.name {
        if name.trim().is_empty() || name.len() > 100 {
            return Err(ApiError::Validation(
                "Organization name must be between 1 and 100 characters".to_string(),
            ));
        }

        sqlx::query("UPDATE organizations SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name.trim())
            .bind(org_id)
            .execute(&state.pool)
            .await?;
    }

    // Update settings if provided
    if let Some(ref settings) = req.settings {
        sqlx::query("UPDATE organizations SET settings = $1, updated_at = NOW() WHERE id = $2")
            .bind(settings)
            .bind(org_id)
            .execute(&state.pool)
            .await?;
    }

    // Update custom_subdomain if provided (paid tiers only)
    if let Some(ref custom_subdomain) = req.custom_subdomain {
        // Get current tier
        let tier: (String,) =
            sqlx::query_as("SELECT subscription_tier FROM organizations WHERE id = $1")
                .bind(org_id)
                .fetch_one(&state.pool)
                .await?;

        // Check tier access (pro, team, enterprise only)
        let tier_lower = tier.0.to_lowercase();
        if !["pro", "team", "enterprise"].contains(&tier_lower.as_str()) {
            return Err(ApiError::Forbidden);
        }

        // Allow clearing subdomain with empty string
        if custom_subdomain.is_empty() {
            sqlx::query("UPDATE organizations SET custom_subdomain = NULL, updated_at = NOW() WHERE id = $1")
                .bind(org_id)
                .execute(&state.pool)
                .await?;
        } else {
            // Normalize to lowercase
            let subdomain = custom_subdomain.trim().to_lowercase();

            // Validate format
            validate_custom_subdomain(&subdomain)?;

            // Check reserved
            if is_reserved_subdomain(&subdomain) {
                return Err(ApiError::Validation(
                    "This subdomain is reserved and cannot be used".to_string(),
                ));
            }

            // Check uniqueness (against both custom_subdomain AND auto_subdomain)
            let existing: Option<(Uuid,)> = sqlx::query_as(
                "SELECT id FROM organizations WHERE (custom_subdomain = $1 OR auto_subdomain = $1) AND id != $2"
            )
            .bind(&subdomain)
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await?;

            if existing.is_some() {
                return Err(ApiError::Conflict(
                    "This subdomain is already taken".to_string(),
                ));
            }

            sqlx::query(
                "UPDATE organizations SET custom_subdomain = $1, updated_at = NOW() WHERE id = $2",
            )
            .bind(&subdomain)
            .bind(org_id)
            .execute(&state.pool)
            .await?;
        }
    }

    // Fetch updated org
    let org: OrgRow = sqlx::query_as(
        r#"
        SELECT id, name, slug, auto_subdomain, custom_subdomain, subscription_tier, settings, created_at, updated_at
        FROM organizations
        WHERE id = $1
        "#
    )
    .bind(org_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(OrgResponse {
        id: org.id,
        name: org.name,
        slug: org.slug,
        auto_subdomain: org.auto_subdomain,
        custom_subdomain: org.custom_subdomain,
        subscription_tier: org.subscription_tier,
        settings: org.settings,
        created_at: org.created_at,
        updated_at: org.updated_at,
    }))
}

/// Get organization statistics
pub async fn get_org_stats(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<OrgStatsResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Count members
    let member_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE org_id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    // Count API keys
    let api_key_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM api_keys WHERE org_id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    // Count MCPs
    let mcp_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM mcp_instances WHERE org_id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    // Get current period usage
    let usage: Option<(i64, i64)> = sqlx::query_as(
        r#"
        SELECT COALESCE(SUM(request_count), 0), COALESCE(SUM(token_count), 0)
        FROM usage_records
        WHERE org_id = $1
          AND period_start >= date_trunc('month', CURRENT_DATE)
        "#,
    )
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?;

    let (requests, tokens) = usage.unwrap_or((0, 0));

    Ok(Json(OrgStatsResponse {
        member_count: member_count.0,
        api_key_count: api_key_count.0,
        mcp_count: mcp_count.0,
        current_period_requests: requests,
        current_period_tokens: tokens,
    }))
}

/// Get subscription details and usage
pub async fn get_subscription(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<SubscriptionResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Get org tier
    let org: OrgRow = sqlx::query_as(
        r#"
        SELECT id, name, slug, auto_subdomain, custom_subdomain, subscription_tier, settings, created_at, updated_at
        FROM organizations
        WHERE id = $1
        "#
    )
    .bind(org_id)
    .fetch_one(&state.pool)
    .await?;

    // Get subscription
    let sub: Option<SubscriptionRow> = sqlx::query_as(
        r#"
        SELECT status, current_period_start, current_period_end, cancel_at_period_end
        FROM subscriptions
        WHERE org_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?;

    // Get usage counts
    let member_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE org_id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    let api_key_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM api_keys WHERE org_id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    let mcp_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM mcp_instances WHERE org_id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    // Get current period usage
    let usage: Option<(i64, i64)> = sqlx::query_as(
        r#"
        SELECT COALESCE(SUM(request_count), 0), COALESCE(SUM(token_count), 0)
        FROM usage_records
        WHERE org_id = $1
          AND period_start >= date_trunc('month', CURRENT_DATE)
        "#,
    )
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?;

    let (requests, tokens) = usage.unwrap_or((0, 0));

    // Define tier limits (matches types.rs source of truth)
    let limits = match org.subscription_tier.as_str() {
        "free" => TierLimits {
            max_users: 1,
            max_api_keys: 5,
            max_mcps: 5,
            max_requests_per_month: 1_000,
            max_tokens_per_month: 100_000,
        },
        "pro" => TierLimits {
            max_users: 5,
            max_api_keys: 20,
            max_mcps: 20,
            max_requests_per_month: 50_000,
            max_tokens_per_month: 5_000_000,
        },
        "team" => TierLimits {
            max_users: -1, // Unlimited
            max_api_keys: 50,
            max_mcps: 50,
            max_requests_per_month: 250_000,
            max_tokens_per_month: 25_000_000,
        },
        "enterprise" => TierLimits {
            max_users: -1, // Unlimited
            max_api_keys: -1,
            max_mcps: -1,
            max_requests_per_month: -1,
            max_tokens_per_month: -1,
        },
        _ => TierLimits {
            // Default to free tier limits
            max_users: 1,
            max_api_keys: 5,
            max_mcps: 5,
            max_requests_per_month: 1_000,
            max_tokens_per_month: 100_000,
        },
    };

    let subscription_info = sub.unwrap_or(SubscriptionRow {
        status: "active".to_string(),
        current_period_start: None,
        current_period_end: None,
        cancel_at_period_end: false,
    });

    Ok(Json(SubscriptionResponse {
        tier: org.subscription_tier,
        status: subscription_info.status,
        current_period_start: subscription_info.current_period_start,
        current_period_end: subscription_info.current_period_end,
        cancel_at_period_end: subscription_info.cancel_at_period_end,
        limits,
        usage: TierUsage {
            users: member_count.0,
            api_keys: api_key_count.0,
            mcps: mcp_count.0,
            requests_this_month: requests,
            tokens_this_month: tokens,
        },
    }))
}

/// Delete organization (owner only, requires confirmation)
pub async fn delete_org(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<StatusCode> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Only owner can delete org
    if auth_user.role != "owner" {
        return Err(ApiError::Forbidden);
    }

    // Start transaction
    let mut tx = state.pool.begin().await?;

    // Delete all related data in order (due to foreign key constraints)
    // 1. Delete usage records
    sqlx::query("DELETE FROM usage_records WHERE org_id = $1")
        .bind(org_id)
        .execute(&mut *tx)
        .await?;

    // 2. Delete API keys
    sqlx::query("DELETE FROM api_keys WHERE org_id = $1")
        .bind(org_id)
        .execute(&mut *tx)
        .await?;

    // 3. Delete MCP configs
    sqlx::query("DELETE FROM mcp_configs WHERE org_id = $1")
        .bind(org_id)
        .execute(&mut *tx)
        .await?;

    // 4. Delete users
    sqlx::query("DELETE FROM users WHERE org_id = $1")
        .bind(org_id)
        .execute(&mut *tx)
        .await?;

    // 5. Delete subscriptions
    // Note: subscriptions.customer_id stores org_id as text
    sqlx::query("DELETE FROM subscriptions WHERE customer_id = $1")
        .bind(org_id.to_string())
        .execute(&mut *tx)
        .await?;

    // 6. Delete organization
    sqlx::query("DELETE FROM organizations WHERE id = $1")
        .bind(org_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

/// List organizations for the authenticated user
/// This endpoint is for OAuth users who don't have org_id in their JWT
pub async fn list_orgs(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<Vec<OrgResponse>>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Get all organizations the user is a member of
    let orgs: Vec<OrgRow> = sqlx::query_as(
        r#"
        SELECT o.id, o.name, o.slug, o.auto_subdomain, o.custom_subdomain, o.subscription_tier, o.settings, o.created_at, o.updated_at
        FROM organizations o
        INNER JOIN organization_members om ON o.id = om.org_id
        WHERE om.user_id = $1
        ORDER BY o.created_at DESC
        "#
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        orgs.into_iter()
            .map(|org| OrgResponse {
                id: org.id,
                name: org.name,
                slug: org.slug,
                auto_subdomain: org.auto_subdomain,
                custom_subdomain: org.custom_subdomain,
                subscription_tier: org.subscription_tier,
                settings: org.settings,
                created_at: org.created_at,
                updated_at: org.updated_at,
            })
            .collect(),
    ))
}

/// Create a new organization
/// This endpoint is for OAuth users who need to create their first org
pub async fn create_org(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateOrgRequest>,
) -> ApiResult<Json<OrgResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Validate input
    if req.name.trim().is_empty() || req.name.len() > 100 {
        return Err(ApiError::Validation(
            "Organization name must be between 1 and 100 characters".to_string(),
        ));
    }

    if req.slug.trim().is_empty() || req.slug.len() > 50 {
        return Err(ApiError::Validation(
            "Organization slug must be between 1 and 50 characters".to_string(),
        ));
    }

    // Validate slug format (lowercase, alphanumeric, hyphens)
    if !req
        .slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(ApiError::Validation(
            "Slug must contain only lowercase letters, numbers, and hyphens".to_string(),
        ));
    }

    // Check if slug is already taken
    let existing: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM organizations WHERE slug = $1")
        .bind(&req.slug)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_some() {
        return Err(ApiError::Conflict(
            "An organization with this slug already exists".to_string(),
        ));
    }

    // Start transaction
    let mut tx = state.pool.begin().await?;

    // Create the organization
    let org_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO organizations (id, name, slug, subscription_tier, settings, created_at, updated_at)
        VALUES ($1, $2, $3, 'free', '{}', NOW(), NOW())
        "#
    )
    .bind(org_id)
    .bind(&req.name)
    .bind(&req.slug)
    .execute(&mut *tx)
    .await?;

    // Add the user as an owner of the organization
    sqlx::query(
        r#"
        INSERT INTO organization_members (id, org_id, user_id, role, created_at)
        VALUES ($1, $2, $3, 'owner', NOW())
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(org_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // Fetch the created organization (includes auto_subdomain generated by DB trigger)
    let org: OrgRow = sqlx::query_as(
        r#"
        SELECT id, name, slug, auto_subdomain, custom_subdomain, subscription_tier, settings, created_at, updated_at
        FROM organizations
        WHERE id = $1
        "#
    )
    .bind(org_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(OrgResponse {
        id: org.id,
        name: org.name,
        slug: org.slug,
        auto_subdomain: org.auto_subdomain,
        custom_subdomain: org.custom_subdomain,
        subscription_tier: org.subscription_tier,
        settings: org.settings,
        created_at: org.created_at,
        updated_at: org.updated_at,
    }))
}

// =============================================================================
// Custom Subdomain Validation
// =============================================================================

fn validate_custom_subdomain(subdomain: &str) -> Result<(), ApiError> {
    // Length: 3-50 characters
    if subdomain.len() < 3 || subdomain.len() > 50 {
        return Err(ApiError::Validation(
            "Subdomain must be between 3 and 50 characters".to_string(),
        ));
    }

    // Format: lowercase letters, numbers, hyphens only
    if !subdomain
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(ApiError::Validation(
            "Subdomain can only contain lowercase letters, numbers, and hyphens".to_string(),
        ));
    }

    // No starting/ending hyphen
    if subdomain.starts_with('-') || subdomain.ends_with('-') {
        return Err(ApiError::Validation(
            "Subdomain cannot start or end with a hyphen".to_string(),
        ));
    }

    // No consecutive hyphens
    if subdomain.contains("--") {
        return Err(ApiError::Validation(
            "Subdomain cannot contain consecutive hyphens".to_string(),
        ));
    }

    Ok(())
}

fn is_reserved_subdomain(subdomain: &str) -> bool {
    RESERVED_SUBDOMAINS.contains(&subdomain)
}

// =============================================================================
// Subdomain Availability Check
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CheckSubdomainRequest {
    pub subdomain: String,
}

#[derive(Debug, Serialize)]
pub struct CheckSubdomainResponse {
    pub available: bool,
    pub reason: Option<String>,
}

pub async fn check_subdomain_availability(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CheckSubdomainRequest>,
) -> ApiResult<Json<CheckSubdomainResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let subdomain = req.subdomain.trim().to_lowercase();

    // Validate format
    if let Err(ApiError::Validation(msg)) = validate_custom_subdomain(&subdomain) {
        return Ok(Json(CheckSubdomainResponse {
            available: false,
            reason: Some(msg),
        }));
    }

    // Check reserved
    if is_reserved_subdomain(&subdomain) {
        return Ok(Json(CheckSubdomainResponse {
            available: false,
            reason: Some("This subdomain is reserved".to_string()),
        }));
    }

    // Check uniqueness (against both custom_subdomain AND auto_subdomain)
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM organizations WHERE (custom_subdomain = $1 OR auto_subdomain = $1) AND id != $2"
    )
    .bind(&subdomain)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?;

    if existing.is_some() {
        return Ok(Json(CheckSubdomainResponse {
            available: false,
            reason: Some("This subdomain is already taken".to_string()),
        }));
    }

    Ok(Json(CheckSubdomainResponse {
        available: true,
        reason: None,
    }))
}
