//! MCP instance management API routes

use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    Json,
};
use plexmcp_shared::{CreateMcpRequest, McpInstance, SubscriptionTier};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::ApiError,
    mcp::{
        client::McpClient,
        types::{McpAuth, McpTransport},
    },
    state::AppState,
};

/// MCP instance response
#[derive(Debug, Serialize)]
pub struct McpResponse {
    pub id: Uuid,
    pub name: String,
    pub mcp_type: String,
    pub description: Option<String>,
    pub config: serde_json::Value,
    pub status: String,
    pub is_active: bool, // Computed from status for frontend compatibility
    pub health_status: String,
    pub last_health_check_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    // Server info fields (populated during health checks)
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools_count: Option<i32>,
    pub resources_count: Option<i32>,
    pub last_latency_ms: Option<i32>,
    // Full tool/resource data (populated during health checks)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools_json: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources_json: Option<serde_json::Value>,
    // Timeout configuration
    pub request_timeout_ms: i32,
    pub partial_timeout_ms: Option<i32>,
}

impl From<McpInstance> for McpResponse {
    fn from(mcp: McpInstance) -> Self {
        // Redact sensitive config fields (api_key, etc.)
        let config = redact_sensitive_config(mcp.config);

        let is_active = mcp.status == "active";
        Self {
            id: mcp.id,
            name: mcp.name,
            mcp_type: mcp.mcp_type,
            description: mcp.description,
            config,
            status: mcp.status,
            is_active,
            health_status: mcp.health_status,
            last_health_check_at: mcp.last_health_check_at.map(format_datetime),
            created_at: format_datetime(mcp.created_at),
            updated_at: format_datetime(mcp.updated_at),
            // Server info fields
            protocol_version: mcp.protocol_version,
            server_name: mcp.server_name,
            server_version: mcp.server_version,
            tools_count: mcp.tools_count,
            resources_count: mcp.resources_count,
            last_latency_ms: mcp.last_latency_ms,
            // Full tool/resource data
            tools_json: mcp.tools_json,
            resources_json: mcp.resources_json,
            // Timeout configuration
            request_timeout_ms: mcp.request_timeout_ms,
            partial_timeout_ms: mcp.partial_timeout_ms,
        }
    }
}

/// Redact sensitive fields from config JSON
fn redact_sensitive_config(mut config: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = config.as_object_mut() {
        // List of sensitive keys to redact
        let sensitive_keys = ["api_key", "password", "secret", "token", "auth_token"];

        for key in &sensitive_keys {
            if obj.contains_key(*key) {
                obj.insert((*key).to_string(), serde_json::json!("[REDACTED]"));
            }
        }
    }
    config
}

/// Query params for listing MCPs
#[derive(Debug, Deserialize)]
pub struct ListMcpsQuery {
    pub status: Option<String>,
    pub mcp_type: Option<String>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

/// Update MCP request
#[derive(Debug, Deserialize)]
pub struct UpdateMcpRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub config: Option<serde_json::Value>,
    pub is_active: Option<bool>,
    pub request_timeout_ms: Option<i32>,
    pub partial_timeout_ms: Option<i32>,
}

/// Update MCP status request
#[derive(Debug, Deserialize)]
pub struct UpdateMcpStatusRequest {
    pub status: String,
}

/// Health check response
#[derive(Debug, Serialize)]
pub struct HealthCheckResponse {
    pub mcp_id: Uuid,
    pub health_status: String,
    pub checked_at: String,
    pub details: HealthCheckDetails,
}

/// Detailed health check results
#[derive(Debug, Serialize, Clone)]
pub struct HealthCheckDetails {
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools_count: Option<usize>,
    pub resources_count: Option<usize>,
    pub latency_ms: u64,
    pub error: Option<String>,
    // Full tool/resource data (for storing in database)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools_json: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources_json: Option<serde_json::Value>,
}

/// Test history entry from database
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TestHistoryEntry {
    pub id: Uuid,
    pub mcp_id: Uuid,
    pub health_status: String,
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools_count: Option<i32>,
    pub resources_count: Option<i32>,
    pub latency_ms: i32,
    pub error_message: Option<String>,
    pub tested_at: OffsetDateTime,
    pub tested_by: Option<Uuid>,
}

