//! GDPR Compliance Endpoints
//!
//! Implements data subject rights under GDPR:
//! - Article 15: Right to Access (data export)
//! - Article 17: Right to Erasure (data deletion)

use axum::{extract::State, Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

// ============================================================================
// GDPR Data Export (Article 15 - Right to Access)
// ============================================================================

/// User profile data for export
#[derive(Debug, Serialize, FromRow)]
pub struct ExportedUserData {
    pub id: Uuid,
    pub email: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_login_at: Option<OffsetDateTime>,
    pub two_fa_enabled: bool,
}

/// Organization membership data for export
#[derive(Debug, Serialize, FromRow)]
pub struct ExportedOrgMembership {
    pub org_id: Uuid,
    pub org_name: String,
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
}

/// API key data for export (masked for security)
#[derive(Debug, Serialize, FromRow)]
pub struct ExportedApiKey {
    pub id: Uuid,
    pub name: String,
    pub masked_key: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_used_at: Option<OffsetDateTime>,
}

/// Support ticket data for export
#[derive(Debug, Serialize, FromRow)]
pub struct ExportedTicket {
    pub id: Uuid,
    pub ticket_number: String,
    pub subject: String,
    pub status: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// Audit log entry for export
#[derive(Debug, Serialize, FromRow)]
pub struct ExportedAuditEntry {
    pub event_type: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// Usage record for export
#[derive(Debug, Serialize, FromRow)]
pub struct ExportedUsageRecord {
    pub date: time::Date,
    pub request_count: i64,
    pub tokens_used: i64,
}

/// Complete GDPR data export response
#[derive(Debug, Serialize)]
pub struct GdprDataExport {
    pub user: ExportedUserData,
    pub organizations: Vec<ExportedOrgMembership>,
    pub api_keys: Vec<ExportedApiKey>,
    pub support_tickets: Vec<ExportedTicket>,
    pub audit_logs: Vec<ExportedAuditEntry>,
    pub usage_records: Vec<ExportedUsageRecord>,
    #[serde(with = "time::serde::rfc3339")]
    pub exported_at: OffsetDateTime,
}

/// Export all user data (GDPR Article 15 - Right to Access)
///
/// Returns a complete export of all data associated with the authenticated user,
/// including profile, organizations, API keys (masked), support tickets,
/// audit logs (last 90 days), and usage records (last 90 days).
pub async fn export_user_data(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<GdprDataExport>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Log the export request for audit trail
    tracing::info!(user_id = %user_id, "GDPR data export requested");

    // Fetch user profile with 2FA status
    let user: ExportedUserData = sqlx::query_as(
        r#"
        SELECT
            u.id,
            u.email,
            u.created_at,
            u.last_login_at,
            EXISTS(SELECT 1 FROM user_2fa WHERE user_id = u.id AND is_enabled = true) as two_fa_enabled
        FROM users u
        WHERE u.id = $1
        "#
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch user data for GDPR export");
        ApiError::Internal
    })?;

    // Fetch organization memberships
    let organizations: Vec<ExportedOrgMembership> = sqlx::query_as(
        r#"
        SELECT
            o.id as org_id,
            o.name as org_name,
            om.role,
            om.created_at as joined_at
        FROM organizations o
        JOIN organization_members om ON om.org_id = o.id
        WHERE om.user_id = $1
        ORDER BY om.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    // Fetch API keys (masked) from all organizations the user belongs to
    let api_keys: Vec<ExportedApiKey> = sqlx::query_as(
        r#"
        SELECT
            ak.id,
            ak.name,
            CONCAT('pmcp_', LEFT(ak.key_prefix, 4), '...') as masked_key,
            ak.created_at,
            ak.last_used_at
        FROM api_keys ak
        WHERE ak.org_id IN (
            SELECT org_id FROM organization_members WHERE user_id = $1
        )
        ORDER BY ak.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    // Fetch support tickets
    let support_tickets: Vec<ExportedTicket> = sqlx::query_as(
        r#"
        SELECT
            id,
            ticket_number,
            subject,
            status,
            created_at
        FROM support_tickets
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    // Fetch audit logs (last 90 days)
    let audit_logs: Vec<ExportedAuditEntry> = sqlx::query_as(
        r#"
        SELECT
            event_type,
            ip_address,
            user_agent,
            created_at
        FROM auth_audit_log
        WHERE user_id = $1
        AND created_at > NOW() - INTERVAL '90 days'
        ORDER BY created_at DESC
        LIMIT 1000
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    // Fetch usage records (last 90 days)
    let usage_records: Vec<ExportedUsageRecord> = sqlx::query_as(
        r#"
        SELECT
            date,
            request_count,
            tokens_used
        FROM usage_aggregates
        WHERE org_id IN (
            SELECT org_id FROM organization_members WHERE user_id = $1
        )
        AND date > CURRENT_DATE - INTERVAL '90 days'
        ORDER BY date DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let export = GdprDataExport {
        user,
        organizations,
        api_keys,
        support_tickets,
        audit_logs,
        usage_records,
        exported_at: OffsetDateTime::now_utc(),
    };

    // Log successful export for audit trail
    tracing::info!(
        user_id = %user_id,
        orgs_count = export.organizations.len(),
        keys_count = export.api_keys.len(),
        tickets_count = export.support_tickets.len(),
        audit_count = export.audit_logs.len(),
        usage_count = export.usage_records.len(),
        "GDPR data export completed"
    );

    Ok(Json(export))
}

// ============================================================================
// GDPR Data Deletion (Article 17 - Right to Erasure)
// ============================================================================

/// Request to delete user account
#[derive(Debug, Deserialize)]
pub struct DeleteAccountRequest {
    /// User must confirm their email to proceed
    pub confirm_email: String,
    /// Optional reason for deletion
    pub reason: Option<String>,
}

/// Response for deletion request
#[derive(Debug, Serialize)]
pub struct DeletionRequestResponse {
    pub request_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub scheduled_for: OffsetDateTime,
    pub message: String,
    pub can_cancel: bool,
}

/// Status of a deletion request
#[derive(Debug, Serialize)]
pub struct DeletionStatus {
    pub has_pending_request: bool,
    pub request_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub scheduled_for: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub requested_at: Option<OffsetDateTime>,
}

/// Get status of any pending deletion request
pub async fn get_deletion_status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<DeletionStatus>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let pending: Option<(Uuid, OffsetDateTime, OffsetDateTime)> = sqlx::query_as(
        r#"
        SELECT id, scheduled_for, requested_at
        FROM gdpr_deletion_requests
        WHERE user_id = $1
        AND completed_at IS NULL
        AND cancelled_at IS NULL
        ORDER BY requested_at DESC
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to check deletion status");
        ApiError::Internal
    })?;

    match pending {
        Some((id, scheduled_for, requested_at)) => Ok(Json(DeletionStatus {
            has_pending_request: true,
            request_id: Some(id),
            scheduled_for: Some(scheduled_for),
            requested_at: Some(requested_at),
        })),
        None => Ok(Json(DeletionStatus {
            has_pending_request: false,
            request_id: None,
            scheduled_for: None,
            requested_at: None,
        })),
    }
}

/// Request account deletion (GDPR Article 17 - Right to Erasure)
///
/// Creates a deletion request with a 30-day grace period.
/// During this period, the user can cancel the request.
/// After 30 days, a background job will permanently delete all user data.
pub async fn request_deletion(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<DeleteAccountRequest>,
) -> ApiResult<Json<DeletionRequestResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Verify email matches
    let user_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::NotFound)?;

    if req.confirm_email.to_lowercase() != user_email.to_lowercase() {
        return Err(ApiError::BadRequest(
            "Email confirmation does not match your account email".into(),
        ));
    }

    // Check for existing pending request
    let existing: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id FROM gdpr_deletion_requests
        WHERE user_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to check existing deletion request");
        ApiError::Internal
    })?;

    if existing.is_some() {
        return Err(ApiError::BadRequest(
            "A deletion request is already pending for your account".into(),
        ));
    }

    // Create deletion request (30-day grace period)
    let scheduled_for = OffsetDateTime::now_utc() + time::Duration::days(30);
    let request_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO gdpr_deletion_requests (id, user_id, reason, scheduled_for, requested_at)
        VALUES ($1, $2, $3, $4, NOW())
        "#,
    )
    .bind(request_id)
    .bind(user_id)
    .bind(&req.reason)
    .bind(scheduled_for)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to create deletion request");
        ApiError::Internal
    })?;

    // Log the deletion request for audit trail
    tracing::warn!(
        user_id = %user_id,
        request_id = %request_id,
        scheduled_for = %scheduled_for,
        reason = ?req.reason,
        "GDPR deletion request created"
    );

    // TODO: Send confirmation email to user about the scheduled deletion

    // TODO: SOC 2 GDPR Compliance - When background job processes this deletion after 30 days:
    // 1. Delete Stripe customer via stripe::Customer::delete() to comply with GDPR Article 17
    // 2. Delete all user data from database (users, organization_members, etc.)
    // 3. Delete audit logs older than retention period
    // 4. Mark completed_at = NOW() on the deletion request
    // Background job should query: SELECT * FROM gdpr_deletion_requests
    //   WHERE scheduled_for < NOW() AND completed_at IS NULL AND cancelled_at IS NULL

    Ok(Json(DeletionRequestResponse {
        request_id,
        scheduled_for,
        message: "Your account has been scheduled for deletion in 30 days. You can cancel this request at any time before the scheduled date.".into(),
        can_cancel: true,
    }))
}

/// Cancel a pending deletion request
pub async fn cancel_deletion(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<serde_json::Value>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let result = sqlx::query(
        r#"
        UPDATE gdpr_deletion_requests
        SET cancelled_at = NOW()
        WHERE user_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL
        "#,
    )
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to cancel deletion request");
        ApiError::Internal
    })?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    // Log the cancellation for audit trail
    tracing::info!(user_id = %user_id, "GDPR deletion request cancelled");

    Ok(Json(serde_json::json!({
        "message": "Your deletion request has been cancelled. Your account will remain active."
    })))
}
