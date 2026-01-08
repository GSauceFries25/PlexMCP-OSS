//! Support ticket routes
//! Force rebuild: 2025-12-26 19:45 UTC - Fix NUMERIC type mismatch in stats
//!
//! This module provides API endpoints for support tickets and FAQ management.

use axum::{
    extract::{Extension, Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    audit_constants::{admin_action, event_type, severity, target_type},
    auth::{AuthMethod, AuthUser},
    error::{ApiError, ApiResult},
    state::AppState,
    websocket::events::{ServerEvent, TicketMessageEvent},
};

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketCategory {
    General,
    Billing,
    Technical,
    FeatureRequest,
    BugReport,
    EnterpriseInquiry,
}

impl TicketCategory {
    fn as_str(&self) -> &'static str {
        match self {
            TicketCategory::General => "general",
            TicketCategory::Billing => "billing",
            TicketCategory::Technical => "technical",
            TicketCategory::FeatureRequest => "feature_request",
            TicketCategory::BugReport => "bug_report",
            TicketCategory::EnterpriseInquiry => "enterprise_inquiry",
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketPriority {
    Low,
    Medium,
    High,
    Urgent,
}

impl TicketPriority {
    fn as_str(&self) -> &'static str {
        match self {
            TicketPriority::Low => "low",
            TicketPriority::Medium => "medium",
            TicketPriority::High => "high",
            TicketPriority::Urgent => "urgent",
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketStatus {
    Open,
    InProgress,
    AwaitingResponse,
    Resolved,
    Closed,
}

#[derive(Debug, Deserialize)]
pub struct CreateTicketRequest {
    pub subject: String,
    /// The initial message content (aliased as 'description' for backwards compatibility)
    #[serde(alias = "description")]
    pub content: String,
    pub category: TicketCategory,
    /// Priority defaults to Medium if not provided
    #[serde(default = "default_priority")]
    pub priority: TicketPriority,
}

fn default_priority() -> TicketPriority {
    TicketPriority::Medium
}

#[derive(Debug, Deserialize)]
pub struct ReplyToTicketRequest {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct SupportTicket {
    pub id: Uuid,
    pub ticket_number: String,
    pub organization_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub subject: String,
    pub category: String,
    pub status: String,
    pub priority: String,
    pub assigned_to: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub resolved_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub closed_at: Option<OffsetDateTime>,

    // Email metadata
    pub source: Option<String>,
    pub original_email_from: Option<String>,
    pub original_email_to: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TicketMessage {
    pub id: Uuid,
    pub ticket_id: Uuid,
    pub sender_id: Option<Uuid>,
    pub is_admin_reply: bool,
    pub content: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct TicketWithMessages {
    #[serde(flatten)]
    pub ticket: SupportTicket,
    pub messages: Vec<TicketMessage>,
}

#[derive(Debug, Serialize)]
pub struct TicketsListResponse {
    pub tickets: Vec<SupportTicket>,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
struct TicketRow {
    id: Uuid,
    ticket_number: String,
    organization_id: Option<Uuid>,
    user_id: Option<Uuid>,
    subject: String,
    category: String,
    status: String,
    priority: String,
    assigned_to: Option<Uuid>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    resolved_at: Option<OffsetDateTime>,
    closed_at: Option<OffsetDateTime>,

    // Email metadata
    source: Option<String>,
    original_email_from: Option<String>,
    original_email_to: Option<String>,
}

impl From<TicketRow> for SupportTicket {
    fn from(row: TicketRow) -> Self {
        SupportTicket {
            id: row.id,
            ticket_number: row.ticket_number,
            organization_id: row.organization_id,
            user_id: row.user_id,
            subject: row.subject,
            category: row.category,
            status: row.status,
            priority: row.priority,
            assigned_to: row.assigned_to,
            created_at: row.created_at,
            updated_at: row.updated_at,
            resolved_at: row.resolved_at,
            closed_at: row.closed_at,

            // Email metadata
            source: row.source,
            original_email_from: row.original_email_from,
            original_email_to: row.original_email_to,
        }
    }
}

#[derive(Debug, FromRow)]
struct MessageRow {
    id: Uuid,
    ticket_id: Uuid,
    sender_id: Option<Uuid>,
    is_admin_reply: bool,
    content: String,
    created_at: OffsetDateTime,
}

impl From<MessageRow> for TicketMessage {
    fn from(row: MessageRow) -> Self {
        TicketMessage {
            id: row.id,
            ticket_id: row.ticket_id,
            sender_id: row.sender_id,
            is_admin_reply: row.is_admin_reply,
            content: row.content,
            created_at: row.created_at,
        }
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Resolve the actual user_id and organization_id for the authenticated user.
async fn resolve_user_context(
    pool: &PgPool,
    auth_user: &AuthUser,
) -> Result<(Uuid, Option<Uuid>), ApiError> {
    let auth_user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // For Supabase JWT users, look up by email if ID doesn't exist
    if matches!(auth_user.auth_method, AuthMethod::SupabaseJwt) {
        // Check if user exists
        let exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE id = $1")
            .bind(auth_user_id)
            .fetch_optional(pool)
            .await?;

        if exists.is_some() {
            // Get org membership (organization_members uses org_id, not organization_id)
            let org: Option<(Uuid,)> = sqlx::query_as(
                "SELECT org_id FROM organization_members WHERE user_id = $1 LIMIT 1",
            )
            .bind(auth_user_id)
            .fetch_optional(pool)
            .await?;

            return Ok((auth_user_id, org.map(|(id,)| id)));
        }

        // Look up by email
        if let Some(ref email) = auth_user.email {
            let user: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1")
                .bind(email)
                .fetch_optional(pool)
                .await?;

            if let Some((user_id,)) = user {
                // organization_members uses org_id, not organization_id
                let org: Option<(Uuid,)> = sqlx::query_as(
                    "SELECT org_id FROM organization_members WHERE user_id = $1 LIMIT 1",
                )
                .bind(user_id)
                .fetch_optional(pool)
                .await?;

                return Ok((user_id, org.map(|(id,)| id)));
            }
        }

        return Err(ApiError::NotFound);
    }

    // For regular JWT, use the org_id from the token
    Ok((auth_user_id, auth_user.org_id))
}

// =============================================================================
// Handlers
// =============================================================================

/// Create a new support ticket
pub async fn create_ticket(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateTicketRequest>,
) -> ApiResult<Json<SupportTicket>> {
    let (user_id, org_id) = resolve_user_context(&state.pool, &auth_user).await?;

    // SOC 2 CC6.1: Rate limit ticket creation to prevent support system abuse
    if let Some(oid) = org_id {
        match state.rate_limiter.check_ticket_creation(oid).await {
            Ok(result) if !result.allowed => {
                tracing::warn!(org_id = %oid, "create_ticket: Rate limit exceeded for organization");
                let retry_after = result.retry_after_seconds.unwrap_or(60);
                return Err(ApiError::TooManyRequests(format!(
                    "Too many support tickets created. Please try again in {} seconds.",
                    retry_after
                )));
            }
            Err(e) => {
                tracing::error!(error = ?e, "create_ticket: Rate limit check failed, allowing request");
            }
            _ => {}
        }
    }

    // Validate input length
    // SOC 2 CC6.1: Input validation prevents DoS via oversized payloads
    const MAX_SUBJECT_LENGTH: usize = 500;
    const MAX_CONTENT_LENGTH: usize = 50_000;

    if req.subject.trim().is_empty() {
        return Err(ApiError::BadRequest("Subject cannot be empty".into()));
    }
    if req.subject.len() > MAX_SUBJECT_LENGTH {
        return Err(ApiError::BadRequest(format!(
            "Subject too long (max {} characters)",
            MAX_SUBJECT_LENGTH
        )));
    }
    if req.content.trim().is_empty() {
        return Err(ApiError::BadRequest("Content cannot be empty".into()));
    }
    if req.content.len() > MAX_CONTENT_LENGTH {
        return Err(ApiError::BadRequest(format!(
            "Content too long (max {} characters)",
            MAX_CONTENT_LENGTH
        )));
    }

    // Insert the ticket (ticket_number is auto-generated by trigger)
    let ticket: TicketRow = sqlx::query_as(
        r#"
        INSERT INTO support_tickets (organization_id, user_id, subject, category, priority)
        VALUES ($1, $2, $3, $4::ticket_category, $5::ticket_priority)
        RETURNING id, ticket_number, organization_id, user_id, subject,
                  category::text, status::text, priority::text, assigned_to,
                  created_at, updated_at, resolved_at, closed_at
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .bind(&req.subject)
    .bind(req.category.as_str())
    .bind(req.priority.as_str())
    .fetch_one(&state.pool)
    .await?;

    let ticket_id = ticket.id;

    // Insert the initial message (the content)
    sqlx::query(
        r#"
        INSERT INTO ticket_messages (ticket_id, sender_id, is_admin_reply, content)
        VALUES ($1, $2, false, $3)
        "#,
    )
    .bind(ticket_id)
    .bind(user_id)
    .bind(&req.content)
    .execute(&state.pool)
    .await?;

    tracing::info!(
        ticket_id = %ticket_id,
        ticket_number = %ticket.ticket_number,
        user_id = %user_id,
        "Support ticket created"
    );

    Ok(Json(ticket.into()))
}

/// List tickets for the current user's organization
#[derive(Debug, Deserialize)]
pub struct ListTicketsQuery {
    pub status: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list_tickets(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<ListTicketsQuery>,
) -> ApiResult<Json<TicketsListResponse>> {
    let (user_id, org_id) = resolve_user_context(&state.pool, &auth_user).await?;

    let limit = query.limit.unwrap_or(50).min(100);

    // Build query based on whether we have an org_id or just user_id
    let tickets: Vec<TicketRow> = if let Some(org_id) = org_id {
        if let Some(status) = &query.status {
            sqlx::query_as(
                r#"
                SELECT id, ticket_number, organization_id, user_id, subject,
                       category::text, status::text, priority::text, assigned_to,
                       created_at, updated_at, resolved_at, closed_at,
                       source, original_email_from, original_email_to
                FROM support_tickets
                WHERE organization_id = $1 AND status::text = $2
                ORDER BY created_at DESC
                LIMIT $3
                "#,
            )
            .bind(org_id)
            .bind(status)
            .bind(limit)
            .fetch_all(&state.pool)
            .await?
        } else {
            sqlx::query_as(
                r#"
                SELECT id, ticket_number, organization_id, user_id, subject,
                       category::text, status::text, priority::text, assigned_to,
                       created_at, updated_at, resolved_at, closed_at,
                       source, original_email_from, original_email_to
                FROM support_tickets
                WHERE organization_id = $1
                ORDER BY created_at DESC
                LIMIT $2
                "#,
            )
            .bind(org_id)
            .bind(limit)
            .fetch_all(&state.pool)
            .await?
        }
    } else {
        // No org, filter by user_id
        if let Some(status) = &query.status {
            sqlx::query_as(
                r#"
                SELECT id, ticket_number, organization_id, user_id, subject,
                       category::text, status::text, priority::text, assigned_to,
                       created_at, updated_at, resolved_at, closed_at,
                       source, original_email_from, original_email_to
                FROM support_tickets
                WHERE user_id = $1 AND status::text = $2
                ORDER BY created_at DESC
                LIMIT $3
                "#,
            )
            .bind(user_id)
            .bind(status)
            .bind(limit)
            .fetch_all(&state.pool)
            .await?
        } else {
            sqlx::query_as(
                r#"
                SELECT id, ticket_number, organization_id, user_id, subject,
                       category::text, status::text, priority::text, assigned_to,
                       created_at, updated_at, resolved_at, closed_at,
                       source, original_email_from, original_email_to
                FROM support_tickets
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT $2
                "#,
            )
            .bind(user_id)
            .bind(limit)
            .fetch_all(&state.pool)
            .await?
        }
    };

    Ok(Json(TicketsListResponse {
        tickets: tickets.into_iter().map(Into::into).collect(),
    }))
}

/// Get a single ticket with its messages
pub async fn get_ticket(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
) -> ApiResult<Json<TicketWithMessages>> {
    let (user_id, org_id) = resolve_user_context(&state.pool, &auth_user).await?;

    // Get the ticket, verifying access
    let ticket: Option<TicketRow> = if let Some(org_id) = org_id {
        sqlx::query_as(
            r#"
            SELECT id, ticket_number, organization_id, user_id, subject,
                   category::text, status::text, priority::text, assigned_to,
                   created_at, updated_at, resolved_at, closed_at,
                   source, original_email_from, original_email_to
            FROM support_tickets
            WHERE id = $1 AND organization_id = $2
            "#,
        )
        .bind(ticket_id)
        .bind(org_id)
        .fetch_optional(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            r#"
            SELECT id, ticket_number, organization_id, user_id, subject,
                   category::text, status::text, priority::text, assigned_to,
                   created_at, updated_at, resolved_at, closed_at,
                   source, original_email_from, original_email_to
            FROM support_tickets
            WHERE id = $1 AND user_id = $2
            "#,
        )
        .bind(ticket_id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
    };

    let ticket = ticket.ok_or(ApiError::NotFound)?;

    // Get messages
    let messages: Vec<MessageRow> = sqlx::query_as(
        r#"
        SELECT id, ticket_id, sender_id, is_admin_reply, content, created_at
        FROM ticket_messages
        WHERE ticket_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(ticket_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(TicketWithMessages {
        ticket: ticket.into(),
        messages: messages.into_iter().map(Into::into).collect(),
    }))
}

/// Admin: Get any ticket with messages (bypasses organization check)
pub async fn admin_get_ticket(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
) -> ApiResult<Json<TicketWithMessages>> {
    // Verify admin access
    require_platform_admin(&state.pool, &auth_user, false).await?;

    // Get the ticket without organization/user restrictions
    let ticket: Option<TicketRow> = sqlx::query_as(
        r#"
        SELECT id, ticket_number, organization_id, user_id, subject,
               category::text, status::text, priority::text, assigned_to,
               created_at, updated_at, resolved_at, closed_at,
               source, original_email_from, original_email_to
        FROM support_tickets
        WHERE id = $1
        "#,
    )
    .bind(ticket_id)
    .fetch_optional(&state.pool)
    .await?;

    let ticket = ticket.ok_or(ApiError::NotFound)?;

    // Get messages
    let messages: Vec<MessageRow> = sqlx::query_as(
        r#"
        SELECT id, ticket_id, sender_id, is_admin_reply, content, created_at
        FROM ticket_messages
        WHERE ticket_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(ticket_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(TicketWithMessages {
        ticket: ticket.into(),
        messages: messages.into_iter().map(Into::into).collect(),
    }))
}

/// Reply to a ticket
pub async fn reply_to_ticket(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
    Json(req): Json<ReplyToTicketRequest>,
) -> ApiResult<Json<TicketMessage>> {
    let (user_id, org_id) = resolve_user_context(&state.pool, &auth_user).await?;

    if req.content.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Message content cannot be empty".into(),
        ));
    }

    // Verify ticket access
    let ticket_exists: bool = if let Some(org_id) = org_id {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM support_tickets WHERE id = $1 AND organization_id = $2)",
        )
        .bind(ticket_id)
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM support_tickets WHERE id = $1 AND user_id = $2)",
        )
        .bind(ticket_id)
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?
    };

    if !ticket_exists {
        return Err(ApiError::NotFound);
    }

    // Insert the message
    let message: MessageRow = sqlx::query_as(
        r#"
        INSERT INTO ticket_messages (ticket_id, sender_id, is_admin_reply, content)
        VALUES ($1, $2, false, $3)
        RETURNING id, ticket_id, sender_id, is_admin_reply, content, created_at
        "#,
    )
    .bind(ticket_id)
    .bind(user_id)
    .bind(&req.content)
    .fetch_one(&state.pool)
    .await?;

    // Update ticket status to awaiting_response if it was resolved
    sqlx::query(
        r#"
        UPDATE support_tickets
        SET status = 'open'::ticket_status, updated_at = NOW()
        WHERE id = $1 AND status IN ('resolved'::ticket_status, 'closed'::ticket_status)
        "#,
    )
    .bind(ticket_id)
    .execute(&state.pool)
    .await?;

    // Broadcast new message to WebSocket subscribers
    state
        .ws_state
        .rooms
        .broadcast(
            &ticket_id,
            ServerEvent::NewMessage {
                ticket_id,
                message: TicketMessageEvent {
                    id: message.id,
                    ticket_id,
                    sender_id: message.sender_id,
                    sender_name: None, // Client can resolve via sender_id
                    is_admin_reply: message.is_admin_reply,
                    is_internal: false,
                    content: message.content.clone(),
                    created_at: message.created_at,
                },
            },
        )
        .await;

    tracing::info!(
        ticket_id = %ticket_id,
        user_id = %user_id,
        "User replied to support ticket"
    );

    Ok(Json(message.into()))
}

/// Close a ticket
pub async fn close_ticket(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
) -> ApiResult<Json<SupportTicket>> {
    let (user_id, org_id) = resolve_user_context(&state.pool, &auth_user).await?;

    // Verify ticket access and close it
    let ticket: Option<TicketRow> = if let Some(org_id) = org_id {
        sqlx::query_as(
            r#"
            UPDATE support_tickets
            SET status = 'closed'::ticket_status, closed_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, ticket_number, organization_id, user_id, subject,
                      category::text, status::text, priority::text, assigned_to,
                      created_at, updated_at, resolved_at, closed_at
            "#,
        )
        .bind(ticket_id)
        .bind(org_id)
        .fetch_optional(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            r#"
            UPDATE support_tickets
            SET status = 'closed'::ticket_status, closed_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND user_id = $2
            RETURNING id, ticket_number, organization_id, user_id, subject,
                      category::text, status::text, priority::text, assigned_to,
                      created_at, updated_at, resolved_at, closed_at
            "#,
        )
        .bind(ticket_id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
    };

    let ticket = ticket.ok_or(ApiError::NotFound)?;

    // Broadcast ticket update to WebSocket subscribers
    state
        .ws_state
        .rooms
        .broadcast(
            &ticket_id,
            ServerEvent::TicketUpdated {
                ticket_id,
                status: Some("closed".to_string()),
                priority: None,
                assigned_to: None,
            },
        )
        .await;

    tracing::info!(
        ticket_id = %ticket_id,
        user_id = %user_id,
        "Support ticket closed by user"
    );

    Ok(Json(ticket.into()))
}

// =============================================================================
// Admin Support Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct AdminListTicketsQuery {
    pub page: Option<i64>,
    pub limit: Option<i64>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub category: Option<String>,
    pub assigned_to: Option<Uuid>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AdminTicketResponse {
    pub id: Uuid,
    pub ticket_number: String,
    pub organization_id: Option<Uuid>,
    pub organization_name: Option<String>,
    pub user_id: Option<Uuid>,
    pub user_email: Option<String>,
    pub contact_name: Option<String>,
    pub contact_email: Option<String>,
    pub contact_company: Option<String>,
    pub subject: String,
    pub category: String,
    pub status: String,
    pub priority: String,
    pub assigned_to: Option<Uuid>,
    pub assigned_to_email: Option<String>,
    pub message_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub resolved_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub closed_at: Option<OffsetDateTime>,

    // Email metadata
    pub source: Option<String>,
    pub original_email_from: Option<String>,
    pub original_email_to: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AdminTicketListResponse {
    pub tickets: Vec<AdminTicketResponse>,
    pub total: i64,
    pub page: i64,
    pub limit: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminTicketStatsResponse {
    pub total_tickets: i64,
    pub open_tickets: i64,
    pub in_progress_tickets: i64,
    pub awaiting_response_tickets: i64,
    pub resolved_today: i64,
    pub urgent_tickets: i64,
    pub unassigned_tickets: i64,
    pub avg_resolution_time_hours: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct AdminUpdateTicketRequest {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assigned_to: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct AdminReplyRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct AdminAssignRequest {
    pub assigned_to: Option<Uuid>,
}

#[derive(Debug, FromRow)]
struct AdminTicketRow {
    id: Uuid,
    ticket_number: String,
    organization_id: Option<Uuid>,
    organization_name: Option<String>,
    user_id: Option<Uuid>,
    user_email: Option<String>,
    contact_name: Option<String>,
    contact_email: Option<String>,
    contact_company: Option<String>,
    subject: String,
    category: String,
    status: String,
    priority: String,
    assigned_to: Option<Uuid>,
    assigned_to_email: Option<String>,
    message_count: i64,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    resolved_at: Option<OffsetDateTime>,
    closed_at: Option<OffsetDateTime>,

    // Email metadata
    source: Option<String>,
    original_email_from: Option<String>,
    original_email_to: Option<String>,
}

impl From<AdminTicketRow> for AdminTicketResponse {
    fn from(row: AdminTicketRow) -> Self {
        AdminTicketResponse {
            id: row.id,
            ticket_number: row.ticket_number,
            organization_id: row.organization_id,
            organization_name: row.organization_name,
            user_id: row.user_id,
            user_email: row.user_email,
            contact_name: row.contact_name,
            contact_email: row.contact_email,
            contact_company: row.contact_company,
            subject: row.subject,
            category: row.category,
            status: row.status,
            priority: row.priority,
            assigned_to: row.assigned_to,
            assigned_to_email: row.assigned_to_email,
            message_count: row.message_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
            resolved_at: row.resolved_at,
            closed_at: row.closed_at,

            // Email metadata
            source: row.source,
            original_email_from: row.original_email_from,
            original_email_to: row.original_email_to,
        }
    }
}

// =============================================================================
// Admin Helper Functions
// =============================================================================

/// Check if the authenticated user has platform admin privileges
async fn require_platform_admin(
    pool: &sqlx::PgPool,
    auth_user: &AuthUser,
    require_write: bool,
) -> ApiResult<Uuid> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    #[derive(FromRow)]
    struct PlatformRoleRow {
        platform_role: String,
    }

    let row: Option<PlatformRoleRow> =
        sqlx::query_as("SELECT platform_role::TEXT as platform_role FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    let platform_role = row
        .map(|r| r.platform_role)
        .unwrap_or_else(|| "user".to_string());

    match platform_role.as_str() {
        "superadmin" | "admin" => Ok(user_id),
        "staff" if !require_write => Ok(user_id), // Staff can read but not write
        _ => {
            tracing::warn!(
                user_id = %user_id,
                platform_role = %platform_role,
                "Unauthorized admin support access attempt"
            );
            Err(ApiError::Forbidden)
        }
    }
}

// =============================================================================
// Admin Support Handlers
// =============================================================================

/// List all tickets (admin)
pub async fn admin_list_tickets(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AdminListTicketsQuery>,
) -> ApiResult<Json<AdminTicketListResponse>> {
    let user_id = require_platform_admin(&state.pool, &auth_user, false).await?;

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(50).min(100);
    let offset = (page - 1) * limit;

    // Fetch user's platform role to determine access level
    #[derive(FromRow)]
    struct PlatformRoleRow {
        platform_role: String,
    }

    let row: Option<PlatformRoleRow> =
        sqlx::query_as("SELECT platform_role::TEXT as platform_role FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?;

    let platform_role = row
        .map(|r| r.platform_role)
        .unwrap_or_else(|| "user".to_string());

    // Fetch assigned emails for non-superadmin users
    // Uses SECURITY DEFINER function for RLS-compliant access (SOC 2 CC6.1)
    let assigned_emails: Vec<String> = if platform_role != "superadmin" {
        sqlx::query_scalar("SELECT email_address FROM get_user_email_assignments($1)")
            .bind(user_id)
            .fetch_all(&state.pool)
            .await?
    } else {
        vec![]
    };

    // Build dynamic query based on filters
    // Force rebuild timestamp: 2025-12-27 Staff email filtering added
    let tickets: Vec<AdminTicketRow> = if platform_role == "superadmin" {
        // Superadmin sees all tickets
        sqlx::query_as(
            r#"
            SELECT
                t.id,
                t.ticket_number,
                t.organization_id,
                o.name as organization_name,
                t.user_id,
                u.email as user_email,
                t.contact_name,
                t.contact_email,
                t.contact_company,
                t.subject,
                t.category::text,
                t.status::text,
                t.priority::text,
                t.assigned_to,
                a.email as assigned_to_email,
                COALESCE((SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id), 0) as message_count,
                t.created_at,
                t.updated_at,
                t.resolved_at,
                t.closed_at,
                t.source,
                t.original_email_from,
                t.original_email_to
            FROM support_tickets t
            LEFT JOIN organizations o ON o.id = t.organization_id
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN users a ON a.id = t.assigned_to
            WHERE 1=1
                AND ($3::text IS NULL OR t.status::text = $3)
                AND ($4::text IS NULL OR t.priority::text = $4)
                AND ($5::text IS NULL OR t.category::text = $5)
                AND ($6::uuid IS NULL OR t.assigned_to = $6)
                AND ($7::text IS NULL OR t.subject ILIKE '%' || $7 || '%' OR t.ticket_number ILIKE '%' || $7 || '%')
            ORDER BY
                CASE t.priority
                    WHEN 'urgent' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3
                    WHEN 'low' THEN 4
                END,
                t.created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .bind(&query.status)
        .bind(&query.priority)
        .bind(&query.category)
        .bind(query.assigned_to)
        .bind(&query.search)
        .fetch_all(&state.pool)
        .await?
    } else if !assigned_emails.is_empty() {
        // Staff sees web tickets + assigned email tickets only
        sqlx::query_as(
            r#"
            SELECT
                t.id,
                t.ticket_number,
                t.organization_id,
                o.name as organization_name,
                t.user_id,
                u.email as user_email,
                t.contact_name,
                t.contact_email,
                t.contact_company,
                t.subject,
                t.category::text,
                t.status::text,
                t.priority::text,
                t.assigned_to,
                a.email as assigned_to_email,
                COALESCE((SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id), 0) as message_count,
                t.created_at,
                t.updated_at,
                t.resolved_at,
                t.closed_at,
                t.source,
                t.original_email_from,
                t.original_email_to
            FROM support_tickets t
            LEFT JOIN organizations o ON o.id = t.organization_id
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN users a ON a.id = t.assigned_to
            WHERE 1=1
                AND (COALESCE(t.source, 'web') != 'email' OR t.original_email_to = ANY($8))
                AND ($3::text IS NULL OR t.status::text = $3)
                AND ($4::text IS NULL OR t.priority::text = $4)
                AND ($5::text IS NULL OR t.category::text = $5)
                AND ($6::uuid IS NULL OR t.assigned_to = $6)
                AND ($7::text IS NULL OR t.subject ILIKE '%' || $7 || '%' OR t.ticket_number ILIKE '%' || $7 || '%')
            ORDER BY
                CASE t.priority
                    WHEN 'urgent' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3
                    WHEN 'low' THEN 4
                END,
                t.created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .bind(&query.status)
        .bind(&query.priority)
        .bind(&query.category)
        .bind(query.assigned_to)
        .bind(&query.search)
        .bind(&assigned_emails)
        .fetch_all(&state.pool)
        .await?
    } else {
        // Staff with no email assignments sees only web tickets
        sqlx::query_as(
            r#"
            SELECT
                t.id,
                t.ticket_number,
                t.organization_id,
                o.name as organization_name,
                t.user_id,
                u.email as user_email,
                t.contact_name,
                t.contact_email,
                t.contact_company,
                t.subject,
                t.category::text,
                t.status::text,
                t.priority::text,
                t.assigned_to,
                a.email as assigned_to_email,
                COALESCE((SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id), 0) as message_count,
                t.created_at,
                t.updated_at,
                t.resolved_at,
                t.closed_at,
                t.source,
                t.original_email_from,
                t.original_email_to
            FROM support_tickets t
            LEFT JOIN organizations o ON o.id = t.organization_id
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN users a ON a.id = t.assigned_to
            WHERE 1=1
                AND COALESCE(t.source, 'web') != 'email'
                AND ($3::text IS NULL OR t.status::text = $3)
                AND ($4::text IS NULL OR t.priority::text = $4)
                AND ($5::text IS NULL OR t.category::text = $5)
                AND ($6::uuid IS NULL OR t.assigned_to = $6)
                AND ($7::text IS NULL OR t.subject ILIKE '%' || $7 || '%' OR t.ticket_number ILIKE '%' || $7 || '%')
            ORDER BY
                CASE t.priority
                    WHEN 'urgent' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3
                    WHEN 'low' THEN 4
                END,
                t.created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .bind(&query.status)
        .bind(&query.priority)
        .bind(&query.category)
        .bind(query.assigned_to)
        .bind(&query.search)
        .fetch_all(&state.pool)
        .await?
    };

    // Get total count with same filtering logic
    let total: (i64,) = if platform_role == "superadmin" {
        sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM support_tickets t
            WHERE 1=1
                AND ($1::text IS NULL OR t.status::text = $1)
                AND ($2::text IS NULL OR t.priority::text = $2)
                AND ($3::text IS NULL OR t.category::text = $3)
                AND ($4::uuid IS NULL OR t.assigned_to = $4)
                AND ($5::text IS NULL OR t.subject ILIKE '%' || $5 || '%' OR t.ticket_number ILIKE '%' || $5 || '%')
            "#,
        )
        .bind(&query.status)
        .bind(&query.priority)
        .bind(&query.category)
        .bind(query.assigned_to)
        .bind(&query.search)
        .fetch_one(&state.pool)
        .await?
    } else if !assigned_emails.is_empty() {
        sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM support_tickets t
            WHERE 1=1
                AND (COALESCE(t.source, 'web') != 'email' OR t.original_email_to = ANY($6))
                AND ($1::text IS NULL OR t.status::text = $1)
                AND ($2::text IS NULL OR t.priority::text = $2)
                AND ($3::text IS NULL OR t.category::text = $3)
                AND ($4::uuid IS NULL OR t.assigned_to = $4)
                AND ($5::text IS NULL OR t.subject ILIKE '%' || $5 || '%' OR t.ticket_number ILIKE '%' || $5 || '%')
            "#,
        )
        .bind(&query.status)
        .bind(&query.priority)
        .bind(&query.category)
        .bind(query.assigned_to)
        .bind(&query.search)
        .bind(&assigned_emails)
        .fetch_one(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM support_tickets t
            WHERE 1=1
                AND COALESCE(t.source, 'web') != 'email'
                AND ($1::text IS NULL OR t.status::text = $1)
                AND ($2::text IS NULL OR t.priority::text = $2)
                AND ($3::text IS NULL OR t.category::text = $3)
                AND ($4::uuid IS NULL OR t.assigned_to = $4)
                AND ($5::text IS NULL OR t.subject ILIKE '%' || $5 || '%' OR t.ticket_number ILIKE '%' || $5 || '%')
            "#,
        )
        .bind(&query.status)
        .bind(&query.priority)
        .bind(&query.category)
        .bind(query.assigned_to)
        .bind(&query.search)
        .fetch_one(&state.pool)
        .await?
    };

    Ok(Json(AdminTicketListResponse {
        tickets: tickets.into_iter().map(Into::into).collect(),
        total: total.0,
        page,
        limit,
    }))
}

/// Get ticket stats (admin)
pub async fn admin_get_ticket_stats(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<AdminTicketStatsResponse>> {
    require_platform_admin(&state.pool, &auth_user, false).await?;

    // Get various stats in one query
    let stats: (i64, i64, i64, i64, i64, i64, i64, Option<f64>) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_tickets,
            COUNT(*) FILTER (WHERE status = 'open') as open_tickets,
            COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_tickets,
            COUNT(*) FILTER (WHERE status = 'awaiting_response') as awaiting_response_tickets,
            COUNT(*) FILTER (WHERE resolved_at >= CURRENT_DATE) as resolved_today,
            COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('resolved', 'closed')) as urgent_tickets,
            COUNT(*) FILTER (WHERE assigned_to IS NULL AND status NOT IN ('resolved', 'closed')) as unassigned_tickets,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL) as avg_resolution_time_hours
        FROM support_tickets
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(AdminTicketStatsResponse {
        total_tickets: stats.0,
        open_tickets: stats.1,
        in_progress_tickets: stats.2,
        awaiting_response_tickets: stats.3,
        resolved_today: stats.4,
        urgent_tickets: stats.5,
        unassigned_tickets: stats.6,
        avg_resolution_time_hours: stats.7,
    }))
}

/// Update a ticket (admin)
pub async fn admin_update_ticket(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
    Json(req): Json<AdminUpdateTicketRequest>,
) -> ApiResult<Json<AdminTicketResponse>> {
    let admin_id = require_platform_admin(&state.pool, &auth_user, true).await?;

    // Validate status if provided
    if let Some(ref status) = req.status {
        let valid_statuses = [
            "open",
            "in_progress",
            "awaiting_response",
            "resolved",
            "closed",
        ];
        if !valid_statuses.contains(&status.as_str()) {
            return Err(ApiError::BadRequest(format!("Invalid status: {}", status)));
        }
    }

    // Validate priority if provided
    if let Some(ref priority) = req.priority {
        let valid_priorities = ["low", "medium", "high", "urgent"];
        if !valid_priorities.contains(&priority.as_str()) {
            return Err(ApiError::BadRequest(format!(
                "Invalid priority: {}",
                priority
            )));
        }
    }

    // Build dynamic update query
    let ticket: AdminTicketRow = sqlx::query_as(
        r#"
        UPDATE support_tickets
        SET
            status = COALESCE($2::ticket_status, status),
            priority = COALESCE($3::ticket_priority, priority),
            assigned_to = COALESCE($4, assigned_to),
            updated_at = NOW(),
            resolved_at = CASE WHEN $2 = 'resolved' AND resolved_at IS NULL THEN NOW() ELSE resolved_at END,
            closed_at = CASE WHEN $2 = 'closed' AND closed_at IS NULL THEN NOW() ELSE closed_at END
        WHERE id = $1
        RETURNING
            id, ticket_number, organization_id,
            (SELECT name FROM organizations WHERE id = organization_id) as organization_name,
            user_id,
            (SELECT email FROM users WHERE id = support_tickets.user_id) as user_email,
            contact_name,
            contact_email,
            contact_company,
            subject, category::text, status::text, priority::text,
            assigned_to,
            (SELECT email FROM users WHERE id = assigned_to) as assigned_to_email,
            (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = support_tickets.id) as message_count,
            created_at, updated_at, resolved_at, closed_at
        "#,
    )
    .bind(ticket_id)
    .bind(&req.status)
    .bind(&req.priority)
    .bind(req.assigned_to)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Broadcast ticket update to WebSocket subscribers
    state
        .ws_state
        .rooms
        .broadcast(
            &ticket_id,
            ServerEvent::TicketUpdated {
                ticket_id,
                status: req.status.clone(),
                priority: req.priority.clone(),
                assigned_to: req.assigned_to,
            },
        )
        .await;

    tracing::info!(
        ticket_id = %ticket_id,
        admin_id = %admin_id,
        status = ?req.status,
        priority = ?req.priority,
        assigned_to = ?req.assigned_to,
        "Admin updated support ticket"
    );

    // SOC 2 CC7.1: Audit log ticket status change
    let audit_details = serde_json::json!({
        "ticket_number": ticket.ticket_number,
        "status_change": req.status.clone(),
        "priority_change": req.priority.clone(),
        "assigned_to_change": req.assigned_to,
    });

    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(admin_id)
    .bind(admin_action::TICKET_STATUS_CHANGED)
    .bind(target_type::TICKET)
    .bind(ticket_id)
    .bind(&audit_details)
    .bind(event_type::DATA_MODIFICATION)
    .bind(severity::INFO)
    .execute(&state.pool)
    .await
    {
        tracing::warn!("Failed to log ticket update audit: {}", e);
    }

    Ok(Json(ticket.into()))
}

/// Reply to a ticket as admin
pub async fn admin_reply_to_ticket(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
    Json(req): Json<AdminReplyRequest>,
) -> ApiResult<Json<TicketMessage>> {
    let admin_id = require_platform_admin(&state.pool, &auth_user, true).await?;

    if req.content.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Message content cannot be empty".into(),
        ));
    }

    // Verify ticket exists
    let ticket_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM support_tickets WHERE id = $1)")
            .bind(ticket_id)
            .fetch_one(&state.pool)
            .await?;

    if !ticket_exists {
        return Err(ApiError::NotFound);
    }

    // Insert the admin reply
    let message: MessageRow = sqlx::query_as(
        r#"
        INSERT INTO ticket_messages (ticket_id, sender_id, is_admin_reply, content)
        VALUES ($1, $2, true, $3)
        RETURNING id, ticket_id, sender_id, is_admin_reply, content, created_at
        "#,
    )
    .bind(ticket_id)
    .bind(admin_id)
    .bind(&req.content)
    .fetch_one(&state.pool)
    .await?;

    // Update ticket status to awaiting_response
    sqlx::query(
        r#"
        UPDATE support_tickets
        SET status = 'awaiting_response'::ticket_status, updated_at = NOW()
        WHERE id = $1 AND status IN ('open'::ticket_status, 'in_progress'::ticket_status)
        "#,
    )
    .bind(ticket_id)
    .execute(&state.pool)
    .await?;

    // Broadcast new message to WebSocket subscribers
    state
        .ws_state
        .rooms
        .broadcast(
            &ticket_id,
            ServerEvent::NewMessage {
                ticket_id,
                message: TicketMessageEvent {
                    id: message.id,
                    ticket_id,
                    sender_id: message.sender_id,
                    sender_name: None, // Client can resolve via sender_id
                    is_admin_reply: message.is_admin_reply,
                    is_internal: false,
                    content: message.content.clone(),
                    created_at: message.created_at,
                },
            },
        )
        .await;

    tracing::info!(
        ticket_id = %ticket_id,
        admin_id = %admin_id,
        "Admin replied to support ticket"
    );

    // SOC 2 CC7.1: Audit log ticket reply
    let audit_details = serde_json::json!({
        "message_id": message.id,
        "content_length": req.content.len(),
    });

    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(admin_id)
    .bind(admin_action::TICKET_REPLY_SENT)
    .bind(target_type::TICKET)
    .bind(ticket_id)
    .bind(&audit_details)
    .bind(event_type::DATA_MODIFICATION)
    .bind(severity::INFO)
    .execute(&state.pool)
    .await
    {
        tracing::warn!("Failed to log ticket reply audit: {}", e);
    }

    Ok(Json(message.into()))
}

/// Assign a ticket to an admin
pub async fn admin_assign_ticket(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
    Json(req): Json<AdminAssignRequest>,
) -> ApiResult<Json<AdminTicketResponse>> {
    let admin_id = require_platform_admin(&state.pool, &auth_user, true).await?;

    // Only validate assignee if assigning (not unassigning)
    if let Some(assignee_id) = req.assigned_to {
        let assignee_role: Option<(String,)> =
            sqlx::query_as("SELECT platform_role::TEXT FROM users WHERE id = $1")
                .bind(assignee_id)
                .fetch_optional(&state.pool)
                .await?;

        if let Some((role,)) = assignee_role {
            if !["admin", "superadmin", "staff"].contains(&role.as_str()) {
                return Err(ApiError::BadRequest(
                    "Assignee must be an admin or staff member".into(),
                ));
            }
        } else {
            return Err(ApiError::BadRequest("Assignee user not found".into()));
        }
    }

    // Determine status based on assignment action
    let new_status = if req.assigned_to.is_some() {
        "in_progress"
    } else {
        "open"
    };

    // Get current assignee for history tracking
    let current_assignee: Option<(Option<Uuid>,)> =
        sqlx::query_as("SELECT assigned_to FROM support_tickets WHERE id = $1")
            .bind(ticket_id)
            .fetch_optional(&state.pool)
            .await?;

    let assigned_from = current_assignee.and_then(|(a,)| a);

    // Update the ticket
    let ticket: AdminTicketRow = sqlx::query_as(
        r#"
        UPDATE support_tickets
        SET assigned_to = $2, status = $3::ticket_status, updated_at = NOW()
        WHERE id = $1
        RETURNING
            id, ticket_number, organization_id,
            (SELECT name FROM organizations WHERE id = organization_id) as organization_name,
            user_id,
            (SELECT email FROM users WHERE id = support_tickets.user_id) as user_email,
            contact_name,
            contact_email,
            contact_company,
            subject, category::text, status::text, priority::text,
            assigned_to,
            (SELECT email FROM users WHERE id = assigned_to) as assigned_to_email,
            (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = support_tickets.id) as message_count,
            created_at, updated_at, resolved_at, closed_at
        "#,
    )
    .bind(ticket_id)
    .bind(req.assigned_to)
    .bind(new_status)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Record assignment history
    sqlx::query(
        r#"
        INSERT INTO ticket_assignment_history (ticket_id, assigned_from, assigned_to, assigned_by)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(ticket_id)
    .bind(assigned_from)
    .bind(req.assigned_to)
    .bind(admin_id)
    .execute(&state.pool)
    .await?;

    // Broadcast ticket update to WebSocket subscribers
    state
        .ws_state
        .rooms
        .broadcast(
            &ticket_id,
            ServerEvent::TicketUpdated {
                ticket_id,
                status: Some(new_status.to_string()),
                priority: None,
                assigned_to: req.assigned_to,
            },
        )
        .await;

    tracing::info!(
        ticket_id = %ticket_id,
        admin_id = %admin_id,
        assigned_to = ?req.assigned_to,
        "Admin assigned/unassigned support ticket"
    );

    // SOC 2 CC7.1: Audit log ticket assignment
    let audit_details = serde_json::json!({
        "ticket_number": ticket.ticket_number,
        "assigned_from": assigned_from,
        "assigned_to": req.assigned_to,
        "new_status": new_status,
    });

    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(admin_id)
    .bind(admin_action::TICKET_ASSIGNED)
    .bind(target_type::TICKET)
    .bind(ticket_id)
    .bind(&audit_details)
    .bind(event_type::DATA_MODIFICATION)
    .bind(severity::INFO)
    .execute(&state.pool)
    .await
    {
        tracing::warn!("Failed to log ticket assignment audit: {}", e);
    }

    Ok(Json(ticket.into()))
}

// =============================================================================
// Enhanced Admin Types (SLA, Workload, Templates)
// =============================================================================

#[derive(Debug, Serialize)]
pub struct AdminTicketStatsEnhanced {
    // Existing stats
    pub total_tickets: i64,
    pub open_tickets: i64,
    pub in_progress_tickets: i64,
    pub awaiting_response_tickets: i64,
    pub resolved_today: i64,
    pub urgent_tickets: i64,
    pub unassigned_tickets: i64,
    pub avg_resolution_time_hours: Option<f64>,
    // New SLA fields
    pub sla_at_risk: i64,
    pub sla_breached: i64,
    pub first_response_met_pct: Option<f64>,
    pub resolution_met_pct: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct StaffWorkload {
    pub user_id: Uuid,
    pub email: String,
    pub name: Option<String>,
    pub assigned_tickets: i64,
    pub open_tickets: i64,
    pub urgent_tickets: i64,
    pub avg_response_time_hours: Option<f64>,
    pub load_status: String,
}

#[derive(Debug, Serialize)]
pub struct StaffWorkloadResponse {
    pub staff: Vec<StaffWorkload>,
    pub total_staff: i64,
}

#[derive(Debug, Serialize)]
pub struct SlaRule {
    pub id: Uuid,
    pub name: String,
    pub priority: String,
    pub category: Option<String>,
    pub first_response_hours: i32,
    pub resolution_hours: i32,
    pub business_hours_only: bool,
    pub is_active: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
pub struct CreateSlaRuleRequest {
    pub name: String,
    pub priority: String,
    pub category: Option<String>,
    pub first_response_hours: i32,
    pub resolution_hours: i32,
    pub business_hours_only: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSlaRuleRequest {
    pub name: Option<String>,
    pub first_response_hours: Option<i32>,
    pub resolution_hours: Option<i32>,
    pub business_hours_only: Option<bool>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct TicketTemplate {
    pub id: Uuid,
    pub name: String,
    pub category: Option<String>,
    pub subject_template: Option<String>,
    pub content: String,
    pub shortcut: Option<String>,
    pub created_by: Option<Uuid>,
    pub usage_count: i32,
    pub is_active: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
pub struct CreateTemplateRequest {
    pub name: String,
    pub category: Option<String>,
    pub subject_template: Option<String>,
    pub content: String,
    pub shortcut: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTemplateRequest {
    pub name: Option<String>,
    pub category: Option<String>,
    pub subject_template: Option<String>,
    pub content: Option<String>,
    pub shortcut: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AssignmentHistoryEntry {
    pub id: Uuid,
    pub ticket_id: Uuid,
    pub assigned_from_email: Option<String>,
    pub assigned_to_email: Option<String>,
    pub assigned_by_email: String,
    pub reason: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct StaffMemberResponse {
    pub id: Uuid,
    pub email: String,
    pub platform_role: String,
}

#[derive(Debug, FromRow)]
struct StaffMemberRow {
    id: Uuid,
    email: String,
    platform_role: String,
}

#[derive(Debug, Deserialize)]
pub struct BatchAssignRequest {
    pub ticket_ids: Vec<Uuid>,
    pub assigned_to: Option<Uuid>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BatchStatusRequest {
    pub ticket_ids: Vec<Uuid>,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct BatchOperationResponse {
    pub success_count: i64,
    pub failed_count: i64,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct AdminReplyWithInternalRequest {
    pub content: String,
    #[serde(default)]
    pub is_internal: bool,
}

// Database row types for new features
#[derive(Debug, FromRow)]
struct SlaRuleRow {
    id: Uuid,
    name: String,
    priority: String,
    category: Option<String>,
    first_response_hours: i32,
    resolution_hours: i32,
    business_hours_only: bool,
    is_active: bool,
    created_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct TemplateRow {
    id: Uuid,
    name: String,
    category: Option<String>,
    subject_template: Option<String>,
    content: String,
    shortcut: Option<String>,
    created_by: Option<Uuid>,
    usage_count: i32,
    is_active: bool,
    created_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct AssignmentHistoryRow {
    id: Uuid,
    ticket_id: Uuid,
    assigned_from_email: Option<String>,
    assigned_to_email: Option<String>,
    assigned_by_email: String,
    reason: Option<String>,
    created_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct WorkloadRow {
    user_id: Uuid,
    email: String,
    name: Option<String>,
    assigned_tickets: i64,
    open_tickets: i64,
    urgent_tickets: i64,
    avg_response_time_hours: Option<f64>,
}

// =============================================================================
// Enhanced Admin Stats with SLA Metrics
// =============================================================================

/// Get enhanced ticket stats including SLA metrics (admin)
pub async fn admin_get_ticket_stats_enhanced(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<AdminTicketStatsEnhanced>> {
    require_platform_admin(&state.pool, &auth_user, false).await?;

    // Get all stats in one query
    #[allow(clippy::type_complexity)]
    let stats: (i64, i64, i64, i64, i64, i64, i64, Option<f64>, i64, i64, Option<f64>, Option<f64>) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_tickets,
            COUNT(*) FILTER (WHERE status = 'open') as open_tickets,
            COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_tickets,
            COUNT(*) FILTER (WHERE status = 'awaiting_response') as awaiting_response_tickets,
            COUNT(*) FILTER (WHERE resolved_at >= CURRENT_DATE) as resolved_today,
            COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('resolved', 'closed')) as urgent_tickets,
            COUNT(*) FILTER (WHERE assigned_to IS NULL AND status NOT IN ('resolved', 'closed')) as unassigned_tickets,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL)::double precision as avg_resolution_time_hours,
            -- SLA metrics
            COUNT(*) FILTER (
                WHERE status NOT IN ('resolved', 'closed')
                AND first_response_at IS NULL
                AND first_response_sla_hours IS NOT NULL
                AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 BETWEEN first_response_sla_hours * 0.75 AND first_response_sla_hours
            ) as sla_at_risk,
            COUNT(*) FILTER (
                WHERE (first_response_breached = true OR resolution_breached = true)
                AND status NOT IN ('resolved', 'closed')
            ) as sla_breached,
            -- First response SLA met percentage
            100.0 * COUNT(*) FILTER (WHERE first_response_at IS NOT NULL AND first_response_breached = false)::float /
                NULLIF(COUNT(*) FILTER (WHERE first_response_at IS NOT NULL)::float, 0) as first_response_met_pct,
            -- Resolution SLA met percentage
            100.0 * COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolution_breached = false)::float /
                NULLIF(COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::float, 0) as resolution_met_pct
        FROM support_tickets
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(AdminTicketStatsEnhanced {
        total_tickets: stats.0,
        open_tickets: stats.1,
        in_progress_tickets: stats.2,
        awaiting_response_tickets: stats.3,
        resolved_today: stats.4,
        urgent_tickets: stats.5,
        unassigned_tickets: stats.6,
        avg_resolution_time_hours: stats.7,
        sla_at_risk: stats.8,
        sla_breached: stats.9,
        first_response_met_pct: stats.10,
        resolution_met_pct: stats.11,
    }))
}

// =============================================================================
// Staff Workload Endpoint
// =============================================================================

/// Get staff workload distribution (admin)
pub async fn admin_get_workload(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<StaffWorkloadResponse>> {
    require_platform_admin(&state.pool, &auth_user, false).await?;

    let workloads: Vec<WorkloadRow> = sqlx::query_as(
        r#"
        SELECT
            u.id as user_id,
            u.email,
            NULL::text as name,
            COUNT(t.id) FILTER (WHERE t.status NOT IN ('resolved', 'closed')) as assigned_tickets,
            COUNT(t.id) FILTER (WHERE t.status = 'open') as open_tickets,
            COUNT(t.id) FILTER (WHERE t.priority = 'urgent' AND t.status NOT IN ('resolved', 'closed')) as urgent_tickets,
            AVG(
                CASE WHEN tm.created_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (tm.created_at - t.created_at)) / 3600
                END
            )::double precision as avg_response_time_hours
        FROM users u
        LEFT JOIN support_tickets t ON t.assigned_to = u.id
        LEFT JOIN LATERAL (
            SELECT MIN(created_at) as created_at
            FROM ticket_messages
            WHERE ticket_id = t.id AND is_admin_reply = true
        ) tm ON true
        WHERE u.platform_role IN ('admin', 'superadmin', 'staff')
        GROUP BY u.id, u.email
        ORDER BY assigned_tickets DESC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let staff: Vec<StaffWorkload> = workloads
        .into_iter()
        .map(|w| {
            let load_status = if w.assigned_tickets > 15 {
                "high".to_string()
            } else if w.assigned_tickets > 8 {
                "normal".to_string()
            } else {
                "low".to_string()
            };

            StaffWorkload {
                user_id: w.user_id,
                email: w.email,
                name: w.name,
                assigned_tickets: w.assigned_tickets,
                open_tickets: w.open_tickets,
                urgent_tickets: w.urgent_tickets,
                avg_response_time_hours: w.avg_response_time_hours,
                load_status,
            }
        })
        .collect();

    let total_staff = staff.len() as i64;

    Ok(Json(StaffWorkloadResponse { staff, total_staff }))
}

/// List all staff members who can be assigned tickets (admin)
pub async fn admin_list_staff(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<Vec<StaffMemberResponse>>> {
    require_platform_admin(&state.pool, &auth_user, false).await?;

    let staff: Vec<StaffMemberRow> = sqlx::query_as(
        r#"
        SELECT id, email, platform_role::TEXT as platform_role
        FROM users
        WHERE platform_role IN ('admin', 'superadmin', 'staff')
        ORDER BY
            CASE platform_role
                WHEN 'superadmin' THEN 1
                WHEN 'admin' THEN 2
                WHEN 'staff' THEN 3
            END,
            email
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        staff
            .into_iter()
            .map(|s| StaffMemberResponse {
                id: s.id,
                email: s.email,
                platform_role: s.platform_role,
            })
            .collect(),
    ))
}

// =============================================================================
// SLA Rules CRUD
// =============================================================================

/// List SLA rules (admin)
pub async fn admin_list_sla_rules(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<Vec<SlaRule>>> {
    require_platform_admin(&state.pool, &auth_user, false).await?;

    let rules: Vec<SlaRuleRow> = sqlx::query_as(
        r#"
        SELECT id, name, priority::text, category::text, first_response_hours,
               resolution_hours, business_hours_only, is_active, created_at
        FROM sla_rules
        ORDER BY
            CASE priority
                WHEN 'urgent' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                WHEN 'low' THEN 4
            END
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        rules
            .into_iter()
            .map(|r| SlaRule {
                id: r.id,
                name: r.name,
                priority: r.priority,
                category: r.category,
                first_response_hours: r.first_response_hours,
                resolution_hours: r.resolution_hours,
                business_hours_only: r.business_hours_only,
                is_active: r.is_active,
                created_at: r.created_at,
            })
            .collect(),
    ))
}

/// Create SLA rule (admin)
pub async fn admin_create_sla_rule(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateSlaRuleRequest>,
) -> ApiResult<Json<SlaRule>> {
    require_platform_admin(&state.pool, &auth_user, true).await?;

    let rule: SlaRuleRow = sqlx::query_as(
        r#"
        INSERT INTO sla_rules (name, priority, category, first_response_hours, resolution_hours, business_hours_only)
        VALUES ($1, $2::ticket_priority, $3::ticket_category, $4, $5, $6)
        RETURNING id, name, priority::text, category::text, first_response_hours,
                  resolution_hours, business_hours_only, is_active, created_at
        "#,
    )
    .bind(&req.name)
    .bind(&req.priority)
    .bind(&req.category)
    .bind(req.first_response_hours)
    .bind(req.resolution_hours)
    .bind(req.business_hours_only.unwrap_or(true))
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(SlaRule {
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        category: rule.category,
        first_response_hours: rule.first_response_hours,
        resolution_hours: rule.resolution_hours,
        business_hours_only: rule.business_hours_only,
        is_active: rule.is_active,
        created_at: rule.created_at,
    }))
}

/// Update SLA rule (admin)
pub async fn admin_update_sla_rule(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(rule_id): Path<Uuid>,
    Json(req): Json<UpdateSlaRuleRequest>,
) -> ApiResult<Json<SlaRule>> {
    require_platform_admin(&state.pool, &auth_user, true).await?;

    let rule: SlaRuleRow = sqlx::query_as(
        r#"
        UPDATE sla_rules SET
            name = COALESCE($2, name),
            first_response_hours = COALESCE($3, first_response_hours),
            resolution_hours = COALESCE($4, resolution_hours),
            business_hours_only = COALESCE($5, business_hours_only),
            is_active = COALESCE($6, is_active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, priority::text, category::text, first_response_hours,
                  resolution_hours, business_hours_only, is_active, created_at
        "#,
    )
    .bind(rule_id)
    .bind(&req.name)
    .bind(req.first_response_hours)
    .bind(req.resolution_hours)
    .bind(req.business_hours_only)
    .bind(req.is_active)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(SlaRule {
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        category: rule.category,
        first_response_hours: rule.first_response_hours,
        resolution_hours: rule.resolution_hours,
        business_hours_only: rule.business_hours_only,
        is_active: rule.is_active,
        created_at: rule.created_at,
    }))
}

// =============================================================================
// Template CRUD
// =============================================================================

/// List templates (admin)
pub async fn admin_list_templates(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<Vec<TicketTemplate>>> {
    require_platform_admin(&state.pool, &auth_user, false).await?;

    let templates: Vec<TemplateRow> = sqlx::query_as(
        r#"
        SELECT id, name, category::text, subject_template, content, shortcut,
               created_by, usage_count, is_active, created_at
        FROM ticket_templates
        WHERE is_active = true
        ORDER BY usage_count DESC, name
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        templates
            .into_iter()
            .map(|t| TicketTemplate {
                id: t.id,
                name: t.name,
                category: t.category,
                subject_template: t.subject_template,
                content: t.content,
                shortcut: t.shortcut,
                created_by: t.created_by,
                usage_count: t.usage_count,
                is_active: t.is_active,
                created_at: t.created_at,
            })
            .collect(),
    ))
}

/// Create template (admin)
pub async fn admin_create_template(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateTemplateRequest>,
) -> ApiResult<Json<TicketTemplate>> {
    let admin_id = require_platform_admin(&state.pool, &auth_user, true).await?;

    let template: TemplateRow = sqlx::query_as(
        r#"
        INSERT INTO ticket_templates (name, category, subject_template, content, shortcut, created_by)
        VALUES ($1, $2::ticket_category, $3, $4, $5, $6)
        RETURNING id, name, category::text, subject_template, content, shortcut,
                  created_by, usage_count, is_active, created_at
        "#,
    )
    .bind(&req.name)
    .bind(&req.category)
    .bind(&req.subject_template)
    .bind(&req.content)
    .bind(&req.shortcut)
    .bind(admin_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(TicketTemplate {
        id: template.id,
        name: template.name,
        category: template.category,
        subject_template: template.subject_template,
        content: template.content,
        shortcut: template.shortcut,
        created_by: template.created_by,
        usage_count: template.usage_count,
        is_active: template.is_active,
        created_at: template.created_at,
    }))
}

/// Update template (admin)
pub async fn admin_update_template(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(template_id): Path<Uuid>,
    Json(req): Json<UpdateTemplateRequest>,
) -> ApiResult<Json<TicketTemplate>> {
    require_platform_admin(&state.pool, &auth_user, true).await?;

    let template: TemplateRow = sqlx::query_as(
        r#"
        UPDATE ticket_templates SET
            name = COALESCE($2, name),
            category = COALESCE($3::ticket_category, category),
            subject_template = COALESCE($4, subject_template),
            content = COALESCE($5, content),
            shortcut = COALESCE($6, shortcut),
            is_active = COALESCE($7, is_active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, category::text, subject_template, content, shortcut,
                  created_by, usage_count, is_active, created_at
        "#,
    )
    .bind(template_id)
    .bind(&req.name)
    .bind(&req.category)
    .bind(&req.subject_template)
    .bind(&req.content)
    .bind(&req.shortcut)
    .bind(req.is_active)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(TicketTemplate {
        id: template.id,
        name: template.name,
        category: template.category,
        subject_template: template.subject_template,
        content: template.content,
        shortcut: template.shortcut,
        created_by: template.created_by,
        usage_count: template.usage_count,
        is_active: template.is_active,
        created_at: template.created_at,
    }))
}

/// Delete template (admin)
pub async fn admin_delete_template(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(template_id): Path<Uuid>,
) -> ApiResult<axum::http::StatusCode> {
    require_platform_admin(&state.pool, &auth_user, true).await?;

    sqlx::query("UPDATE ticket_templates SET is_active = false WHERE id = $1")
        .bind(template_id)
        .execute(&state.pool)
        .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// =============================================================================
// Assignment History
// =============================================================================

/// Get assignment history for a ticket (admin)
pub async fn admin_get_assignment_history(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
) -> ApiResult<Json<Vec<AssignmentHistoryEntry>>> {
    require_platform_admin(&state.pool, &auth_user, false).await?;

    let history: Vec<AssignmentHistoryRow> = sqlx::query_as(
        r#"
        SELECT
            h.id,
            h.ticket_id,
            f.email as assigned_from_email,
            t.email as assigned_to_email,
            b.email as assigned_by_email,
            h.reason,
            h.created_at
        FROM ticket_assignment_history h
        LEFT JOIN users f ON f.id = h.assigned_from
        LEFT JOIN users t ON t.id = h.assigned_to
        JOIN users b ON b.id = h.assigned_by
        WHERE h.ticket_id = $1
        ORDER BY h.created_at DESC
        "#,
    )
    .bind(ticket_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        history
            .into_iter()
            .map(|h| AssignmentHistoryEntry {
                id: h.id,
                ticket_id: h.ticket_id,
                assigned_from_email: h.assigned_from_email,
                assigned_to_email: h.assigned_to_email,
                assigned_by_email: h.assigned_by_email,
                reason: h.reason,
                created_at: h.created_at,
            })
            .collect(),
    ))
}

// =============================================================================
// Batch Operations
// =============================================================================

/// Batch assign tickets (admin)
pub async fn admin_batch_assign(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<BatchAssignRequest>,
) -> ApiResult<Json<BatchOperationResponse>> {
    let admin_id = require_platform_admin(&state.pool, &auth_user, true).await?;

    // Only validate assignee if assigning (not unassigning)
    if let Some(assignee_id) = req.assigned_to {
        let assignee_role: Option<(String,)> =
            sqlx::query_as("SELECT platform_role::TEXT FROM users WHERE id = $1")
                .bind(assignee_id)
                .fetch_optional(&state.pool)
                .await?;

        if let Some((role,)) = assignee_role {
            if !["admin", "superadmin", "staff"].contains(&role.as_str()) {
                return Err(ApiError::BadRequest(
                    "Assignee must be an admin or staff member".into(),
                ));
            }
        } else {
            return Err(ApiError::BadRequest("Assignee user not found".into()));
        }
    }

    // Determine status based on assignment action
    let new_status = if req.assigned_to.is_some() {
        "in_progress"
    } else {
        "open"
    };

    let mut success_count = 0i64;
    let mut errors = Vec::new();

    for ticket_id in &req.ticket_ids {
        // Get current assignee for history
        let current: Option<(Option<Uuid>,)> =
            sqlx::query_as("SELECT assigned_to FROM support_tickets WHERE id = $1")
                .bind(ticket_id)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();

        let assigned_from = current.and_then(|(a,)| a);

        let result = sqlx::query(
            r#"
            UPDATE support_tickets
            SET assigned_to = $2, status = $3::ticket_status, updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(ticket_id)
        .bind(req.assigned_to)
        .bind(new_status)
        .execute(&state.pool)
        .await;

        match result {
            Ok(r) if r.rows_affected() > 0 => {
                // Record assignment history
                let _ = sqlx::query(
                    r#"
                    INSERT INTO ticket_assignment_history (ticket_id, assigned_from, assigned_to, assigned_by, reason)
                    VALUES ($1, $2, $3, $4, $5)
                    "#,
                )
                .bind(ticket_id)
                .bind(assigned_from)
                .bind(req.assigned_to)
                .bind(admin_id)
                .bind(&req.reason)
                .execute(&state.pool)
                .await;
                success_count += 1;
            }
            Ok(_) => errors.push(format!("Ticket {} not found", ticket_id)),
            Err(e) => errors.push(format!("Ticket {}: {}", ticket_id, e)),
        }
    }

    Ok(Json(BatchOperationResponse {
        success_count,
        failed_count: errors.len() as i64,
        errors,
    }))
}

/// Batch update ticket status (admin)
pub async fn admin_batch_status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<BatchStatusRequest>,
) -> ApiResult<Json<BatchOperationResponse>> {
    require_platform_admin(&state.pool, &auth_user, true).await?;

    let valid_statuses = [
        "open",
        "in_progress",
        "awaiting_response",
        "resolved",
        "closed",
    ];
    if !valid_statuses.contains(&req.status.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid status: {}",
            req.status
        )));
    }

    let mut success_count = 0i64;
    let mut errors = Vec::new();

    for ticket_id in &req.ticket_ids {
        let result = sqlx::query(
            r#"
            UPDATE support_tickets
            SET status = $2::ticket_status, updated_at = NOW(),
                resolved_at = CASE WHEN $2 = 'resolved' AND resolved_at IS NULL THEN NOW() ELSE resolved_at END,
                closed_at = CASE WHEN $2 = 'closed' AND closed_at IS NULL THEN NOW() ELSE closed_at END
            WHERE id = $1
            "#,
        )
        .bind(ticket_id)
        .bind(&req.status)
        .execute(&state.pool)
        .await;

        match result {
            Ok(r) if r.rows_affected() > 0 => success_count += 1,
            Ok(_) => errors.push(format!("Ticket {} not found", ticket_id)),
            Err(e) => errors.push(format!("Ticket {}: {}", ticket_id, e)),
        }
    }

    Ok(Json(BatchOperationResponse {
        success_count,
        failed_count: errors.len() as i64,
        errors,
    }))
}

// =============================================================================
// Admin Reply with Internal Notes Support
// =============================================================================

/// Reply to a ticket as admin with internal note option
pub async fn admin_reply_with_internal(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(ticket_id): Path<Uuid>,
    Json(req): Json<AdminReplyWithInternalRequest>,
) -> ApiResult<Json<TicketMessage>> {
    let admin_id = require_platform_admin(&state.pool, &auth_user, true).await?;

    if req.content.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Message content cannot be empty".into(),
        ));
    }

    // Verify ticket exists
    let ticket_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM support_tickets WHERE id = $1)")
            .bind(ticket_id)
            .fetch_one(&state.pool)
            .await?;

    if !ticket_exists {
        return Err(ApiError::NotFound);
    }

    // Insert the message with internal flag
    let message: MessageRow = sqlx::query_as(
        r#"
        INSERT INTO ticket_messages (ticket_id, sender_id, is_admin_reply, content, is_internal)
        VALUES ($1, $2, true, $3, $4)
        RETURNING id, ticket_id, sender_id, is_admin_reply, content, created_at
        "#,
    )
    .bind(ticket_id)
    .bind(admin_id)
    .bind(&req.content)
    .bind(req.is_internal)
    .fetch_one(&state.pool)
    .await?;

    // Only update ticket status for non-internal messages
    if !req.is_internal {
        sqlx::query(
            r#"
            UPDATE support_tickets
            SET status = 'awaiting_response'::ticket_status, updated_at = NOW()
            WHERE id = $1 AND status IN ('open'::ticket_status, 'in_progress'::ticket_status)
            "#,
        )
        .bind(ticket_id)
        .execute(&state.pool)
        .await?;

        // Broadcast new message to WebSocket subscribers (only for non-internal messages)
        state
            .ws_state
            .rooms
            .broadcast(
                &ticket_id,
                ServerEvent::NewMessage {
                    ticket_id,
                    message: TicketMessageEvent {
                        id: message.id,
                        ticket_id,
                        sender_id: message.sender_id,
                        sender_name: None, // Client can resolve via sender_id
                        is_admin_reply: message.is_admin_reply,
                        is_internal: false, // Only non-internal messages are broadcast
                        content: message.content.clone(),
                        created_at: message.created_at,
                    },
                },
            )
            .await;
    }

    // Send email reply for email-sourced tickets (Day 3)
    // Only send if: 1) ticket source is 'email' AND 2) message is not internal
    if !req.is_internal {
        // Check if this is an email-sourced ticket
        let ticket_source: Option<String> =
            sqlx::query_scalar("SELECT source FROM support_tickets WHERE id = $1")
                .bind(ticket_id)
                .fetch_optional(&state.pool)
                .await?;

        if ticket_source.as_deref() == Some("email") {
            // Get admin's email for the From address
            let admin_email: Option<String> =
                sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
                    .bind(admin_id)
                    .fetch_optional(&state.pool)
                    .await?;

            let staff_email = admin_email.unwrap_or_else(|| "support@plexmcp.com".to_string());

            // Send email reply via Resend
            match send_email_reply(
                &state.pool,
                &state.http_client,
                &state.config.resend_api_key,
                ticket_id,
                message.id,
                &req.content,
                &staff_email,
            )
            .await
            {
                Ok(reply_message_id) => {
                    // Fetch parent message ID for threading metadata
                    let parent_message_id: Option<String> = sqlx::query_scalar(
                        r#"
                        SELECT email_message_id
                        FROM ticket_email_metadata
                        WHERE ticket_id = $1
                        ORDER BY created_at DESC
                        LIMIT 1
                        "#,
                    )
                    .bind(ticket_id)
                    .fetch_optional(&state.pool)
                    .await?;

                    // Fetch ticket subject for metadata
                    let subject: String =
                        sqlx::query_scalar("SELECT subject FROM support_tickets WHERE id = $1")
                            .bind(ticket_id)
                            .fetch_one(&state.pool)
                            .await?;

                    // Fetch customer email
                    let customer_email: Option<String> = sqlx::query_scalar(
                        "SELECT original_email_from FROM support_tickets WHERE id = $1",
                    )
                    .bind(ticket_id)
                    .fetch_optional(&state.pool)
                    .await?;

                    let to_email =
                        customer_email.unwrap_or_else(|| "unknown@example.com".to_string());

                    // Store outbound email metadata
                    if let Err(e) = store_outbound_email_metadata(
                        &state.pool,
                        ticket_id,
                        message.id,
                        &reply_message_id,
                        parent_message_id.as_deref(),
                        "pending", // Resend email ID not available yet in current flow
                        &staff_email,
                        &to_email,
                        &format!("Re: {}", subject),
                    )
                    .await
                    {
                        tracing::error!(
                            error = %e,
                            ticket_id = %ticket_id,
                            "Failed to store outbound email metadata, but email was sent"
                        );
                        // Don't fail the request - email was sent successfully
                    }

                    tracing::info!(
                        ticket_id = %ticket_id,
                        message_id = %message.id,
                        reply_message_id = %reply_message_id,
                        "Email reply sent and metadata stored"
                    );
                }
                Err(e) => {
                    tracing::error!(
                        error = %e,
                        ticket_id = %ticket_id,
                        "Failed to send email reply, but ticket message was created"
                    );
                    // Don't fail the request - the message is already in the database
                    // The admin can manually follow up if needed
                }
            }
        }
    }

    tracing::info!(
        ticket_id = %ticket_id,
        admin_id = %admin_id,
        is_internal = %req.is_internal,
        "Admin replied to support ticket"
    );

    // SOC 2 CC7.1: Audit log ticket reply (with internal note flag)
    let audit_details = serde_json::json!({
        "message_id": message.id,
        "content_length": req.content.len(),
        "is_internal": req.is_internal,
    });

    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(admin_id)
    .bind(admin_action::TICKET_REPLY_SENT)
    .bind(target_type::TICKET)
    .bind(ticket_id)
    .bind(&audit_details)
    .bind(event_type::DATA_MODIFICATION)
    .bind(severity::INFO)
    .execute(&state.pool)
    .await
    {
        tracing::warn!("Failed to log ticket reply audit: {}", e);
    }

    Ok(Json(message.into()))
}

// =============================================================================
// Email Reply Functions (Day 3)
// =============================================================================

/// Send an email reply via Resend API for email-sourced tickets
///
/// This function:
/// 1. Fetches ticket metadata (customer email, staff email, subject)
/// 2. Fetches parent Message-ID for email threading
/// 3. Generates new RFC 2822 compliant Message-ID
/// 4. Sends email via Resend API with proper threading headers
/// 5. Returns the new Message-ID for metadata storage
async fn send_email_reply(
    pool: &PgPool,
    http_client: &reqwest::Client,
    resend_api_key: &str,
    ticket_id: Uuid,
    message_id: Uuid,
    content: &str,
    _staff_email: &str,
) -> ApiResult<String> {
    // Fetch ticket metadata for email context
    #[derive(sqlx::FromRow)]
    struct TicketEmailInfo {
        original_email_from: Option<String>,
        original_email_to: Option<String>,
        subject: String,
    }

    let ticket_info: TicketEmailInfo = sqlx::query_as(
        r#"
        SELECT original_email_from, original_email_to, subject
        FROM support_tickets
        WHERE id = $1
        "#,
    )
    .bind(ticket_id)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(ticket_id = %ticket_id, error = %e, "Failed to fetch ticket email info");
        ApiError::Database(e.to_string())
    })?;

    let customer_email = ticket_info
        .original_email_from
        .ok_or_else(|| ApiError::BadRequest("Ticket has no customer email".into()))?;

    let staff_reply_email = ticket_info
        .original_email_to
        .unwrap_or_else(|| "support@plexmcp.com".to_string());

    // Fetch parent Message-ID for threading
    let parent_message_id: Option<String> = sqlx::query_scalar(
        r#"
        SELECT email_message_id
        FROM ticket_email_metadata
        WHERE ticket_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(ticket_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(ticket_id = %ticket_id, error = %e, "Failed to fetch parent message ID");
        ApiError::Database(e.to_string())
    })?;

    // Generate new RFC 2822 compliant Message-ID
    let reply_message_id = format!("<{}.{}@plexmcp.com>", Uuid::new_v4(), ticket_id);

    // Prepare email payload for Resend API
    let mut email_body = serde_json::json!({
        "from": staff_reply_email,
        "to": [customer_email],
        "subject": format!("Re: {}", ticket_info.subject),
        "text": content,
    });

    // Add threading headers if we have a parent message
    if let Some(parent_id) = &parent_message_id {
        email_body["headers"] = serde_json::json!({
            "Message-ID": reply_message_id,
            "In-Reply-To": parent_id,
            "References": parent_id,
        });
    } else {
        email_body["headers"] = serde_json::json!({
            "Message-ID": reply_message_id,
        });
    }

    tracing::info!(
        ticket_id = %ticket_id,
        message_id = %message_id,
        customer_email = %customer_email,
        reply_message_id = %reply_message_id,
        has_parent = parent_message_id.is_some(),
        "Sending email reply via Resend"
    );

    // Send email via Resend API
    let response = http_client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", resend_api_key))
        .header("Content-Type", "application/json")
        .json(&email_body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to send email via Resend");
            ApiError::Internal
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        tracing::error!(
            status = %status,
            error = %error_text,
            "Resend API error"
        );
        return Err(ApiError::BadRequest(format!(
            "Failed to send email: {}",
            error_text
        )));
    }

    let resend_response: serde_json::Value = response.json().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to parse Resend response");
        ApiError::Internal
    })?;

    let resend_email_id = resend_response["id"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    tracing::info!(
        ticket_id = %ticket_id,
        resend_email_id = %resend_email_id,
        "Email sent successfully via Resend"
    );

    Ok(reply_message_id)
}

/// Store outbound email metadata for tracking and threading
#[allow(clippy::too_many_arguments)]
async fn store_outbound_email_metadata(
    pool: &PgPool,
    ticket_id: Uuid,
    message_id: Uuid,
    email_message_id: &str,
    in_reply_to: Option<&str>,
    resend_email_id: &str,
    from_address: &str,
    to_address: &str,
    subject: &str,
) -> ApiResult<()> {
    sqlx::query(
        r#"
        INSERT INTO ticket_email_metadata (
            ticket_id,
            message_id,
            email_message_id,
            in_reply_to,
            resend_email_id,
            direction,
            from_address,
            to_addresses,
            subject,
            has_attachments,
            attachment_count
        )
        VALUES ($1, $2, $3, $4, $5, 'outbound', $6, ARRAY[$7]::TEXT[], $8, FALSE, 0)
        "#,
    )
    .bind(ticket_id)
    .bind(message_id)
    .bind(email_message_id)
    .bind(in_reply_to)
    .bind(resend_email_id)
    .bind(from_address)
    .bind(to_address)
    .bind(subject)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(
            ticket_id = %ticket_id,
            message_id = %message_id,
            error = %e,
            "Failed to store outbound email metadata"
        );
        ApiError::Database(e.to_string())
    })?;

    tracing::debug!(
        ticket_id = %ticket_id,
        message_id = %message_id,
        email_message_id = %email_message_id,
        "Stored outbound email metadata"
    );

    Ok(())
}