/// Test history response (formatted for frontend)
#[derive(Debug, Serialize)]
pub struct TestHistoryResponse {
    pub id: String,
    pub mcp_id: String,
    pub health_status: String,
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools_count: Option<i32>,
    pub resources_count: Option<i32>,
    pub latency_ms: i32,
    pub error_message: Option<String>,
    pub tested_at: String,
    pub tested_by: Option<String>,
}

impl From<TestHistoryEntry> for TestHistoryResponse {
    fn from(entry: TestHistoryEntry) -> Self {
        Self {
            id: entry.id.to_string(),
            mcp_id: entry.mcp_id.to_string(),
            health_status: entry.health_status,
            protocol_version: entry.protocol_version,
            server_name: entry.server_name,
            server_version: entry.server_version,
            tools_count: entry.tools_count,
            resources_count: entry.resources_count,
            latency_ms: entry.latency_ms,
            error_message: entry.error_message,
            tested_at: format_datetime(entry.tested_at),
            tested_by: entry.tested_by.map(|id| id.to_string()),
        }
    }
}

/// Config validation check result
#[derive(Debug, Serialize)]
pub struct ValidationCheck {
    pub check: String,
    pub passed: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
}

/// Config validation response
#[derive(Debug, Serialize)]
pub struct ConfigValidationResponse {
    pub mcp_id: String,
    pub validations: Vec<ValidationCheck>,
    pub all_passed: bool,
}

/// Batch test response for a single MCP
#[derive(Debug, Serialize)]
pub struct BatchTestResult {
    pub mcp_id: String,
    pub mcp_name: String,
    pub health_status: String,
    pub tools_count: Option<usize>,
    pub latency_ms: u64,
    pub error: Option<String>,
}

/// Batch test all MCPs response
#[derive(Debug, Serialize)]
pub struct BatchTestResponse {
    pub results: Vec<BatchTestResult>,
    pub total: usize,
    pub healthy: usize,
    pub unhealthy: usize,
    pub tested_at: String,
}

/// List all MCP instances for the organization
pub async fn list_mcps(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<ListMcpsQuery>,
) -> Result<Json<Vec<McpResponse>>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(50).min(100);
    let offset = (page - 1) * per_page;

    let mcps: Vec<McpInstance> = match (&query.status, &query.mcp_type) {
        (Some(status), Some(mcp_type)) => {
            sqlx::query_as(
                r#"
                SELECT id, org_id, name, mcp_type, description, config, status, health_status,
                       last_health_check_at, created_at, updated_at,
                       protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
                       tools_json, resources_json, request_timeout_ms, partial_timeout_ms
                FROM mcp_instances
                WHERE org_id = $1 AND status = $2 AND mcp_type = $3
                ORDER BY created_at DESC
                LIMIT $4 OFFSET $5
                "#
            )
            .bind(org_id)
            .bind(status)
            .bind(mcp_type)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        (Some(status), None) => {
            sqlx::query_as(
                r#"
                SELECT id, org_id, name, mcp_type, description, config, status, health_status,
                       last_health_check_at, created_at, updated_at,
                       protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
                       tools_json, resources_json, request_timeout_ms, partial_timeout_ms
                FROM mcp_instances
                WHERE org_id = $1 AND status = $2
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
                "#
            )
            .bind(org_id)
            .bind(status)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        (None, Some(mcp_type)) => {
            sqlx::query_as(
                r#"
                SELECT id, org_id, name, mcp_type, description, config, status, health_status,
                       last_health_check_at, created_at, updated_at,
                       protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
                       tools_json, resources_json, request_timeout_ms, partial_timeout_ms
                FROM mcp_instances
                WHERE org_id = $1 AND mcp_type = $2
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
                "#
            )
            .bind(org_id)
            .bind(mcp_type)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        (None, None) => {
            sqlx::query_as(
                r#"
                SELECT id, org_id, name, mcp_type, description, config, status, health_status,
                       last_health_check_at, created_at, updated_at,
                       protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
                       tools_json, resources_json, request_timeout_ms, partial_timeout_ms
                FROM mcp_instances
                WHERE org_id = $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
                "#
            )
            .bind(org_id)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
    };

    Ok(Json(mcps.into_iter().map(McpResponse::from).collect()))
}

/// Create a new MCP instance
pub async fn create_mcp(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateMcpRequest>,
) -> Result<(StatusCode, Json<McpResponse>), ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Validate name
    if req.name.trim().is_empty() {
        return Err(ApiError::Validation("MCP name cannot be empty".to_string()));
    }

    if req.mcp_type.trim().is_empty() {
        return Err(ApiError::Validation("MCP type cannot be empty".to_string()));
    }

    // Check tier limits (with custom enterprise overrides)
    let effective_limits = get_org_effective_limits(&state.pool, org_id).await?;
    let current_count = get_mcp_count(&state.pool, org_id).await?;
    let max_mcps = effective_limits.max_mcps;

    if current_count >= max_mcps as i64 {
        return Err(ApiError::QuotaExceeded(format!(
            "Maximum {} MCPs allowed. Contact support to increase your limit.",
            max_mcps
        )));
    }

    let config = req.config.unwrap_or(serde_json::json!({}));
    let id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();

    // Set status based on is_active field (default to active if not specified)
    let status = if req.is_active.unwrap_or(true) {
        "active"
    } else {
        "inactive"
    };

    let mcp: McpInstance = sqlx::query_as(
        r#"
        INSERT INTO mcp_instances (id, org_id, name, mcp_type, description, config, status, health_status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'unknown', $8, $8)
        RETURNING id, org_id, name, mcp_type, description, config, status, health_status,
                  last_health_check_at, created_at, updated_at,
                  protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
                  tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        "#
    )
    .bind(id)
    .bind(org_id)
    .bind(req.name.trim())
    .bind(req.mcp_type.trim())
    .bind(req.description)
    .bind(&config)
    .bind(status)
    .bind(now)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(McpResponse::from(mcp))))
}

