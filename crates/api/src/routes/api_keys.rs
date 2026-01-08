//! API key management routes

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
    state::AppState,
};
use plexmcp_shared::types::{SubscriptionTier, CustomLimits, EffectiveLimits};

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub rate_limit_rpm: Option<i32>,
    /// Number of days until expiration (alternative to expires_at)
    pub expires_in_days: Option<i32>,
    /// ISO 8601 date string for expiration (alternative to expires_in_days)
    pub expires_at: Option<String>,
    /// Optional PIN for encrypting the key (required if user has PIN set)
    pub pin: Option<String>,
    /// MCP access mode: 'all' (default), 'selected', or 'none'
    #[serde(default = "default_mcp_access_mode")]
    pub mcp_access_mode: String,
    /// When mcp_access_mode='selected', the MCP IDs this key can access
    pub allowed_mcp_ids: Option<Vec<Uuid>>,
}

fn default_mcp_access_mode() -> String {
    "all".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateApiKeyRequest {
    pub name: Option<String>,
    pub scopes: Option<Vec<String>>,
    pub rate_limit_rpm: Option<i32>,
    /// MCP access mode: 'all', 'selected', or 'none'
    pub mcp_access_mode: Option<String>,
    /// When mcp_access_mode='selected', the MCP IDs this key can access
    pub allowed_mcp_ids: Option<Vec<Uuid>>,
    /// ISO 8601 date string for expiration, empty string to clear, null/missing to not change
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RotateApiKeyRequest {
    /// Optional PIN for encrypting the new key (required if user has PIN set)
    pub pin: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyListResponse {
    pub api_keys: Vec<ApiKeySummary>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct ApiKeySummary {
    pub id: Uuid,
    pub name: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub rate_limit_rpm: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_used_at: Option<OffsetDateTime>,
    pub request_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// MCP access mode: 'all', 'selected', or 'none'
    pub mcp_access_mode: String,
    /// When mcp_access_mode='selected', only these MCP IDs are accessible
    pub allowed_mcp_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyDetailResponse {
    pub id: Uuid,
    pub name: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub rate_limit_rpm: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_used_at: Option<OffsetDateTime>,
    pub request_count: i64,
    pub created_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// MCP access mode: 'all', 'selected', or 'none'
    pub mcp_access_mode: String,
    /// When mcp_access_mode='selected', only these MCP IDs are accessible
    pub allowed_mcp_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyCreatedResponse {
    pub id: Uuid,
    pub name: String,
    pub key: String,  // Full key - only shown once on creation
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub rate_limit_rpm: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyRotatedResponse {
    pub id: Uuid,
    pub name: String,
    pub key: String,  // New full key - only shown once
    pub key_prefix: String,
    pub old_key_prefix: String,
    #[serde(with = "time::serde::rfc3339")]
    pub rotated_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyUsageResponse {
    pub key_id: Uuid,
    pub total_requests: i64,
    pub period_requests: i64,
    pub period_tokens: i64,
    pub period_errors: i64,
    pub avg_latency_ms: Option<i32>,
    #[serde(with = "time::serde::rfc3339")]
    pub period_start: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub period_end: OffsetDateTime,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
struct ApiKeyRow {
    id: Uuid,
    name: String,
    key_prefix: String,
    scopes: serde_json::Value,
    rate_limit_rpm: i32,
    expires_at: Option<OffsetDateTime>,
    last_used_at: Option<OffsetDateTime>,
    request_count: i64,
    created_by: Option<Uuid>,
    created_at: OffsetDateTime,
    mcp_access_mode: String,
    allowed_mcp_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, FromRow)]
struct UsageRow {
    total_requests: i64,
    total_tokens: i64,
    total_errors: i64,
    avg_latency: Option<i32>,
}

// =============================================================================
// Handlers
// =============================================================================

/// List all API keys in the organization
pub async fn list_api_keys(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<ApiKeyListResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Viewers cannot list API keys
    if auth_user.role.as_str() == "viewer" {
        return Err(ApiError::Forbidden);
    }

    // Members can only see their own keys, admin/owner see all
    let keys: Vec<ApiKeyRow> = if ["owner", "admin"].contains(&auth_user.role.as_str()) {
        // Admin/Owner: see all keys in the org
        sqlx::query_as(
            r#"
            SELECT id, name, key_prefix, scopes, rate_limit_rpm, expires_at,
                   last_used_at, request_count, created_by, created_at,
                   mcp_access_mode, allowed_mcp_ids
            FROM api_keys
            WHERE org_id = $1
            ORDER BY created_at DESC
            "#
        )
        .bind(org_id)
        .fetch_all(&state.pool)
        .await?
    } else {
        // Member: only see keys they created
        sqlx::query_as(
            r#"
            SELECT id, name, key_prefix, scopes, rate_limit_rpm, expires_at,
                   last_used_at, request_count, created_by, created_at,
                   mcp_access_mode, allowed_mcp_ids
            FROM api_keys
            WHERE org_id = $1 AND created_by = $2
            ORDER BY created_at DESC
            "#
        )
        .bind(org_id)
        .bind(auth_user.user_id)
        .fetch_all(&state.pool)
        .await?
    };

    let total = keys.len() as i64;

    let api_keys: Vec<ApiKeySummary> = keys
        .into_iter()
        .map(|k| {
            let scopes: Vec<String> = serde_json::from_value(k.scopes.clone())
                .unwrap_or_default();
            ApiKeySummary {
                id: k.id,
                name: k.name,
                key_prefix: k.key_prefix,
                scopes,
                rate_limit_rpm: k.rate_limit_rpm,
                expires_at: k.expires_at,
                last_used_at: k.last_used_at,
                request_count: k.request_count,
                created_at: k.created_at,
                mcp_access_mode: k.mcp_access_mode,
                allowed_mcp_ids: k.allowed_mcp_ids,
            }
        })
        .collect();

    Ok(Json(ApiKeyListResponse { api_keys, total }))
}

/// Get a specific API key by ID
pub async fn get_api_key(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(key_id): Path<Uuid>,
) -> ApiResult<Json<ApiKeyDetailResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Viewers cannot view API keys
    if auth_user.role.as_str() == "viewer" {
        return Err(ApiError::Forbidden);
    }

    // First fetch the key
    let key: ApiKeyRow = sqlx::query_as(
        r#"
        SELECT id, name, key_prefix, scopes, rate_limit_rpm, expires_at,
               last_used_at, request_count, created_by, created_at,
               mcp_access_mode, allowed_mcp_ids
        FROM api_keys
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(key_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Members can only view their own keys
    if auth_user.role.as_str() == "member"
        && key.created_by != auth_user.user_id {
            return Err(ApiError::Forbidden);
        }

    let scopes: Vec<String> = serde_json::from_value(key.scopes).unwrap_or_default();

    Ok(Json(ApiKeyDetailResponse {
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        scopes,
        rate_limit_rpm: key.rate_limit_rpm,
        expires_at: key.expires_at,
        last_used_at: key.last_used_at,
        request_count: key.request_count,
        created_by: key.created_by,
        created_at: key.created_at,
        mcp_access_mode: key.mcp_access_mode,
        allowed_mcp_ids: key.allowed_mcp_ids,
    }))
}

/// Create a new API key
pub async fn create_api_key(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateApiKeyRequest>,
) -> ApiResult<(StatusCode, Json<ApiKeyCreatedResponse>)> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Viewers cannot create API keys
    if auth_user.role.as_str() == "viewer" {
        return Err(ApiError::Forbidden);
    }
    // Members, Admins, and Owners can create API keys

    // Validate name
    if req.name.trim().is_empty() || req.name.len() > 100 {
        return Err(ApiError::Validation(
            "API key name must be between 1 and 100 characters".to_string()
        ));
    }

    // Validate rate limit
    let rate_limit_rpm = req.rate_limit_rpm.unwrap_or(60);
    if !(1..=10000).contains(&rate_limit_rpm) {
        return Err(ApiError::Validation(
            "Rate limit must be between 1 and 10000 requests per minute".to_string()
        ));
    }

    // Check tier limits (with custom enterprise overrides)
    let effective_limits = get_org_effective_limits(&state.pool, org_id).await?;
    let max_keys = effective_limits.max_api_keys;

    // Only check limit if tier has a limit (not unlimited)
    if max_keys != u32::MAX {
        let key_count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM api_keys WHERE org_id = $1"
        )
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

        if key_count.0 >= max_keys as i64 {
            return Err(ApiError::QuotaExceeded(format!(
                "Maximum {} API keys allowed. Contact support to increase your limit.",
                max_keys
            )));
        }
    }

    // Generate the API key
    let (full_key, key_hash, key_prefix) = state
        .api_key_manager
        .generate_key()
        .map_err(|_| ApiError::Internal)?;

    // Calculate expiration - support both expires_in_days (integer) and expires_at (ISO string)
    let expires_at = if let Some(expires_at_str) = &req.expires_at {
        // Parse ISO 8601 date string from frontend
        time::OffsetDateTime::parse(expires_at_str, &time::format_description::well_known::Rfc3339)
            .ok()
            .or_else(|| {
                // Try parsing as date-only (YYYY-MM-DD) and add time
                time::Date::parse(expires_at_str, &time::format_description::parse("[year]-[month]-[day]").ok()?)
                    .ok()
                    .and_then(|d| d.with_hms(23, 59, 59).ok())
                    .map(|dt| dt.assume_utc())
            })
    } else {
        req.expires_in_days.map(|days| {
            OffsetDateTime::now_utc() + time::Duration::days(days as i64)
        })
    };

    // Insert into database
    let key_id = Uuid::new_v4();
    let scopes_json = serde_json::to_value(&req.scopes).unwrap_or_default();

    // Validate mcp_access_mode
    let mcp_access_mode = req.mcp_access_mode.as_str();
    if !["all", "selected", "none"].contains(&mcp_access_mode) {
        return Err(ApiError::Validation(
            "mcp_access_mode must be 'all', 'selected', or 'none'".to_string()
        ));
    }

    // If PIN is provided, verify it BEFORE creating the key
    if let Some(ref pin) = req.pin {
        if let Some(user_id) = auth_user.user_id {
            super::pin::verify_user_pin(&state.pool, user_id, pin).await?;
        } else {
            return Err(ApiError::Validation("User ID required for PIN encryption".to_string()));
        }
    }

    sqlx::query(
        r#"
        INSERT INTO api_keys (id, org_id, name, key_hash, key_prefix, scopes, rate_limit_rpm, expires_at, created_by, mcp_access_mode, allowed_mcp_ids)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        "#
    )
    .bind(key_id)
    .bind(org_id)
    .bind(req.name.trim())
    .bind(&key_hash)
    .bind(&key_prefix)
    .bind(&scopes_json)
    .bind(rate_limit_rpm)
    .bind(expires_at)
    .bind(auth_user.user_id)  // created_by - track who created this key for member self-management
    .bind(&req.mcp_access_mode)
    .bind(&req.allowed_mcp_ids)
    .execute(&state.pool)
    .await?;

    // If PIN is provided, encrypt and store the key for later reveal
    if let Some(ref pin) = req.pin {
        if let Some(user_id) = auth_user.user_id {
            if let Err(e) = super::pin::encrypt_and_store_key(&state.pool, user_id, key_id, &full_key, pin).await {
                tracing::warn!(key_id = %key_id, error = %e, "Failed to encrypt API key - key created but not revealable");
            }
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(ApiKeyCreatedResponse {
            id: key_id,
            name: req.name.trim().to_string(),
            key: full_key,
            key_prefix,
            scopes: req.scopes,
            rate_limit_rpm,
            expires_at,
            created_at: OffsetDateTime::now_utc(),
        }),
    ))
}

/// Update an API key
pub async fn update_api_key(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(key_id): Path<Uuid>,
    Json(req): Json<UpdateApiKeyRequest>,
) -> ApiResult<Json<ApiKeyDetailResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Viewers cannot update API keys
    if auth_user.role.as_str() == "viewer" {
        return Err(ApiError::Forbidden);
    }

    // First fetch the key to check ownership
    #[derive(sqlx::FromRow)]
    #[allow(dead_code)] // Fields populated from DB
    struct KeyOwnerRow {
        id: Uuid,
        created_by: Option<Uuid>,
    }

    let existing: KeyOwnerRow = sqlx::query_as(
        "SELECT id, created_by FROM api_keys WHERE id = $1 AND org_id = $2"
    )
    .bind(key_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Members can only update their own keys
    if auth_user.role.as_str() == "member"
        && existing.created_by != auth_user.user_id {
            return Err(ApiError::Forbidden);
        }

    // Update name if provided
    if let Some(ref name) = req.name {
        if name.trim().is_empty() || name.len() > 100 {
            return Err(ApiError::Validation(
                "API key name must be between 1 and 100 characters".to_string()
            ));
        }

        sqlx::query("UPDATE api_keys SET name = $1 WHERE id = $2")
            .bind(name.trim())
            .bind(key_id)
            .execute(&state.pool)
            .await?;
    }

    // Update scopes if provided
    if let Some(ref scopes) = req.scopes {
        let scopes_json = serde_json::to_value(scopes).unwrap_or_default();
        sqlx::query("UPDATE api_keys SET scopes = $1 WHERE id = $2")
            .bind(&scopes_json)
            .bind(key_id)
            .execute(&state.pool)
            .await?;
    }

    // Update rate limit if provided
    if let Some(rate_limit_rpm) = req.rate_limit_rpm {
        if !(1..=10000).contains(&rate_limit_rpm) {
            return Err(ApiError::Validation(
                "Rate limit must be between 1 and 10000 requests per minute".to_string()
            ));
        }

        sqlx::query("UPDATE api_keys SET rate_limit_rpm = $1 WHERE id = $2")
            .bind(rate_limit_rpm)
            .bind(key_id)
            .execute(&state.pool)
            .await?;
    }

    // Update mcp_access_mode if provided
    if let Some(ref mcp_access_mode) = req.mcp_access_mode {
        if !["all", "selected", "none"].contains(&mcp_access_mode.as_str()) {
            return Err(ApiError::Validation(
                "mcp_access_mode must be 'all', 'selected', or 'none'".to_string()
            ));
        }

        sqlx::query("UPDATE api_keys SET mcp_access_mode = $1 WHERE id = $2")
            .bind(mcp_access_mode)
            .bind(key_id)
            .execute(&state.pool)
            .await?;
    }

    // Update allowed_mcp_ids if provided (can be set even if mcp_access_mode not provided)
    if req.allowed_mcp_ids.is_some() {
        sqlx::query("UPDATE api_keys SET allowed_mcp_ids = $1 WHERE id = $2")
            .bind(&req.allowed_mcp_ids)
            .bind(key_id)
            .execute(&state.pool)
            .await?;
    }

    // Update expires_at if provided
    if let Some(ref expires_at_str) = req.expires_at {
        let expires_at: Option<time::OffsetDateTime> = if expires_at_str.is_empty() {
            // Empty string means clear the expiration
            None
        } else {
            // Parse ISO 8601 date string
            let parsed = time::OffsetDateTime::parse(expires_at_str, &time::format_description::well_known::Rfc3339)
                .ok()
                .or_else(|| {
                    // Try parsing as date-only (YYYY-MM-DD) and set time to end of day
                    time::Date::parse(expires_at_str, &time::format_description::parse("[year]-[month]-[day]").ok()?)
                        .ok()
                        .and_then(|d| d.with_hms(23, 59, 59).ok())
                    .map(|dt| dt.assume_utc())
                });

            if parsed.is_none() {
                return Err(ApiError::Validation(
                    "Invalid expiration date format. Use ISO 8601 (e.g., 2025-12-31T23:59:59Z or 2025-12-31)".to_string()
                ));
            }

            // Validate that expiration is in the future
            if let Some(exp) = parsed {
                if exp <= time::OffsetDateTime::now_utc() {
                    return Err(ApiError::Validation(
                        "Expiration date must be in the future".to_string()
                    ));
                }
            }

            parsed
        };

        sqlx::query("UPDATE api_keys SET expires_at = $1 WHERE id = $2")
            .bind(expires_at)
            .bind(key_id)
            .execute(&state.pool)
            .await?;
    }

    // Fetch updated key
    let key: ApiKeyRow = sqlx::query_as(
        r#"
        SELECT id, name, key_prefix, scopes, rate_limit_rpm, expires_at,
               last_used_at, request_count, created_by, created_at,
               mcp_access_mode, allowed_mcp_ids
        FROM api_keys
        WHERE id = $1
        "#
    )
    .bind(key_id)
    .fetch_one(&state.pool)
    .await?;

    let scopes: Vec<String> = serde_json::from_value(key.scopes).unwrap_or_default();

    Ok(Json(ApiKeyDetailResponse {
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        scopes,
        rate_limit_rpm: key.rate_limit_rpm,
        expires_at: key.expires_at,
        last_used_at: key.last_used_at,
        request_count: key.request_count,
        created_by: key.created_by,
        created_at: key.created_at,
        mcp_access_mode: key.mcp_access_mode,
        allowed_mcp_ids: key.allowed_mcp_ids,
    }))
}

/// Rotate an API key (generate new secret, invalidate old)
pub async fn rotate_api_key(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(key_id): Path<Uuid>,
    body: Option<Json<RotateApiKeyRequest>>,
) -> ApiResult<Json<ApiKeyRotatedResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Viewers cannot rotate API keys
    if auth_user.role.as_str() == "viewer" {
        return Err(ApiError::Forbidden);
    }

    // Get current key info
    let current: ApiKeyRow = sqlx::query_as(
        r#"
        SELECT id, name, key_prefix, scopes, rate_limit_rpm, expires_at,
               last_used_at, request_count, created_by, created_at,
               mcp_access_mode, allowed_mcp_ids
        FROM api_keys
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(key_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Members can only rotate their own keys
    if auth_user.role.as_str() == "member"
        && current.created_by != auth_user.user_id {
            return Err(ApiError::Forbidden);
        }

    let old_prefix = current.key_prefix.clone();

    // Generate new key
    let (full_key, key_hash, key_prefix) = state
        .api_key_manager
        .generate_key()
        .map_err(|_| ApiError::Internal)?;

    // If PIN is provided, verify it BEFORE rotating the key
    if let Some(Json(ref req)) = body {
        if let Some(ref pin) = req.pin {
            if let Some(user_id) = auth_user.user_id {
                super::pin::verify_user_pin(&state.pool, user_id, pin).await?;
            } else {
                return Err(ApiError::Validation("User ID required for PIN encryption".to_string()));
            }
        }
    }

    // Update the key hash and prefix, clear encrypted_key since it's a new key
    sqlx::query(
        "UPDATE api_keys SET key_hash = $1, key_prefix = $2, request_count = 0, encrypted_key = NULL, key_nonce = NULL WHERE id = $3"
    )
    .bind(&key_hash)
    .bind(&key_prefix)
    .bind(key_id)
    .execute(&state.pool)
    .await?;

    // If PIN is provided, encrypt and store the new key for later reveal
    if let Some(Json(req)) = body {
        if let Some(ref pin) = req.pin {
            if let Some(user_id) = auth_user.user_id {
                if let Err(e) = super::pin::encrypt_and_store_key(&state.pool, user_id, key_id, &full_key, pin).await {
                    tracing::warn!(key_id = %key_id, error = %e, "Failed to encrypt rotated API key - key rotated but not revealable");
                }
            }
        }
    }

    Ok(Json(ApiKeyRotatedResponse {
        id: key_id,
        name: current.name,
        key: full_key,
        key_prefix,
        old_key_prefix: old_prefix,
        rotated_at: OffsetDateTime::now_utc(),
    }))
}

/// Delete an API key
pub async fn delete_api_key(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(key_id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Viewers cannot delete API keys
    if auth_user.role.as_str() == "viewer" {
        return Err(ApiError::Forbidden);
    }

    // First fetch the key to check ownership
    #[derive(sqlx::FromRow)]
    #[allow(dead_code)] // Fields populated from DB
    struct KeyOwnerRow {
        id: Uuid,
        created_by: Option<Uuid>,
    }

    let existing: KeyOwnerRow = sqlx::query_as(
        "SELECT id, created_by FROM api_keys WHERE id = $1 AND org_id = $2"
    )
    .bind(key_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Members can only delete their own keys
    if auth_user.role.as_str() == "member"
        && existing.created_by != auth_user.user_id {
            return Err(ApiError::Forbidden);
        }

    let result = sqlx::query("DELETE FROM api_keys WHERE id = $1 AND org_id = $2")
        .bind(key_id)
        .bind(org_id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Get usage statistics for an API key
pub async fn get_api_key_usage(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(key_id): Path<Uuid>,
) -> ApiResult<Json<ApiKeyUsageResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Viewers cannot view API key usage
    if auth_user.role.as_str() == "viewer" {
        return Err(ApiError::Forbidden);
    }

    // Verify key exists and belongs to org
    let key: ApiKeyRow = sqlx::query_as(
        r#"
        SELECT id, name, key_prefix, scopes, rate_limit_rpm, expires_at,
               last_used_at, request_count, created_by, created_at,
               mcp_access_mode, allowed_mcp_ids
        FROM api_keys
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(key_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Members can only view usage for their own keys
    if auth_user.role.as_str() == "member"
        && key.created_by != auth_user.user_id {
            return Err(ApiError::Forbidden);
        }

    // Get current period usage
    let period_start = OffsetDateTime::now_utc()
        .replace_day(1)
        .unwrap_or(OffsetDateTime::now_utc())
        .replace_hour(0)
        .unwrap_or(OffsetDateTime::now_utc())
        .replace_minute(0)
        .unwrap_or(OffsetDateTime::now_utc())
        .replace_second(0)
        .unwrap_or(OffsetDateTime::now_utc());

    let period_end = OffsetDateTime::now_utc();

    let usage: Option<UsageRow> = sqlx::query_as(
        r#"
        SELECT
            COALESCE(SUM(request_count), 0) as total_requests,
            COALESCE(SUM(token_count), 0) as total_tokens,
            COALESCE(SUM(error_count), 0) as total_errors,
            AVG(latency_ms_avg)::INTEGER as avg_latency
        FROM usage_records
        WHERE api_key_id = $1 AND period_start >= $2
        "#
    )
    .bind(key_id)
    .bind(period_start)
    .fetch_optional(&state.pool)
    .await?;

    let usage = usage.unwrap_or(UsageRow {
        total_requests: 0,
        total_tokens: 0,
        total_errors: 0,
        avg_latency: None,
    });

    Ok(Json(ApiKeyUsageResponse {
        key_id,
        total_requests: key.request_count,
        period_requests: usage.total_requests,
        period_tokens: usage.total_tokens,
        period_errors: usage.total_errors,
        avg_latency_ms: usage.avg_latency,
        period_start,
        period_end,
    }))
}

// =============================================================================
// Helper Functions for Custom Limits
// =============================================================================

/// Organization data for limit calculations
#[derive(Debug, sqlx::FromRow)]
struct OrgLimitData {
    subscription_tier: String,
    custom_max_mcps: Option<i32>,
    custom_max_api_keys: Option<i32>,
    custom_max_team_members: Option<i32>,
    custom_max_requests_monthly: Option<i64>,
    custom_overage_rate_cents: Option<i32>,
    custom_monthly_price_cents: Option<i32>,
}

/// Get organization's effective limits (tier + custom overrides)
async fn get_org_effective_limits(pool: &sqlx::PgPool, org_id: Uuid) -> Result<EffectiveLimits, crate::error::ApiError> {
    let result: Option<OrgLimitData> = sqlx::query_as(
        r#"SELECT subscription_tier, custom_max_mcps, custom_max_api_keys,
                  custom_max_team_members, custom_max_requests_monthly,
                  custom_overage_rate_cents, custom_monthly_price_cents
           FROM organizations WHERE id = $1"#
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await?;

    let data = result.ok_or(crate::error::ApiError::NotFound)?;
    let tier: SubscriptionTier = data.subscription_tier.parse().unwrap_or(SubscriptionTier::Free);
    let custom = CustomLimits {
        max_mcps: data.custom_max_mcps.map(|v| v as u32),
        max_api_keys: data.custom_max_api_keys.map(|v| v as u32),
        max_team_members: data.custom_max_team_members.map(|v| v as u32),
        max_requests_monthly: data.custom_max_requests_monthly.map(|v| v as u64),
        overage_rate_cents: data.custom_overage_rate_cents,
        monthly_price_cents: data.custom_monthly_price_cents,
    };

    Ok(tier.effective_limits(&custom))
}
