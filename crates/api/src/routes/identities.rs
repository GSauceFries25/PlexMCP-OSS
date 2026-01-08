//! User Identity (Connected Accounts) routes
//!
//! Manages linked OAuth providers for user accounts.

use axum::{
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
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

use super::extract_client_ip;

// =============================================================================
// Request/Response Types
// =============================================================================

/// Response for a single connected identity
#[derive(Debug, Serialize)]
pub struct IdentityResponse {
    pub id: Uuid,
    pub provider: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub linked_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_used_at: Option<OffsetDateTime>,
}

/// Response for listing all connected identities
#[derive(Debug, Serialize)]
pub struct IdentitiesListResponse {
    pub identities: Vec<IdentityResponse>,
    pub has_password: bool,
    pub available_providers: Vec<ProviderInfo>,
}

/// Information about an available provider
#[derive(Debug, Serialize)]
pub struct ProviderInfo {
    pub provider: String,
    pub display_name: String,
    pub is_connected: bool,
}

/// Request to link a new identity (OAuth callback data)
#[derive(Debug, Deserialize)]
pub struct LinkIdentityRequest {
    pub provider: String,
    pub provider_user_id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
}

/// Row type for identity query
#[derive(FromRow)]
struct IdentityRow {
    id: Uuid,
    provider: String,
    email: Option<String>,
    display_name: Option<String>,
    avatar_url: Option<String>,
    linked_at: OffsetDateTime,
    last_used_at: Option<OffsetDateTime>,
}

/// Row type for user check
#[derive(FromRow)]
struct UserPasswordRow {
    password_hash: String,
    email: String,
}

// =============================================================================
// Route Handlers
// =============================================================================

/// List all connected identities for the current user
/// GET /api/v1/account/identities
pub async fn list_identities(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<IdentitiesListResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Get user's password hash to determine if they have password auth
    let user: Option<UserPasswordRow> =
        sqlx::query_as("SELECT password_hash, email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?;

    let has_password = user
        .as_ref()
        .map(|u| !u.password_hash.is_empty())
        .unwrap_or(false);

    // Get all linked identities
    let identities: Vec<IdentityRow> = sqlx::query_as(
        r#"
        SELECT id, provider, email, display_name, avatar_url, linked_at, last_used_at
        FROM user_identities
        WHERE user_id = $1
        ORDER BY linked_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;

    let connected_providers: Vec<String> = identities.iter().map(|i| i.provider.clone()).collect();

    // Available providers
    let available_providers = vec![
        ProviderInfo {
            provider: "google".to_string(),
            display_name: "Google".to_string(),
            is_connected: connected_providers.contains(&"google".to_string()),
        },
        ProviderInfo {
            provider: "github".to_string(),
            display_name: "GitHub".to_string(),
            is_connected: connected_providers.contains(&"github".to_string()),
        },
    ];

    let identity_responses: Vec<IdentityResponse> = identities
        .into_iter()
        .map(|i| IdentityResponse {
            id: i.id,
            provider: i.provider,
            email: i.email,
            display_name: i.display_name,
            avatar_url: i.avatar_url,
            linked_at: i.linked_at,
            last_used_at: i.last_used_at,
        })
        .collect();

    Ok(Json(IdentitiesListResponse {
        identities: identity_responses,
        has_password,
        available_providers,
    }))
}

/// Link a new identity to the current user's account
/// POST /api/v1/account/identities
pub async fn link_identity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<LinkIdentityRequest>,
) -> ApiResult<Json<IdentityResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Check if this provider account is already linked to another user
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2",
    )
    .bind(&req.provider)
    .bind(&req.provider_user_id)
    .fetch_optional(&state.pool)
    .await?;

    if let Some((existing_user_id,)) = existing {
        if existing_user_id != user_id {
            return Err(ApiError::Conflict(
                "This account is already connected to another user".to_string(),
            ));
        }
        // Already linked to this user - just return success
    }

    // Check if user already has this provider linked
    let already_linked: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM user_identities WHERE user_id = $1 AND provider = $2")
            .bind(user_id)
            .bind(&req.provider)
            .fetch_optional(&state.pool)
            .await?;

    if already_linked.is_some() {
        return Err(ApiError::Conflict(format!(
            "{} is already connected to your account",
            req.provider
        )));
    }

    // Insert the new identity
    let identity: IdentityRow = sqlx::query_as(
        r#"
        INSERT INTO user_identities (user_id, provider, provider_user_id, email, display_name, avatar_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, provider, email, display_name, avatar_url, linked_at, last_used_at
        "#
    )
    .bind(user_id)
    .bind(&req.provider)
    .bind(&req.provider_user_id)
    .bind(&req.email)
    .bind(&req.display_name)
    .bind(&req.avatar_url)
    .fetch_one(&state.pool)
    .await?;

    // Get user email for notification
    let user_email: (String,) = sqlx::query_as("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;

    // Extract IP for logging
    let client_ip = extract_client_ip(&headers);

    // Log to audit table
    let _ = sqlx::query(
        r#"
        INSERT INTO user_identity_audit (user_id, action, provider, ip_address, user_agent)
        VALUES ($1, 'linked', $2, $3, $4)
        "#,
    )
    .bind(user_id)
    .bind(&req.provider)
    .bind(client_ip.as_deref())
    .bind(headers.get("user-agent").and_then(|h| h.to_str().ok()))
    .execute(&state.pool)
    .await;

    // Send email notification (fire and forget)
    let email_service = state.security_email.clone();
    let email_to = user_email.0;
    let provider = req.provider.clone();
    tokio::spawn(async move {
        email_service
            .send_account_linked(&email_to, &provider, client_ip.as_deref())
            .await;
    });

    Ok(Json(IdentityResponse {
        id: identity.id,
        provider: identity.provider,
        email: identity.email,
        display_name: identity.display_name,
        avatar_url: identity.avatar_url,
        linked_at: identity.linked_at,
        last_used_at: identity.last_used_at,
    }))
}

/// Unlink an identity from the current user's account
/// DELETE /api/v1/account/identities/:provider
pub async fn unlink_identity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(auth_user): Extension<AuthUser>,
    Path(provider): Path<String>,
) -> ApiResult<StatusCode> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Check if user has password set
    let user: UserPasswordRow =
        sqlx::query_as("SELECT password_hash, email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.pool)
            .await?;

    let has_password = !user.password_hash.is_empty();

    // Count linked identities
    let identity_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM user_identities WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.pool)
            .await?;

    // Safety check: cannot unlink if it's the only auth method
    if !has_password && identity_count.0 <= 1 {
        return Err(ApiError::Validation(
            "Cannot disconnect your only sign-in method. Set a password first or connect another account.".to_string()
        ));
    }

    // Check if identity exists
    let identity_exists: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM user_identities WHERE user_id = $1 AND provider = $2")
            .bind(user_id)
            .bind(&provider)
            .fetch_optional(&state.pool)
            .await?;

    if identity_exists.is_none() {
        return Err(ApiError::NotFound);
    }

    // Delete the identity
    sqlx::query("DELETE FROM user_identities WHERE user_id = $1 AND provider = $2")
        .bind(user_id)
        .bind(&provider)
        .execute(&state.pool)
        .await?;

    // Extract IP for logging
    let client_ip = extract_client_ip(&headers);

    // Log to audit table
    let _ = sqlx::query(
        r#"
        INSERT INTO user_identity_audit (user_id, action, provider, ip_address, user_agent)
        VALUES ($1, 'unlinked', $2, $3, $4)
        "#,
    )
    .bind(user_id)
    .bind(&provider)
    .bind(client_ip.as_deref())
    .bind(headers.get("user-agent").and_then(|h| h.to_str().ok()))
    .execute(&state.pool)
    .await;

    // Send email notification (fire and forget)
    let email_service = state.security_email.clone();
    let email_to = user.email;
    tokio::spawn(async move {
        email_service
            .send_account_unlinked(&email_to, &provider, client_ip.as_deref())
            .await;
    });

    Ok(StatusCode::NO_CONTENT)
}

/// Get available providers
/// GET /api/v1/account/identities/providers
pub async fn list_providers(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<Vec<ProviderInfo>>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Get connected providers
    let connected: Vec<(String,)> =
        sqlx::query_as("SELECT provider FROM user_identities WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&state.pool)
            .await?;

    let connected_providers: Vec<String> = connected.into_iter().map(|p| p.0).collect();

    let providers = vec![
        ProviderInfo {
            provider: "google".to_string(),
            display_name: "Google".to_string(),
            is_connected: connected_providers.contains(&"google".to_string()),
        },
        ProviderInfo {
            provider: "github".to_string(),
            display_name: "GitHub".to_string(),
            is_connected: connected_providers.contains(&"github".to_string()),
        },
    ];

    Ok(Json(providers))
}