/// Get a specific MCP instance
pub async fn get_mcp(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
) -> Result<Json<McpResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let mcp: McpInstance = sqlx::query_as(
        r#"
        SELECT id, org_id, name, mcp_type, description, config, status, health_status,
               last_health_check_at, created_at, updated_at,
               protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
               tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        FROM mcp_instances
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(mcp_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(McpResponse::from(mcp)))
}

/// Update an MCP instance
pub async fn update_mcp(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
    Json(req): Json<UpdateMcpRequest>,
) -> Result<Json<McpResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    // Verify MCP exists and belongs to org
    let existing: McpInstance = sqlx::query_as(
        r#"
        SELECT id, org_id, name, mcp_type, description, config, status, health_status,
               last_health_check_at, created_at, updated_at,
               protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
               tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        FROM mcp_instances
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(mcp_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Validate name if provided
    if let Some(ref name) = req.name {
        if name.trim().is_empty() {
            return Err(ApiError::Validation("MCP name cannot be empty".to_string()));
        }
    }

    // Validate request_timeout_ms if provided
    if let Some(timeout) = req.request_timeout_ms {
        if !(100..=120000).contains(&timeout) {
            return Err(ApiError::Validation(
                "request_timeout_ms must be between 100 and 120000 milliseconds".to_string(),
            ));
        }
    }

    // Validate partial_timeout_ms if provided
    if let Some(timeout) = req.partial_timeout_ms {
        if !(100..=60000).contains(&timeout) {
            return Err(ApiError::Validation(
                "partial_timeout_ms must be between 100 and 60000 milliseconds".to_string(),
            ));
        }
    }

    let name = req.name.as_deref().unwrap_or(&existing.name);
    let description = req.description.as_ref().or(existing.description.as_ref());
    let config = req.config.as_ref().unwrap_or(&existing.config);

    // Convert is_active boolean to status string
    let status = match req.is_active {
        Some(true) => "active",
        Some(false) => "inactive",
        None => &existing.status,
    };

    // Use provided timeout values or keep existing ones
    let request_timeout_ms = req
        .request_timeout_ms
        .unwrap_or(existing.request_timeout_ms);
    let partial_timeout_ms = req.partial_timeout_ms.or(existing.partial_timeout_ms);

    let mcp: McpInstance = sqlx::query_as(
        r#"
        UPDATE mcp_instances
        SET name = $3, description = $4, config = $5, status = $6,
            request_timeout_ms = $7, partial_timeout_ms = $8, updated_at = NOW()
        WHERE id = $1 AND org_id = $2
        RETURNING id, org_id, name, mcp_type, description, config, status, health_status,
                  last_health_check_at, created_at, updated_at,
                  protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
                  tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        "#
    )
    .bind(mcp_id)
    .bind(org_id)
    .bind(name)
    .bind(description)
    .bind(config)
    .bind(status)
    .bind(request_timeout_ms)
    .bind(partial_timeout_ms)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(McpResponse::from(mcp)))
}

