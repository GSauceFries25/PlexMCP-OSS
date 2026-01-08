//! Team invitation routes
//!
//! Handles team member invitations with secure token-based acceptance flow.

use axum::{
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::FromRow;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    auth::{
        generate_impossible_hash, hash_password, sessions, validate_password_strength, AuthUser,
    },
    error::{ApiError, ApiResult},
    routes::auth::extract_auth_audit_context,
    state::AppState,
};
use plexmcp_shared::types::{CustomLimits, EffectiveLimits, SubscriptionTier};

// Invitation expiry in days
const INVITATION_EXPIRY_DAYS: i64 = 7;

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateInvitationRequest {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct InvitationResponse {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct InvitationsListResponse {
    pub invitations: Vec<InvitationResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize)]
pub struct ValidateInvitationQuery {
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct InvitationValidationResponse {
    pub valid: bool,
    pub org_name: Option<String>,
    pub inviter_name: Option<String>,
    pub email: Option<String>,
    pub role: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
}

#[derive(Debug, Deserialize)]
pub struct AcceptInvitationRequest {
    pub token: String,
    /// Password for creating account (required if not using OAuth)
    pub password: Option<String>,
    /// OAuth provider for account creation (google or github)
    pub oauth_provider: Option<String>,
    /// Supabase access token from OAuth flow
    pub oauth_access_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AcceptInvitationResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub org_id: Uuid,
    pub org_name: String,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
struct InvitationRow {
    id: Uuid,
    org_id: Uuid,
    email: String,
    role: String,
    token: String,
    invited_by: Option<Uuid>,
    expires_at: OffsetDateTime,
    accepted_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Fields populated from DB
struct InvitationWithOrgRow {
    id: Uuid,
    org_id: Uuid,
    email: String,
    role: String,
    expires_at: OffsetDateTime,
    org_name: String,
    inviter_email: Option<String>,
}

// =============================================================================
// Token Generation
// =============================================================================

/// Generate a secure invitation token using UUID + HMAC signature
fn generate_invitation_token(invitation_id: Uuid, hmac_secret: &str) -> String {
    let payload = invitation_id.to_string();

    // Create HMAC signature
    type HmacSha256 = Hmac<Sha256>;
    #[allow(clippy::expect_used)] // HMAC accepts keys of any size; this cannot fail
    let mut mac =
        HmacSha256::new_from_slice(hmac_secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());
    let signature = mac.finalize().into_bytes();

    // Token format: {uuid}.{signature_hex_16_chars}
    format!("{}.{}", payload, hex::encode(&signature[..8]))
}

/// Validate and extract invitation ID from token
fn validate_invitation_token(token: &str, hmac_secret: &str) -> Option<Uuid> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 {
        return None;
    }

    let uuid_str = parts[0];
    let provided_sig = parts[1];

    // Parse UUID
    let invitation_id = Uuid::parse_str(uuid_str).ok()?;

    // Verify signature
    type HmacSha256 = Hmac<Sha256>;
    #[allow(clippy::expect_used)] // HMAC accepts keys of any size; this cannot fail
    let mut mac =
        HmacSha256::new_from_slice(hmac_secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(uuid_str.as_bytes());
    let expected_signature = mac.finalize().into_bytes();
    let expected_sig = hex::encode(&expected_signature[..8]);

    // Constant-time comparison
    if provided_sig.len() != expected_sig.len() {
        return None;
    }

    let matches = provided_sig
        .as_bytes()
        .iter()
        .zip(expected_sig.as_bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b));

    if matches == 0 {
        Some(invitation_id)
    } else {
        None
    }
}

// =============================================================================
// Handlers - Protected (require auth)
// =============================================================================

/// Create and send a new invitation
pub async fn create_invitation(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateInvitationRequest>,
) -> ApiResult<(StatusCode, Json<InvitationResponse>)> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let inviter_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Only owners and admins can invite
    if !["owner", "admin"].contains(&auth_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    // Validate role
    let valid_roles = ["admin", "member", "viewer"];
    if !valid_roles.contains(&req.role.as_str()) {
        return Err(ApiError::Validation(format!(
            "Invalid role. Must be one of: {}",
            valid_roles.join(", ")
        )));
    }

    // Admins can't invite admins
    if auth_user.role == "admin" && req.role == "admin" {
        return Err(ApiError::Forbidden);
    }

    let email = req.email.to_lowercase().trim().to_string();

    // Check if email format is valid
    if !is_valid_email(&email) {
        return Err(ApiError::Validation("Invalid email format".to_string()));
    }

    // Check if user already exists in this org
    let exists_user: Option<(bool,)> =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND org_id = $2)")
            .bind(&email)
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await?;

    if exists_user.map(|r| r.0).unwrap_or(false) {
        return Err(ApiError::Validation(
            "User already exists in this organization".to_string(),
        ));
    }

    // Check if there's already a pending invitation for this email
    let exists_invitation: Option<(bool,)> = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM invitations WHERE email = $1 AND org_id = $2 AND accepted_at IS NULL AND expires_at > NOW())"
    )
    .bind(&email)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?;

    if exists_invitation.map(|r| r.0).unwrap_or(false) {
        return Err(ApiError::Validation(
            "An invitation has already been sent to this email".to_string(),
        ));
    }

    // Check team member limit based on subscription tier (with custom enterprise overrides)
    let effective_limits = get_org_effective_limits(&state.pool, org_id).await?;
    let max_members = effective_limits.max_team_members;

    // Only check limit if tier has a limit (not unlimited)
    if max_members != u32::MAX {
        // Count active members (excluding suspended and pending)
        let active_count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM organization_members
            WHERE org_id = $1 AND status = 'active'
            "#,
        )
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

        // Count pending invitations
        let pending_invites: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM invitations
            WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
            "#,
        )
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

        let total_count = active_count.0 + pending_invites.0;

        if total_count >= max_members as i64 {
            return Err(ApiError::Validation(format!(
                "Team member limit reached ({}/{}). Contact support to increase your limit.",
                total_count, max_members
            )));
        }
    }

    // Create invitation
    let invitation_id = Uuid::new_v4();
    let token = generate_invitation_token(invitation_id, &state.config.api_key_hmac_secret);
    let expires_at = OffsetDateTime::now_utc() + time::Duration::days(INVITATION_EXPIRY_DAYS);

    sqlx::query(
        r#"
        INSERT INTO invitations (id, org_id, email, role, token, invited_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(invitation_id)
    .bind(org_id)
    .bind(&email)
    .bind(&req.role)
    .bind(&token)
    .bind(inviter_id)
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    // Get org name and inviter email for the invitation email
    let org_info: (String,) = sqlx::query_as("SELECT name FROM organizations WHERE id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    let inviter_info: (String,) = sqlx::query_as("SELECT email FROM users WHERE id = $1")
        .bind(inviter_id)
        .fetch_one(&state.pool)
        .await?;

    // Send invitation email
    let accept_url = format!("{}/accept-invite?token={}", state.config.public_url, token);
    let email_service = state.security_email.clone();
    let to_email = email.clone();
    let org_name = org_info.0.clone();
    let inviter_name = inviter_info.0.clone();
    let role = req.role.clone();

    tokio::spawn(async move {
        email_service
            .send_invitation_email(
                &to_email,
                &org_name,
                &inviter_name,
                &role,
                &accept_url,
                INVITATION_EXPIRY_DAYS as i32,
            )
            .await;
    });

    let invitation: InvitationRow = sqlx::query_as(
        "SELECT id, org_id, email, role, token, invited_by, expires_at, accepted_at, created_at FROM invitations WHERE id = $1"
    )
    .bind(invitation_id)
    .fetch_one(&state.pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(InvitationResponse {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expires_at: invitation.expires_at,
            created_at: invitation.created_at,
        }),
    ))
}

/// List all pending invitations for the organization
pub async fn list_invitations(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<InvitationsListResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Only owners and admins can view invitations
    if !["owner", "admin"].contains(&auth_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    let invitations: Vec<InvitationRow> = sqlx::query_as(
        r#"
        SELECT id, org_id, email, role, token, invited_by, expires_at, accepted_at, created_at
        FROM invitations
        WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC
        "#,
    )
    .bind(org_id)
    .fetch_all(&state.pool)
    .await?;

    let total = invitations.len() as i64;

    let response: Vec<InvitationResponse> = invitations
        .into_iter()
        .map(|i| InvitationResponse {
            id: i.id,
            email: i.email,
            role: i.role,
            expires_at: i.expires_at,
            created_at: i.created_at,
        })
        .collect();

    Ok(Json(InvitationsListResponse {
        invitations: response,
        total,
    }))
}

/// Resend an invitation email
pub async fn resend_invitation(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(invitation_id): Path<Uuid>,
) -> ApiResult<(StatusCode, Json<serde_json::Value>)> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Only owners and admins can resend invitations
    if !["owner", "admin"].contains(&auth_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    // Get the invitation
    let invitation: InvitationRow = sqlx::query_as(
        r#"
        SELECT id, org_id, email, role, token, invited_by, expires_at, accepted_at, created_at
        FROM invitations
        WHERE id = $1 AND org_id = $2
        "#,
    )
    .bind(invitation_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Check if already accepted
    if invitation.accepted_at.is_some() {
        return Err(ApiError::Validation(
            "Invitation has already been accepted".to_string(),
        ));
    }

    // Check if expired - if so, generate new token and extend expiry
    let (token, expires_at) = if invitation.expires_at < OffsetDateTime::now_utc() {
        let new_token = generate_invitation_token(invitation_id, &state.config.api_key_hmac_secret);
        let new_expires_at =
            OffsetDateTime::now_utc() + time::Duration::days(INVITATION_EXPIRY_DAYS);

        sqlx::query("UPDATE invitations SET token = $1, expires_at = $2 WHERE id = $3")
            .bind(&new_token)
            .bind(new_expires_at)
            .bind(invitation_id)
            .execute(&state.pool)
            .await?;

        (new_token, new_expires_at)
    } else {
        (invitation.token.clone(), invitation.expires_at)
    };

    // Get org name and inviter email
    let org_info: (String,) = sqlx::query_as("SELECT name FROM organizations WHERE id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    let inviter_email = if let Some(inviter_id) = invitation.invited_by {
        let info: Option<(String,)> = sqlx::query_as("SELECT email FROM users WHERE id = $1")
            .bind(inviter_id)
            .fetch_optional(&state.pool)
            .await?;
        info.map(|i| i.0)
            .unwrap_or_else(|| "A team member".to_string())
    } else {
        "A team member".to_string()
    };

    // Send invitation email
    let accept_url = format!("{}/accept-invite?token={}", state.config.public_url, token);
    let email_service = state.security_email.clone();
    let to_email = invitation.email.clone();
    let org_name = org_info.0;
    let role = invitation.role.clone();
    let days = ((expires_at - OffsetDateTime::now_utc()).whole_days() + 1) as i32;

    tokio::spawn(async move {
        email_service
            .send_invitation_email(
                &to_email,
                &org_name,
                &inviter_email,
                &role,
                &accept_url,
                days,
            )
            .await;
    });

    Ok((StatusCode::OK, Json(serde_json::json!({"success": true}))))
}

/// Cancel a pending invitation
pub async fn cancel_invitation(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(invitation_id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Only owners and admins can cancel invitations
    if !["owner", "admin"].contains(&auth_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    // Delete the invitation
    let result = sqlx::query(
        "DELETE FROM invitations WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL",
    )
    .bind(invitation_id)
    .bind(org_id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

// =============================================================================
// Handlers - Public (no auth required)
// =============================================================================

/// Validate an invitation token (public endpoint)
pub async fn validate_invitation(
    State(state): State<AppState>,
    Query(query): Query<ValidateInvitationQuery>,
) -> ApiResult<Json<InvitationValidationResponse>> {
    // Validate token format
    let invitation_id =
        match validate_invitation_token(&query.token, &state.config.api_key_hmac_secret) {
            Some(id) => id,
            None => {
                return Ok(Json(InvitationValidationResponse {
                    valid: false,
                    org_name: None,
                    inviter_name: None,
                    email: None,
                    role: None,
                    expires_at: None,
                }));
            }
        };

    // Look up invitation with org details
    let invitation: Option<InvitationWithOrgRow> = sqlx::query_as(
        r#"
        SELECT
            i.id, i.org_id, i.email, i.role, i.expires_at,
            o.name as org_name,
            u.email as inviter_email
        FROM invitations i
        JOIN organizations o ON o.id = i.org_id
        LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.id = $1 AND i.token = $2
        "#,
    )
    .bind(invitation_id)
    .bind(&query.token)
    .fetch_optional(&state.pool)
    .await?;

    let invitation = match invitation {
        Some(i) => i,
        None => {
            return Ok(Json(InvitationValidationResponse {
                valid: false,
                org_name: None,
                inviter_name: None,
                email: None,
                role: None,
                expires_at: None,
            }));
        }
    };

    // Check if expired
    if invitation.expires_at < OffsetDateTime::now_utc() {
        return Ok(Json(InvitationValidationResponse {
            valid: false,
            org_name: Some(invitation.org_name),
            inviter_name: invitation.inviter_email,
            email: Some(invitation.email),
            role: Some(invitation.role),
            expires_at: Some(invitation.expires_at),
        }));
    }

    // Check if already accepted by looking for a user with this email in the org
    let already_accepted: Option<(bool,)> =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND org_id = $2)")
            .bind(&invitation.email)
            .bind(invitation.org_id)
            .fetch_optional(&state.pool)
            .await?;

    if already_accepted.map(|r| r.0).unwrap_or(false) {
        return Ok(Json(InvitationValidationResponse {
            valid: false,
            org_name: Some(invitation.org_name),
            inviter_name: invitation.inviter_email,
            email: Some(invitation.email),
            role: Some(invitation.role),
            expires_at: Some(invitation.expires_at),
        }));
    }

    Ok(Json(InvitationValidationResponse {
        valid: true,
        org_name: Some(invitation.org_name),
        inviter_name: invitation.inviter_email,
        email: Some(invitation.email),
        role: Some(invitation.role),
        expires_at: Some(invitation.expires_at),
    }))
}

/// Accept an invitation and create user account (public endpoint)
pub async fn accept_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AcceptInvitationRequest>,
) -> ApiResult<Json<AcceptInvitationResponse>> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);
    // Validate token
    let invitation_id = validate_invitation_token(&req.token, &state.config.api_key_hmac_secret)
        .ok_or(ApiError::InvalidToken)?;

    // Get invitation details
    let invitation: InvitationRow = sqlx::query_as(
        r#"
        SELECT id, org_id, email, role, token, invited_by, expires_at, accepted_at, created_at
        FROM invitations
        WHERE id = $1 AND token = $2
        "#,
    )
    .bind(invitation_id)
    .bind(&req.token)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::InvalidToken)?;

    // Check if expired
    if invitation.expires_at < OffsetDateTime::now_utc() {
        return Err(ApiError::Validation(
            "This invitation has expired".to_string(),
        ));
    }

    // Check if already accepted
    if invitation.accepted_at.is_some() {
        return Err(ApiError::Validation(
            "This invitation has already been accepted".to_string(),
        ));
    }

    // Check if user already exists in this org
    let existing_user: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE email = $1 AND org_id = $2")
            .bind(&invitation.email)
            .bind(invitation.org_id)
            .fetch_optional(&state.pool)
            .await?;

    if existing_user.is_some() {
        return Err(ApiError::Validation(
            "An account with this email already exists in this organization".to_string(),
        ));
    }

    // Get org name for response
    let org_info: (String,) = sqlx::query_as("SELECT name FROM organizations WHERE id = $1")
        .bind(invitation.org_id)
        .fetch_one(&state.pool)
        .await?;

    let user_id: Uuid;
    let password_hash: String;

    // Handle account creation based on method
    if let Some(ref _oauth_provider) = req.oauth_provider {
        // OAuth-based account creation
        let access_token = req
            .oauth_access_token
            .as_ref()
            .ok_or_else(|| ApiError::Validation("OAuth access token required".to_string()))?;

        // Verify the OAuth token via Supabase
        let supabase_url = &state.config.supabase_url;
        let supabase_anon_key = &state.config.supabase_anon_key;

        if supabase_url.is_empty() || supabase_anon_key.is_empty() {
            return Err(ApiError::Internal);
        }

        let client = reqwest::Client::new();
        let url = format!("{}/auth/v1/user", supabase_url);

        let response = client
            .get(&url)
            .header("apikey", supabase_anon_key)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Failed to verify Supabase token: {}", e);
                ApiError::Unauthorized
            })?;

        if !response.status().is_success() {
            return Err(ApiError::Unauthorized);
        }

        #[derive(serde::Deserialize)]
        struct SupabaseUser {
            id: String,
            email: Option<String>,
        }

        let supabase_user: SupabaseUser = response.json().await.map_err(|e| {
            tracing::error!("Failed to parse Supabase user response: {}", e);
            ApiError::Internal
        })?;

        // Verify the email matches the invitation
        let oauth_email = supabase_user
            .email
            .as_ref()
            .ok_or_else(|| ApiError::Validation("OAuth account must have an email".to_string()))?;

        if oauth_email.to_lowercase() != invitation.email.to_lowercase() {
            return Err(ApiError::Validation(
                "OAuth account email does not match the invitation email".to_string(),
            ));
        }

        // Use the Supabase user ID
        user_id = Uuid::parse_str(&supabase_user.id).map_err(|_| ApiError::Internal)?;
        // SOC 2 CC6.1: Generate cryptographically random hash for OAuth users
        password_hash = generate_impossible_hash().map_err(|_| ApiError::Internal)?;
    } else if let Some(ref password) = req.password {
        // Password-based account creation
        validate_password_strength(password).map_err(|e| ApiError::Validation(e.to_string()))?;

        user_id = Uuid::new_v4();
        password_hash = hash_password(password).map_err(|_| ApiError::Internal)?;
    } else {
        return Err(ApiError::Validation(
            "Either password or OAuth provider is required".to_string(),
        ));
    }

    // Create user and mark invitation as accepted in a transaction
    let mut tx = state.pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO users (id, org_id, email, password_hash, role, email_verified)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        "#,
    )
    .bind(user_id)
    .bind(invitation.org_id)
    .bind(&invitation.email)
    .bind(&password_hash)
    .bind(&invitation.role)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE invitations SET accepted_at = NOW() WHERE id = $1")
        .bind(invitation_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    // Generate JWT tokens
    let (access_token, access_jti, refresh_token, refresh_jti) = state
        .jwt_manager
        .generate_token_pair(
            user_id,
            invitation.org_id,
            &invitation.role,
            &invitation.email,
        )
        .map_err(|_| ApiError::Internal)?;

    // Save session for revocation support
    let access_expires_at =
        OffsetDateTime::now_utc() + Duration::hours(state.config.jwt_expiry_hours);
    let refresh_expires_at = OffsetDateTime::now_utc() + Duration::days(30);
    sessions::save_session(
        &state.pool,
        user_id,
        &access_jti,
        access_expires_at,
        &refresh_jti,
        refresh_expires_at,
        ip_address.as_deref(),
        user_agent.as_deref(),
    )
    .await?;

    // Send welcome email (fire and forget)
    let email_service = state.security_email.clone();
    let to_email = invitation.email.clone();
    let org_name_for_email = org_info.0.clone();
    tokio::spawn(async move {
        email_service
            .send_invitation_accepted(&to_email, &org_name_for_email)
            .await;
    });

    Ok(Json(AcceptInvitationResponse {
        access_token,
        refresh_token,
        token_type: "Bearer".to_string(),
        expires_in: state.jwt_manager.access_token_expiry_seconds(),
        user: UserResponse {
            id: user_id,
            email: invitation.email,
            role: invitation.role,
            org_id: invitation.org_id,
            org_name: org_info.0,
        },
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
async fn get_org_effective_limits(
    pool: &sqlx::PgPool,
    org_id: Uuid,
) -> Result<EffectiveLimits, ApiError> {
    let result: Option<OrgLimitData> = sqlx::query_as(
        r#"SELECT subscription_tier, custom_max_mcps, custom_max_api_keys,
                  custom_max_team_members, custom_max_requests_monthly,
                  custom_overage_rate_cents, custom_monthly_price_cents
           FROM organizations WHERE id = $1"#,
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await?;

    let data = result.ok_or(ApiError::NotFound)?;
    let tier: SubscriptionTier = data
        .subscription_tier
        .parse()
        .unwrap_or(SubscriptionTier::Free);
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

// =============================================================================
// Helpers
// =============================================================================

fn is_valid_email(email: &str) -> bool {
    let email = email.trim().to_lowercase();
    if email.len() > 254 {
        return false;
    }

    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 {
        return false;
    }

    let local = parts[0];
    let domain = parts[1];

    if local.is_empty() || local.len() > 64 {
        return false;
    }

    if domain.is_empty() || !domain.contains('.') {
        return false;
    }

    true
}
