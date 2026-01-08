//! Audit logging routes for OAuth and session events
//!
//! This module provides endpoints to log authentication events that occur
//! outside the standard backend authentication flow, particularly OAuth
//! authentication via Supabase and session lifecycle events.
//!
//! SOC 2 Compliance: CC6.2 (Authentication and Credential Management)

use axum::{
    extract::{Extension, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    audit_constants::{auth_event, severity},
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

use super::extract_client_ip;
use axum::http::HeaderMap;

// =============================================================================
// Request/Response Types
// =============================================================================

/// Request to log OAuth authentication initiation
#[derive(Debug, Deserialize)]
pub struct OAuthInitiatedRequest {
    /// OAuth provider (google, github)
    pub provider: String,
    /// User's email (if known at this stage)
    pub email: Option<String>,
    /// Redirect URL for audit trail
    pub redirect_url: Option<String>,
}

/// Request to log OAuth callback received
#[derive(Debug, Deserialize)]
pub struct OAuthCallbackRequest {
    /// OAuth provider (google, github)
    pub provider: String,
    /// Whether the callback included a valid authorization code
    pub has_auth_code: bool,
    /// Whether callback included an error
    pub error: Option<String>,
}

/// Request to log OAuth session creation
#[derive(Debug, Deserialize)]
pub struct OAuthSessionCreatedRequest {
    /// OAuth provider (google, github)
    pub provider: String,
    /// User's email from OAuth provider
    pub email: String,
    /// Supabase session ID (if available)
    pub session_id: Option<String>,
    /// Whether this is a new user registration via OAuth
    pub is_new_user: bool,
}

/// Request to log session lifecycle events (logout, token refresh, expiration)
#[derive(Debug, Deserialize)]
pub struct SessionEventRequest {
    /// Event name (logout, token_refreshed, session_expired)
    pub event_name: String,
    /// Session ID that was affected
    pub session_id: Option<String>,
    /// Optional reason for the event
    pub reason: Option<String>,
}

/// Standard success response for audit logging
#[derive(Debug, Serialize)]
pub struct AuditLogResponse {
    pub success: bool,
    pub message: String,
}

// =============================================================================
// Audit Logging Handlers
// =============================================================================

/// Log OAuth authentication initiation
///
/// Called when user clicks "Sign in with Google" or "Sign in with GitHub"
/// before redirecting to the OAuth provider.
///
/// **Endpoint**: `POST /api/v1/audit/oauth-initiated`
///
/// **Authentication**: None required (happens before auth)
///
/// **SOC 2**: CC6.2 - Tracks authentication attempts
pub async fn oauth_initiated(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<OAuthInitiatedRequest>,
) -> ApiResult<Json<AuditLogResponse>> {
    let ip_address = extract_client_ip(&headers);
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    // Log the OAuth initiation event
    let metadata = serde_json::json!({
        "provider": payload.provider,
        "redirect_url": payload.redirect_url,
        "timestamp": OffsetDateTime::now_utc().to_string(),
    });

    // Use provided email or placeholder (email not always known at initiation)
    let email = payload
        .email
        .unwrap_or_else(|| format!("oauth_init@{}.pending", payload.provider));

    sqlx::query(
        r#"
        INSERT INTO auth_audit_log (
            user_id, event_type, email, metadata, severity,
            ip_address, user_agent, provider, auth_method
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(None::<Uuid>) // No user_id yet
    .bind(auth_event::OAUTH_INITIATED)
    .bind(&email)
    .bind(metadata)
    .bind(severity::INFO)
    .bind(ip_address)
    .bind(user_agent)
    .bind(&payload.provider)
    .bind("oauth")
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to log OAuth initiation: {}", e);
        ApiError::Internal
    })?;

    Ok(Json(AuditLogResponse {
        success: true,
        message: format!("OAuth initiation logged for provider: {}", payload.provider),
    }))
}

/// Log OAuth callback received
///
/// Called when OAuth provider redirects back to the application with
/// authorization code or error.
///
/// **Endpoint**: `POST /api/v1/audit/oauth-callback`
///
/// **Authentication**: None required (happens during auth flow)
///
/// **SOC 2**: CC6.2 - Tracks OAuth callback handling
pub async fn oauth_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<OAuthCallbackRequest>,
) -> ApiResult<Json<AuditLogResponse>> {
    let ip_address = extract_client_ip(&headers);
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    let event_name = if payload.error.is_some() {
        auth_event::OAUTH_CALLBACK_FAILED
    } else if payload.has_auth_code {
        auth_event::OAUTH_CALLBACK_SUCCESS
    } else {
        "oauth_callback_received"
    };

    let severity_level = if payload.error.is_some() {
        severity::WARNING
    } else {
        severity::INFO
    };

    let metadata = serde_json::json!({
        "provider": payload.provider,
        "has_auth_code": payload.has_auth_code,
        "error": payload.error,
        "timestamp": OffsetDateTime::now_utc().to_string(),
    });

    // Use placeholder email for OAuth callback (email not yet known)
    // The actual email will be logged in oauth-session-created endpoint
    let placeholder_email = format!("oauth_pending@{}.callback", payload.provider);

    sqlx::query(
        r#"
        INSERT INTO auth_audit_log (
            user_id, event_type, email, metadata, severity,
            ip_address, user_agent, provider, auth_method
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(None::<Uuid>) // No user_id yet
    .bind(event_name)
    .bind(&placeholder_email) // Placeholder until session is created
    .bind(metadata)
    .bind(severity_level)
    .bind(ip_address)
    .bind(user_agent)
    .bind(&payload.provider)
    .bind("oauth")
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to log OAuth callback: {}", e);
        ApiError::Internal
    })?;

    Ok(Json(AuditLogResponse {
        success: true,
        message: format!("OAuth callback logged for provider: {}", payload.provider),
    }))
}

/// Log OAuth session creation
///
/// Called after successful OAuth authentication and session establishment
/// in Supabase. This is the final step where we know the user's identity.
///
/// **Endpoint**: `POST /api/v1/audit/oauth-session-created`
///
/// **Authentication**: None required (happens at end of auth flow)
///
/// **SOC 2**: CC6.2 - Tracks successful authentications
pub async fn oauth_session_created(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<OAuthSessionCreatedRequest>,
) -> ApiResult<Json<AuditLogResponse>> {
    let ip_address = extract_client_ip(&headers);
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    // Look up user_id from email (if user exists)
    let user_id: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id FROM users WHERE email = $1
        "#,
    )
    .bind(&payload.email)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to lookup user_id by email: {}", e);
        ApiError::Internal
    })?;

    let event_name = if payload.is_new_user {
        auth_event::OAUTH_SIGNUP_SUCCESS
    } else {
        auth_event::OAUTH_LOGIN_SUCCESS
    };

    let metadata = serde_json::json!({
        "provider": payload.provider,
        "session_id": payload.session_id,
        "is_new_user": payload.is_new_user,
        "timestamp": OffsetDateTime::now_utc().to_string(),
    });

    sqlx::query(
        r#"
        INSERT INTO auth_audit_log (
            user_id, event_type, email, metadata, severity,
            ip_address, user_agent, provider, auth_method
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(user_id)
    .bind(event_name)
    .bind(&payload.email)
    .bind(metadata)
    .bind(severity::INFO)
    .bind(ip_address)
    .bind(user_agent)
    .bind(&payload.provider)
    .bind("oauth")
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to log OAuth session creation: {}", e);
        ApiError::Internal
    })?;

    Ok(Json(AuditLogResponse {
        success: true,
        message: format!("OAuth session creation logged for email: {}", payload.email),
    }))
}