/// Delete an MCP instance
pub async fn delete_mcp(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let result = sqlx::query("DELETE FROM mcp_instances WHERE id = $1 AND org_id = $2")
        .bind(mcp_id)
        .bind(org_id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Update MCP status
pub async fn update_mcp_status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
    Json(req): Json<UpdateMcpStatusRequest>,
) -> Result<Json<McpResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    // Validate status
    let valid_statuses = ["active", "inactive", "error", "provisioning"];
    if !valid_statuses.contains(&req.status.as_str()) {
        return Err(ApiError::Validation(format!(
            "Invalid status. Must be one of: {}",
            valid_statuses.join(", ")
        )));
    }

    let mcp: McpInstance = sqlx::query_as(
        r#"
        UPDATE mcp_instances
        SET status = $3, updated_at = NOW()
        WHERE id = $1 AND org_id = $2
        RETURNING id, org_id, name, mcp_type, description, config, status, health_status,
                  last_health_check_at, created_at, updated_at,
                  protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
                  tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        "#
    )
    .bind(mcp_id)
    .bind(org_id)
    .bind(&req.status)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(McpResponse::from(mcp)))
}

/// Trigger a health check for an MCP instance
///
/// Performs a real MCP connection test:
/// 1. Loads the MCP configuration (with credentials)
/// 2. Builds the transport with authentication
/// 3. Calls `initialize` to test the handshake
/// 4. Calls `tools/list` to verify capability
/// 5. Returns detailed results including tool count and latency
pub async fn trigger_health_check(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
) -> Result<Json<HealthCheckResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Load MCP with full config (including credentials)
    let mcp: McpInstance = sqlx::query_as(
        r#"
        SELECT id, org_id, name, mcp_type, description, config, status, health_status,
               last_health_check_at, created_at, updated_at,
               protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
               tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        FROM mcp_instances
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(mcp_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    let now = OffsetDateTime::now_utc();
    let start = Instant::now();

    // Parse transport from config
    let transport = match parse_transport(&mcp.mcp_type, &mcp.config) {
        Some(t) => t,
        None => {
            let details = HealthCheckDetails {
                protocol_version: None,
                server_name: None,
                server_version: None,
                tools_count: None,
                resources_count: None,
                latency_ms: start.elapsed().as_millis() as u64,
                error: Some("Invalid MCP configuration: missing endpoint_url".to_string()),
                tools_json: None,
                resources_json: None,
            };

            // Update health status
            sqlx::query(
                "UPDATE mcp_instances SET health_status = 'unhealthy', last_health_check_at = $3, updated_at = NOW() WHERE id = $1 AND org_id = $2"
            )
            .bind(mcp_id)
            .bind(org_id)
            .bind(now)
            .execute(&state.pool)
            .await?;

            return Ok(Json(HealthCheckResponse {
                mcp_id,
                health_status: "unhealthy".to_string(),
                checked_at: format_datetime(now),
                details,
            }));
        }
    };

    // Create MCP client and test connection
    let client = Arc::new(McpClient::new());
    let mcp_id_str = mcp_id.to_string();

    // Test 1: Initialize handshake
    let init_result = client.initialize(&transport, &mcp_id_str).await;

    let (health_status, details) = match init_result {
        Ok(init_response) => {
            // Test 2: Get tools list
            let tools_result = client.get_tools(&transport, &mcp_id_str).await;
            let latency_ms = start.elapsed().as_millis() as u64;

            match tools_result {
                Ok(tools) => {
                    // Also try to get resources
                    let resources_result = client.get_resources(&transport, &mcp_id_str).await;
                    let (resources_count, resources_json) = match resources_result {
                        Ok(resources) => {
                            (Some(resources.len()), serde_json::to_value(&resources).ok())
                        }
                        Err(_) => (None, None),
                    };

                    // Convert tools to JSON for storage
                    let tools_json = serde_json::to_value(&tools).ok();

                    (
                        "healthy".to_string(),
                        HealthCheckDetails {
                            protocol_version: Some(init_response.protocol_version),
                            server_name: Some(init_response.server_info.name),
                            server_version: Some(init_response.server_info.version),
                            tools_count: Some(tools.len()),
                            resources_count,
                            latency_ms,
                            error: None,
                            tools_json,
                            resources_json,
                        },
                    )
                }
                Err(e) => {
                    // Initialize worked but tools/list failed
                    (
                        "unhealthy".to_string(),
                        HealthCheckDetails {
                            protocol_version: Some(init_response.protocol_version),
                            server_name: Some(init_response.server_info.name),
                            server_version: Some(init_response.server_info.version),
                            tools_count: None,
                            resources_count: None,
                            latency_ms,
                            error: Some(format!("Failed to list tools: {}", e)),
                            tools_json: None,
                            resources_json: None,
                        },
                    )
                }
            }
        }
        Err(e) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            let error_message = format_mcp_error(&e);

            (
                "unhealthy".to_string(),
                HealthCheckDetails {
                    protocol_version: None,
                    server_name: None,
                    server_version: None,
                    tools_count: None,
                    resources_count: None,
                    latency_ms,
                    error: Some(error_message),
                    tools_json: None,
                    resources_json: None,
                },
            )
        }
    };

    // Update health status and server info in database
    sqlx::query(
        r#"
        UPDATE mcp_instances
        SET health_status = $3,
            last_health_check_at = $4,
            protocol_version = $5,
            server_name = $6,
            server_version = $7,
            tools_count = $8,
            resources_count = $9,
            last_latency_ms = $10,
            tools_json = $11,
            resources_json = $12,
            updated_at = NOW()
        WHERE id = $1 AND org_id = $2
        "#,
    )
    .bind(mcp_id)
    .bind(org_id)
    .bind(&health_status)
    .bind(now)
    .bind(&details.protocol_version)
    .bind(&details.server_name)
    .bind(&details.server_version)
    .bind(details.tools_count.map(|c| c as i32))
    .bind(details.resources_count.map(|c| c as i32))
    .bind(details.latency_ms as i32)
    .bind(&details.tools_json)
    .bind(&details.resources_json)
    .execute(&state.pool)
    .await?;

    // Save to test history
    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO mcp_test_history (
            mcp_id, org_id, health_status, protocol_version, server_name, server_version,
            tools_count, resources_count, latency_ms, error_message, tested_at, tested_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#,
    )
    .bind(mcp_id)
    .bind(org_id)
    .bind(&health_status)
    .bind(&details.protocol_version)
    .bind(&details.server_name)
    .bind(&details.server_version)
    .bind(details.tools_count.map(|c| c as i32))
    .bind(details.resources_count.map(|c| c as i32))
    .bind(details.latency_ms as i32)
    .bind(&details.error)
    .bind(now)
    .bind(None::<uuid::Uuid>) // Use NULL for tested_by to avoid FK issues with auth.users vs public.users
    .execute(&state.pool)
    .await
    {
        tracing::error!("Failed to save test history for MCP {}: {}", mcp_id, e);
    }

    Ok(Json(HealthCheckResponse {
        mcp_id,
        health_status,
        checked_at: format_datetime(now),
        details,
    }))
}

