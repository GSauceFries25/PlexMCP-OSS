//! Notification preferences routes
//!
//! This module provides API endpoints for managing user notification preferences.

use axum::{
    extract::{Extension, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::{AuthMethod, AuthUser},
    error::{ApiError, ApiResult},
    state::AppState,
};

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationPreferences {
    /// Email alerts for important events
    pub email_alerts: bool,
    /// Weekly usage digest email
    pub weekly_digest: bool,
    /// Alerts when approaching usage limits
    pub usage_alerts: bool,
    /// Security-related notifications (always true, cannot be disabled)
    pub security_alerts: bool,
    /// Notifications for API errors
    pub api_error_notifications: bool,
    /// Marketing and promotional emails
    pub marketing_emails: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNotificationPreferencesRequest {
    /// Email alerts for important events
    #[serde(default)]
    pub email_alerts: Option<bool>,
    /// Weekly usage digest email
    #[serde(default)]
    pub weekly_digest: Option<bool>,
    /// Alerts when approaching usage limits
    #[serde(default)]
    pub usage_alerts: Option<bool>,
    /// Notifications for API errors
    #[serde(default)]
    pub api_error_notifications: Option<bool>,
    /// Marketing and promotional emails
    #[serde(default)]
    pub marketing_emails: Option<bool>,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Fields populated from DB
struct NotificationPreferencesRow {
    id: Uuid,
    user_id: Uuid,
    email_alerts: bool,
    weekly_digest: bool,
    usage_alerts: bool,
    security_alerts: bool,
    api_error_notifications: bool,
    marketing_emails: bool,
    created_at: OffsetDateTime,
    #[allow(dead_code)]
    updated_at: OffsetDateTime,
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Resolve the actual user_id in the `users` table.
/// For OAuth users (Supabase JWT), the auth user_id may not match the users table id.
/// In such cases, we look up the user by email to find the correct id.
async fn resolve_user_id(pool: &PgPool, auth_user: &AuthUser) -> Result<Uuid, ApiError> {
    let auth_user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // For Supabase JWT users, we need to check if the ID exists in users table
    // If not, look up by email
    if matches!(auth_user.auth_method, AuthMethod::SupabaseJwt) {
        // First, check if this user_id exists in users table
        let exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE id = $1")
            .bind(auth_user_id)
            .fetch_optional(pool)
            .await?;

        if exists.is_some() {
            return Ok(auth_user_id);
        }

        // If not found by ID, look up by email
        if let Some(ref email) = auth_user.email {
            let user: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1")
                .bind(email)
                .fetch_optional(pool)
                .await?;

            if let Some((user_id,)) = user {
                tracing::debug!(
                    auth_user_id = %auth_user_id,
                    resolved_user_id = %user_id,
                    email = %email,
                    "Resolved OAuth user ID to users table ID"
                );
                return Ok(user_id);
            }
        }

        // User not found in users table
        tracing::warn!(
            auth_user_id = %auth_user_id,
            email = ?auth_user.email,
            "OAuth user not found in users table"
        );
        return Err(ApiError::NotFound);
    }

    // For regular JWT auth, use the user_id directly
    Ok(auth_user_id)
}

// =============================================================================
// Handlers
// =============================================================================

/// Get notification preferences for current user
pub async fn get_notification_preferences(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<NotificationPreferences>> {
    let user_id = resolve_user_id(&state.pool, &auth_user).await?;

    // Query existing preferences
    let preferences: Option<NotificationPreferencesRow> = sqlx::query_as(
        r#"
        SELECT id, user_id, email_alerts, weekly_digest, usage_alerts,
               security_alerts, api_error_notifications, marketing_emails,
               created_at, updated_at
        FROM user_notification_preferences
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;

    // If no preferences exist, return defaults
    let prefs = match preferences {
        Some(row) => NotificationPreferences {
            email_alerts: row.email_alerts,
            weekly_digest: row.weekly_digest,
            usage_alerts: row.usage_alerts,
            security_alerts: true, // Always true
            api_error_notifications: row.api_error_notifications,
            marketing_emails: row.marketing_emails,
        },
        None => NotificationPreferences {
            email_alerts: true,
            weekly_digest: false,
            usage_alerts: true,
            security_alerts: true,
            api_error_notifications: true,
            marketing_emails: false,
        },
    };

    Ok(Json(prefs))
}

/// Update notification preferences for current user
pub async fn update_notification_preferences(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<UpdateNotificationPreferencesRequest>,
) -> ApiResult<Json<NotificationPreferences>> {
    let user_id = resolve_user_id(&state.pool, &auth_user).await?;

    // Get current preferences or defaults
    let current: Option<NotificationPreferencesRow> = sqlx::query_as(
        r#"
        SELECT id, user_id, email_alerts, weekly_digest, usage_alerts,
               security_alerts, api_error_notifications, marketing_emails,
               created_at, updated_at
        FROM user_notification_preferences
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;

    // Apply updates, using current values or defaults for unspecified fields
    let email_alerts = req
        .email_alerts
        .unwrap_or_else(|| current.as_ref().map(|c| c.email_alerts).unwrap_or(true));
    let weekly_digest = req
        .weekly_digest
        .unwrap_or_else(|| current.as_ref().map(|c| c.weekly_digest).unwrap_or(false));
    let usage_alerts = req
        .usage_alerts
        .unwrap_or_else(|| current.as_ref().map(|c| c.usage_alerts).unwrap_or(true));
    let api_error_notifications = req.api_error_notifications.unwrap_or_else(|| {
        current
            .as_ref()
            .map(|c| c.api_error_notifications)
            .unwrap_or(true)
    });
    let marketing_emails = req.marketing_emails.unwrap_or_else(|| {
        current
            .as_ref()
            .map(|c| c.marketing_emails)
            .unwrap_or(false)
    });

    // Upsert preferences
    sqlx::query(
        r#"
        INSERT INTO user_notification_preferences (
            user_id, email_alerts, weekly_digest, usage_alerts,
            security_alerts, api_error_notifications, marketing_emails
        )
        VALUES ($1, $2, $3, $4, true, $5, $6)
        ON CONFLICT (user_id) DO UPDATE SET
            email_alerts = EXCLUDED.email_alerts,
            weekly_digest = EXCLUDED.weekly_digest,
            usage_alerts = EXCLUDED.usage_alerts,
            api_error_notifications = EXCLUDED.api_error_notifications,
            marketing_emails = EXCLUDED.marketing_emails,
            updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(email_alerts)
    .bind(weekly_digest)
    .bind(usage_alerts)
    .bind(api_error_notifications)
    .bind(marketing_emails)
    .execute(&state.pool)
    .await?;

    tracing::info!(
        user_id = %user_id,
        "Notification preferences updated"
    );

    Ok(Json(NotificationPreferences {
        email_alerts,
        weekly_digest,
        usage_alerts,
        security_alerts: true, // Always true
        api_error_notifications,
        marketing_emails,
    }))
}