/// Log session lifecycle events
///
/// Called for logout, token refresh, session expiration events that occur
/// after authentication is complete.
///
/// **Endpoint**: `POST /api/v1/audit/session-event`
///
/// **Authentication**: Optional (user may be authenticated)
///
/// **SOC 2**: CC6.2 - Tracks session lifecycle
pub async fn session_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth_user: Option<Extension<AuthUser>>,
    Json(payload): Json<SessionEventRequest>,
) -> ApiResult<Json<AuditLogResponse>> {
    // ENHANCED DEBUG LOGGING
    tracing::info!(
        event_name = %payload.event_name,
        session_id = ?payload.session_id,
        reason = ?payload.reason,
        has_auth = auth_user.is_some(),
        "session_event endpoint called"
    );

    let ip_address = extract_client_ip(&headers);
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    let user_id = auth_user.as_ref().map(|u| u.user_id);
    let email = if let Some(user) = auth_user.as_ref() {
        // Look up email from user_id
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT email FROM users WHERE id = $1
            "#,
        )
        .bind(user.user_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "unknown@system".to_string())
    } else {
        // Use placeholder for unauthenticated session events
        "anonymous@system".to_string()
    };

    // Map event names to standard event types
    let (event_type, severity_level) = match payload.event_name.as_str() {
        "logout" => (auth_event::LOGOUT, severity::INFO), // FIXED: Use LOGOUT not LOGOUT_SUCCESS
        "token_refreshed" => (auth_event::TOKEN_REFRESHED, severity::INFO),
        "session_expired" => (auth_event::SESSION_EXPIRED, severity::WARNING),
        "signed_in" => (auth_event::SESSION_ESTABLISHED, severity::INFO),
        _ => {
            // Log unknown event type and use safe default
            tracing::warn!(
                event_name = %payload.event_name,
                session_id = ?payload.session_id,
                "Unknown session event type, using session_established as fallback"
            );
            (auth_event::SESSION_ESTABLISHED, severity::INFO)
        }
    };

    tracing::info!(
        event_name_received = %payload.event_name,
        event_type_mapped = %event_type,
        severity = %severity_level,
        user_id = ?user_id,
        "Mapped event name to database event type"
    );

    let metadata = serde_json::json!({
        "session_id": payload.session_id,
        "reason": payload.reason,
        "timestamp": OffsetDateTime::now_utc().to_string(),
    });

    sqlx::query(
        r#"
        INSERT INTO auth_audit_log (
            user_id, event_type, email, metadata, severity,
            ip_address, user_agent, provider, auth_method
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(user_id)
    .bind(event_type)
    .bind(&email)
    .bind(&metadata)
    .bind(severity_level)
    .bind(&ip_address)
    .bind(&user_agent)
    .bind(None::<String>) // No provider for session events
    .bind("session")
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(
            error = %e,
            event_name = %payload.event_name,
            event_type = %event_type,
            severity = %severity_level,
            user_id = ?user_id,
            email = %email,
            metadata = ?metadata,
            "Failed to insert session event into auth_audit_log - DATABASE ERROR"
        );
        ApiError::Internal
    })?;

    tracing::info!(
        event_name = %payload.event_name,
        event_type = %event_type,
        user_id = ?user_id,
        "Successfully logged session event to database"
    );

    Ok(Json(AuditLogResponse {
        success: true,
        message: format!("Session event logged: {}", payload.event_name),
    }))
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Helper function to log audit events from backend code
///
/// This is a convenience function for logging audit events that don't require
/// HTTP request context.
#[allow(clippy::too_many_arguments)]
pub async fn log_audit_event(
    pool: &PgPool,
    user_id: Option<Uuid>,
    event_name: &str,
    email: Option<String>,
    details: Option<serde_json::Value>,
    provider: Option<String>,
    auth_method: Option<String>,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> ApiResult<()> {
    sqlx::query(
        r#"
        INSERT INTO auth_audit_log (
            user_id, event_type, email, metadata, severity,
            ip_address, user_agent, provider, auth_method
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(user_id)
    .bind(event_name)
    .bind(email)
    .bind(details.unwrap_or_else(|| serde_json::json!({})))
    .bind(severity::INFO)
    .bind(ip_address)
    .bind(user_agent)
    .bind(provider)
    .bind(auth_method)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to log audit event: {}", e);
        ApiError::Internal
    })?;

    Ok(())
}