/// Parse transport configuration from MCP config
fn parse_transport(mcp_type: &str, config: &serde_json::Value) -> Option<McpTransport> {
    // Support both "endpoint_url" and "url" keys for backwards compatibility
    let endpoint_url = config
        .get("endpoint_url")
        .or_else(|| config.get("url"))
        .and_then(|v| v.as_str())
        .map(String::from)?;
    let auth = parse_auth(config);

    match mcp_type {
        "http" => Some(McpTransport::Http { endpoint_url, auth }),
        "sse" | "websocket" => Some(McpTransport::Sse { endpoint_url, auth }),
        "stdio" => {
            let command = config.get("command")?.as_str()?.to_string();
            let args = config
                .get("args")
                .and_then(|a| a.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let env = config
                .get("env")
                .and_then(|e| e.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            Some(McpTransport::Stdio { command, args, env })
        }
        _ => {
            // Default to HTTP if type is unknown but we have an endpoint
            Some(McpTransport::Http { endpoint_url, auth })
        }
    }
}

/// Parse authentication from config
/// Supports both flat format (auth_type, api_key) and nested format (auth.type, auth.token)
fn parse_auth(config: &serde_json::Value) -> McpAuth {
    // Try nested auth object first (frontend format)
    if let Some(auth_obj) = config.get("auth").and_then(|v| v.as_object()) {
        let auth_type = auth_obj
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("none");

        match auth_type {
            "bearer" => {
                if let Some(token) = auth_obj.get("token").and_then(|v| v.as_str()) {
                    return McpAuth::Bearer {
                        token: token.to_string(),
                    };
                }
            }
            "api-key" | "api_key" => {
                let header = auth_obj
                    .get("header")
                    .and_then(|v| v.as_str())
                    .unwrap_or("X-API-Key")
                    .to_string();
                if let Some(value) = auth_obj
                    .get("token")
                    .or_else(|| auth_obj.get("value"))
                    .and_then(|v| v.as_str())
                {
                    return McpAuth::ApiKey {
                        header,
                        value: value.to_string(),
                    };
                }
            }
            "basic" => {
                let username = auth_obj
                    .get("username")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let password = auth_obj
                    .get("password")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                return McpAuth::Basic { username, password };
            }
            _ => {}
        }
    }

    // Fall back to flat format (legacy format)
    let auth_type = config
        .get("auth_type")
        .and_then(|v| v.as_str())
        .unwrap_or("none");

    match auth_type {
        "bearer" => {
            if let Some(token) = config.get("api_key").and_then(|v| v.as_str()) {
                McpAuth::Bearer {
                    token: token.to_string(),
                }
            } else {
                McpAuth::None
            }
        }
        "api-key" | "api_key" => {
            let header = config
                .get("api_key_header")
                .and_then(|v| v.as_str())
                .unwrap_or("X-API-Key")
                .to_string();
            if let Some(value) = config.get("api_key").and_then(|v| v.as_str()) {
                McpAuth::ApiKey {
                    header,
                    value: value.to_string(),
                }
            } else {
                McpAuth::None
            }
        }
        "basic" => {
            let username = config
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let password = config
                .get("password")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            McpAuth::Basic { username, password }
        }
        _ => McpAuth::None,
    }
}

/// Format MCP client error for user display
fn format_mcp_error(e: &crate::mcp::client::McpClientError) -> String {
    use crate::mcp::client::McpClientError;

    match e {
        McpClientError::HttpError(req_err) => {
            if req_err.is_timeout() {
                "Connection timed out".to_string()
            } else if req_err.is_connect() {
                "Failed to connect to MCP server".to_string()
            } else {
                format!("HTTP error: {}", req_err)
            }
        }
        McpClientError::Timeout => "Request timed out".to_string(),
        McpClientError::McpError(msg) => {
            if msg.contains("401") || msg.to_lowercase().contains("unauthorized") {
                "Authentication failed".to_string()
            } else if msg.contains("403") || msg.to_lowercase().contains("forbidden") {
                "Access denied".to_string()
            } else {
                format!("MCP error: {}", msg)
            }
        }
        McpClientError::InvalidResponse => "Invalid response from MCP server".to_string(),
        McpClientError::JsonError(e) => format!("Invalid JSON response: {}", e),
        _ => format!("{}", e),
    }
}

/// Get MCP configuration (with sensitive fields redacted)
pub async fn get_mcp_config(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let mcp: McpInstance = sqlx::query_as(
        r#"
        SELECT id, org_id, name, mcp_type, description, config, status, health_status,
               last_health_check_at, created_at, updated_at,
               protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
               tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        FROM mcp_instances
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(mcp_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    // Redact sensitive fields before returning
    Ok(Json(redact_sensitive_config(mcp.config)))
}

/// Update MCP configuration
pub async fn update_mcp_config(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
    Json(config): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let result: (serde_json::Value,) = sqlx::query_as(
        r#"
        UPDATE mcp_instances
        SET config = $3, updated_at = NOW()
        WHERE id = $1 AND org_id = $2
        RETURNING config
        "#,
    )
    .bind(mcp_id)
    .bind(org_id)
    .bind(&config)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(result.0))
}

/// Get organization subscription tier
#[allow(dead_code)] // Reserved for tier-based feature gating
async fn get_org_tier(pool: &sqlx::PgPool, org_id: Uuid) -> Result<SubscriptionTier, ApiError> {
    let result: Option<(String,)> =
        sqlx::query_as("SELECT subscription_tier FROM organizations WHERE id = $1")
            .bind(org_id)
            .fetch_optional(pool)
            .await?;

    Ok(result
        .map(|(t,)| t.parse().unwrap_or(SubscriptionTier::Free))
        .unwrap_or(SubscriptionTier::Free))
}

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
) -> Result<plexmcp_shared::types::EffectiveLimits, ApiError> {
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
    let custom = plexmcp_shared::types::CustomLimits {
        max_mcps: data.custom_max_mcps.map(|v| v as u32),
        max_api_keys: data.custom_max_api_keys.map(|v| v as u32),
        max_team_members: data.custom_max_team_members.map(|v| v as u32),
        max_requests_monthly: data.custom_max_requests_monthly.map(|v| v as u64),
        overage_rate_cents: data.custom_overage_rate_cents,
        monthly_price_cents: data.custom_monthly_price_cents,
    };

    Ok(tier.effective_limits(&custom))
}

/// Get current MCP count for organization
async fn get_mcp_count(pool: &sqlx::PgPool, org_id: Uuid) -> Result<i64, ApiError> {
    let result: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM mcp_instances WHERE org_id = $1")
        .bind(org_id)
        .fetch_one(pool)
        .await?;

    Ok(result.0)
}

/// Helper to format datetime as RFC3339
fn format_datetime(dt: OffsetDateTime) -> String {
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| dt.to_string())
}

// =============================================================================
// Test History & Validation Endpoints
// =============================================================================

/// Get test history for an MCP instance
pub async fn get_test_history(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
) -> Result<Json<Vec<TestHistoryResponse>>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Verify MCP belongs to org
    let exists: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM mcp_instances WHERE id = $1 AND org_id = $2")
            .bind(mcp_id)
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await?;

    if exists.is_none() {
        return Err(ApiError::NotFound);
    }

    // Get last 50 test results
    let history: Vec<TestHistoryEntry> = sqlx::query_as(
        r#"
        SELECT id, mcp_id, health_status, protocol_version, server_name, server_version,
               tools_count, resources_count, latency_ms, error_message, tested_at, tested_by
        FROM mcp_test_history
        WHERE mcp_id = $1 AND org_id = $2
        ORDER BY tested_at DESC
        LIMIT 50
        "#,
    )
    .bind(mcp_id)
    .bind(org_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        history.into_iter().map(TestHistoryResponse::from).collect(),
    ))
}

