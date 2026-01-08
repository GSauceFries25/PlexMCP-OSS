//! User management routes

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

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct InviteUserRequest {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub role: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserListResponse {
    pub users: Vec<UserSummary>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct UserSummary {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub email_verified: bool,
    pub last_login_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub joined_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize)]
pub struct UserDetailResponse {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub email_verified: bool,
    pub last_login_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    role: String,
    email_verified: bool,
    last_login_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct UserWithJoinedRow {
    id: Uuid,
    email: String,
    role: String,
    email_verified: bool,
    last_login_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
    joined_at: Option<OffsetDateTime>,
}

// =============================================================================
// Handlers
// =============================================================================

/// List all users in the organization
pub async fn list_users(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<UserListResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Only owners and admins can list users
    if !["owner", "admin"].contains(&auth_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    // Join with organization_members to get the joined_at date
    let users: Vec<UserWithJoinedRow> = sqlx::query_as(
        r#"
        SELECT
            u.id,
            u.email,
            u.role,
            u.email_verified,
            u.last_login_at,
            u.created_at,
            om.created_at as joined_at
        FROM users u
        LEFT JOIN organization_members om ON om.user_id = u.id AND om.org_id = $1
        WHERE u.org_id = $1
        ORDER BY om.created_at DESC NULLS LAST
        "#,
    )
    .bind(org_id)
    .fetch_all(&state.pool)
    .await?;

    let total = users.len() as i64;

    let user_summaries: Vec<UserSummary> = users
        .into_iter()
        .map(|u| UserSummary {
            id: u.id,
            email: u.email,
            role: u.role,
            email_verified: u.email_verified,
            last_login_at: u.last_login_at,
            created_at: u.created_at,
            joined_at: u.joined_at,
        })
        .collect();

    Ok(Json(UserListResponse {
        users: user_summaries,
        total,
    }))
}

/// Get a specific user by ID
pub async fn get_user(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> ApiResult<Json<UserDetailResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Users can only view themselves, owners/admins can view anyone in org
    let can_view =
        auth_user.user_id == Some(user_id) || ["owner", "admin"].contains(&auth_user.role.as_str());

    if !can_view {
        return Err(ApiError::Forbidden);
    }

    let user: UserRow = sqlx::query_as(
        r#"
        SELECT id, email, role, email_verified, last_login_at, created_at, updated_at
        FROM users
        WHERE id = $1 AND org_id = $2
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(UserDetailResponse {
        id: user.id,
        email: user.email,
        role: user.role,
        email_verified: user.email_verified,
        last_login_at: user.last_login_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
    }))
}

/// Invite a new user to the organization
///
/// This endpoint is deprecated in favor of POST /api/v1/invitations.
/// It now creates an invitation instead of a user directly.
/// The invited user will receive an email to complete their account setup.
pub async fn invite_user(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<InviteUserRequest>,
) -> ApiResult<(StatusCode, Json<InvitationResponse>)> {
    // Delegate to the invitations module
    let invitation_req = super::invitations::CreateInvitationRequest {
        email: req.email,
        role: req.role,
    };

    let (status, Json(invitation)) = super::invitations::create_invitation(
        State(state),
        Extension(auth_user),
        Json(invitation_req),
    )
    .await?;

    Ok((
        status,
        Json(InvitationResponse {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expires_at: invitation.expires_at,
            created_at: invitation.created_at,
        }),
    ))
}

/// Response for invitation (returned by invite_user)
#[derive(Debug, Serialize)]
pub struct InvitationResponse {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub expires_at: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

/// Update a user's role
pub async fn update_user(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Json(req): Json<UpdateUserRequest>,
) -> ApiResult<Json<UserDetailResponse>> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Only owners can update users, admins can update members/viewers
    if auth_user.role != "owner" && auth_user.role != "admin" {
        return Err(ApiError::Forbidden);
    }

    // Can't update yourself
    if auth_user.user_id == Some(user_id) {
        return Err(ApiError::BadRequest(
            "Cannot update your own role".to_string(),
        ));
    }

    // Get current user
    let target_user: UserRow = sqlx::query_as(
        r#"
        SELECT id, email, role, email_verified, last_login_at, created_at, updated_at
        FROM users
        WHERE id = $1 AND org_id = $2
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Admins can't modify owners or other admins
    if auth_user.role == "admin" && ["owner", "admin"].contains(&target_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    // Validate new role if provided
    if let Some(ref role) = req.role {
        let valid_roles = if auth_user.role == "owner" {
            vec!["owner", "admin", "member", "viewer"]
        } else {
            vec!["member", "viewer"]
        };

        if !valid_roles.contains(&role.as_str()) {
            return Err(ApiError::Validation(format!(
                "Invalid role. Must be one of: {}",
                valid_roles.join(", ")
            )));
        }

        sqlx::query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2")
            .bind(role)
            .bind(user_id)
            .execute(&state.pool)
            .await?;
    }

    // Fetch updated user
    let user: UserRow = sqlx::query_as(
        r#"
        SELECT id, email, role, email_verified, last_login_at, created_at, updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(UserDetailResponse {
        id: user.id,
        email: user.email,
        role: user.role,
        email_verified: user.email_verified,
        last_login_at: user.last_login_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
    }))
}

/// Remove a user from the organization
pub async fn delete_user(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Only owners can delete users, admins can delete members/viewers
    if auth_user.role != "owner" && auth_user.role != "admin" {
        return Err(ApiError::Forbidden);
    }

    // Can't delete yourself
    if auth_user.user_id == Some(user_id) {
        return Err(ApiError::BadRequest("Cannot delete yourself".to_string()));
    }

    // Get target user
    let target_user: UserRow = sqlx::query_as(
        r#"
        SELECT id, email, role, email_verified, last_login_at, created_at, updated_at
        FROM users
        WHERE id = $1 AND org_id = $2
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Admins can't delete owners or other admins
    if auth_user.role == "admin" && ["owner", "admin"].contains(&target_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    // Can't delete the only owner
    if target_user.role == "owner" {
        let owner_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM users WHERE org_id = $1 AND role = 'owner'")
                .bind(org_id)
                .fetch_one(&state.pool)
                .await?;

        if owner_count.0 <= 1 {
            return Err(ApiError::BadRequest(
                "Cannot delete the only owner. Transfer ownership first.".to_string(),
            ));
        }
    }

    sqlx::query("DELETE FROM users WHERE id = $1 AND org_id = $2")
        .bind(user_id)
        .bind(org_id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