/// Validate MCP configuration without running a full test
pub async fn validate_config(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(mcp_id): Path<Uuid>,
) -> Result<Json<ConfigValidationResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Load MCP config
    let mcp: McpInstance = sqlx::query_as(
        r#"
        SELECT id, org_id, name, mcp_type, description, config, status, health_status,
               last_health_check_at, created_at, updated_at,
               protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
               tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        FROM mcp_instances
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(mcp_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    let mut validations = Vec::new();

    // Check 1: URL format
    let endpoint_url = mcp
        .config
        .get("endpoint_url")
        .or_else(|| mcp.config.get("url"))
        .and_then(|v| v.as_str());

    let url_valid = if let Some(url) = endpoint_url {
        if url.starts_with("http://") || url.starts_with("https://") {
            validations.push(ValidationCheck {
                check: "url_format".to_string(),
                passed: true,
                message: "URL format is valid".to_string(),
                latency_ms: None,
            });
            true
        } else {
            validations.push(ValidationCheck {
                check: "url_format".to_string(),
                passed: false,
                message: "URL must start with http:// or https://".to_string(),
                latency_ms: None,
            });
            false
        }
    } else {
        validations.push(ValidationCheck {
            check: "url_format".to_string(),
            passed: false,
            message: "No endpoint URL configured".to_string(),
            latency_ms: None,
        });
        false
    };

    // Check 2: Auth configuration
    let auth = parse_auth(&mcp.config);
    let auth_message = match &auth {
        McpAuth::Bearer { .. } => "Bearer token configured",
        McpAuth::ApiKey { header, .. } => &format!("API key configured (header: {})", header),
        McpAuth::Basic { .. } => "Basic auth configured",
        McpAuth::None => "No authentication configured",
    };
    validations.push(ValidationCheck {
        check: "auth_configured".to_string(),
        passed: true, // Even "None" is valid for some MCPs
        message: auth_message.to_string(),
        latency_ms: None,
    });

    // Check 3: Endpoint reachability (only if URL is valid)
    if url_valid {
        if let Some(url) = endpoint_url {
            let start = Instant::now();
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_default();

            match client.head(url).send().await {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as u64;
                    if resp.status().is_success() || resp.status().as_u16() == 405 {
                        // 405 Method Not Allowed is OK - means server is reachable
                        validations.push(ValidationCheck {
                            check: "endpoint_reachable".to_string(),
                            passed: true,
                            message: format!("Endpoint responds ({})", resp.status()),
                            latency_ms: Some(latency),
                        });
                    } else if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
                        validations.push(ValidationCheck {
                            check: "endpoint_reachable".to_string(),
                            passed: true,
                            message: "Endpoint reachable (auth required)".to_string(),
                            latency_ms: Some(latency),
                        });
                    } else {
                        validations.push(ValidationCheck {
                            check: "endpoint_reachable".to_string(),
                            passed: false,
                            message: format!("Endpoint returned error: {}", resp.status()),
                            latency_ms: Some(latency),
                        });
                    }
                }
                Err(e) => {
                    let latency = start.elapsed().as_millis() as u64;
                    let msg = if e.is_timeout() {
                        "Connection timed out".to_string()
                    } else if e.is_connect() {
                        "Failed to connect".to_string()
                    } else {
                        format!("Connection error: {}", e)
                    };
                    validations.push(ValidationCheck {
                        check: "endpoint_reachable".to_string(),
                        passed: false,
                        message: msg,
                        latency_ms: Some(latency),
                    });
                }
            }
        }
    }

    let all_passed = validations.iter().all(|v| v.passed);

    Ok(Json(ConfigValidationResponse {
        mcp_id: mcp_id.to_string(),
        validations,
        all_passed,
    }))
}

/// Test all MCPs for an organization
pub async fn test_all_mcps(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<BatchTestResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let now = OffsetDateTime::now_utc();

    // Get all active MCPs for this org
    let mcps: Vec<McpInstance> = sqlx::query_as(
        r#"
        SELECT id, org_id, name, mcp_type, description, config, status, health_status,
               last_health_check_at, created_at, updated_at,
               protocol_version, server_name, server_version, tools_count, resources_count, last_latency_ms,
               tools_json, resources_json, request_timeout_ms, partial_timeout_ms
        FROM mcp_instances
        WHERE org_id = $1 AND status = 'active'
        ORDER BY name
        "#
    )
    .bind(org_id)
    .fetch_all(&state.pool)
    .await?;

    let mut results = Vec::new();
    let client = Arc::new(McpClient::new());

    for mcp in mcps {
        let start = Instant::now();
        let mcp_id_str = mcp.id.to_string();

        let (health_status, tools_count, error) = match parse_transport(&mcp.mcp_type, &mcp.config)
        {
            Some(transport) => match client.initialize(&transport, &mcp_id_str).await {
                Ok(_init) => match client.get_tools(&transport, &mcp_id_str).await {
                    Ok(tools) => ("healthy".to_string(), Some(tools.len()), None),
                    Err(e) => (
                        "unhealthy".to_string(),
                        None,
                        Some(format!("Failed to list tools: {}", e)),
                    ),
                },
                Err(e) => ("unhealthy".to_string(), None, Some(format_mcp_error(&e))),
            },
            None => (
                "unhealthy".to_string(),
                None,
                Some("Invalid configuration".to_string()),
            ),
        };

        let latency_ms = start.elapsed().as_millis() as u64;

        // Update health status and server info in database
        let _ = sqlx::query(
            r#"UPDATE mcp_instances
               SET health_status = $2,
                   last_health_check_at = $3,
                   tools_count = $4,
                   last_latency_ms = $5,
                   updated_at = NOW()
               WHERE id = $1"#,
        )
        .bind(mcp.id)
        .bind(&health_status)
        .bind(now)
        .bind(tools_count.map(|c| c as i32))
        .bind(latency_ms as i32)
        .execute(&state.pool)
        .await;

        // Save to history
        let _ = sqlx::query(
            r#"
            INSERT INTO mcp_test_history (
                mcp_id, org_id, health_status, tools_count, latency_ms, error_message, tested_at, tested_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#
        )
        .bind(mcp.id)
        .bind(org_id)
        .bind(&health_status)
        .bind(tools_count.map(|c| c as i32))
        .bind(latency_ms as i32)
        .bind(&error)
        .bind(now)
        .bind(None::<uuid::Uuid>) // Use NULL for tested_by to avoid FK issues with auth.users vs public.users
        .execute(&state.pool)
        .await;

        results.push(BatchTestResult {
            mcp_id: mcp.id.to_string(),
            mcp_name: mcp.name,
            health_status,
            tools_count,
            latency_ms,
            error,
        });
    }

    let healthy = results
        .iter()
        .filter(|r| r.health_status == "healthy")
        .count();
    let unhealthy = results.len() - healthy;

    Ok(Json(BatchTestResponse {
        results,
        total: healthy + unhealthy,
        healthy,
        unhealthy,
        tested_at: format_datetime(now),
    }))
}
