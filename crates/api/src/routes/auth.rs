//! Authentication routes

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Row};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    audit_constants::{auth_event, event_type, severity},
    auth::{
        generate_impossible_hash, hash_password, sessions, totp, validate_password_strength,
        verify_password, AuthUser, TokenManager, VerificationTokenType,
    },
    error::{ApiError, ApiResult},
    state::AppState,
};

use super::extract_client_ip;
use super::two_factor::{is_device_trusted, trust_device};
use axum::http::HeaderMap;

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub org_name: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    /// Optional device token for "remember this device" feature
    /// If valid, 2FA is skipped for trusted devices
    pub device_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckPasswordStrengthRequest {
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct CheckPasswordStrengthResponse {
    pub score: u8,
    pub level: crate::auth::password::PasswordStrengthLevel,
    pub feedback: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub user: UserResponse,
    /// Device token for "remember this device" feature (only present if requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_token: Option<String>,
}

/// Response when login requires 2FA verification
#[derive(Debug, Serialize)]
pub struct TwoFactorRequiredResponse {
    /// Indicates 2FA is required
    pub requires_2fa: bool,
    /// Temporary token for 2FA verification (expires in 5 minutes)
    pub temp_token: String,
    /// User ID (for frontend reference)
    pub user_id: Uuid,
}

/// Unified login response - either full auth or 2FA required
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum LoginResponse {
    /// Full authentication response (no 2FA or 2FA completed)
    Success(AuthResponse),
    /// 2FA verification required
    TwoFactorRequired(TwoFactorRequiredResponse),
}

/// Request to complete login with 2FA code
#[derive(Debug, Deserialize)]
pub struct Login2FARequest {
    /// Temporary token from initial login
    pub temp_token: String,
    /// 6-digit TOTP code or backup code
    pub code: String,
    /// If true, create a device token to skip 2FA on future logins (30 days)
    #[serde(default)]
    pub remember_device: bool,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub org_id: Uuid,
    pub org_name: String,
    pub is_admin: bool,
    pub platform_role: String,
}

#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub message: String,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
struct UserWithOrgRow {
    id: Uuid,
    org_id: Uuid,
    email: String,
    password_hash: String,
    role: String,
    org_name: String,
    is_admin: bool,
    platform_role: String,
}

#[derive(Debug, FromRow)]
struct UserProfileRow {
    id: Uuid,
    org_id: Uuid,
    email: String,
    role: String,
    org_name: String,
    is_admin: bool,
    platform_role: String,
}

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Reserved for future use
struct UserIdRow {
    id: Uuid,
}

#[derive(Debug, FromRow)]
struct UserEmailRow {
    id: Uuid,
    email: String,
}

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Reserved for future use
struct PasswordHashRow {
    password_hash: String,
}

// =============================================================================
// Audit Logging Helpers
// =============================================================================

/// Log authentication events to the auth_audit_log table for SOC 2 compliance
#[allow(clippy::too_many_arguments)]
pub async fn log_auth_event(
    pool: &sqlx::PgPool,
    user_id: Option<Uuid>,
    event_name: &str,
    email: Option<String>,
    details: Option<serde_json::Value>,
    _event_type_val: &str,
    severity_val: &str,
    ip_address: Option<String>,
    user_agent: Option<String>,
    _success: bool,
    provider: Option<String>,
    auth_method: Option<String>,
) -> ApiResult<()> {
    tracing::info!(
        event_name = %event_name,
        user_id = ?user_id,
        email = ?email,
        ip_address = ?ip_address,
        "log_auth_event: CALLED - Starting audit log write"
    );

    // Sanitize PII from details (passwords, tokens, etc.)
    let sanitized_metadata = if let Some(d) = details {
        Some(sanitize_auth_pii(d))
    } else {
        Some(serde_json::json!({}))
    };

    let email_str = email.unwrap_or_else(|| "unknown@unknown.com".to_string());

    tracing::info!(
        event_name = %event_name,
        email = %email_str,
        ip = ?ip_address,
        severity = %severity_val,
        "log_auth_event: About to execute INSERT query"
    );

    let result = sqlx::query(
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
    .bind(&email_str)
    .bind(sanitized_metadata)
    .bind(severity_val)
    .bind(ip_address)
    .bind(user_agent)
    .bind(provider)
    .bind(auth_method)
    .execute(pool)
    .await;

    match result {
        Ok(query_result) => {
            tracing::info!(
                event_name = %event_name,
                rows_affected = query_result.rows_affected(),
                "log_auth_event: INSERT successful!"
            );
            Ok(())
        }
        Err(e) => {
            tracing::error!(
                error = %e,
                event_name = %event_name,
                email = %email_str,
                "log_auth_event: INSERT FAILED - CRITICAL COMPLIANCE VIOLATION"
            );
            Err(ApiError::Database(format!(
                "Auth audit logging failed: {}",
                e
            )))
        }
    }
}

/// Sanitize PII from authentication audit log details
pub fn sanitize_auth_pii(mut details: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = details.as_object_mut() {
        let sensitive_keys = [
            "password",
            "current_password",
            "new_password",
            "password_hash",
            "token",
            "temp_token",
            "device_token",
            "refresh_token",
            "access_token",
            "totp_code",
            "backup_code",
            "reset_token",
            "verification_code",
            "secret",
            "private_key",
            "bearer_token",
        ];

        for key in &sensitive_keys {
            if obj.contains_key(*key) {
                obj.insert(key.to_string(), serde_json::json!("[REDACTED]"));
            }
        }
    }
    details
}

/// Extract audit context from headers
pub fn extract_auth_audit_context(headers: &HeaderMap) -> (Option<String>, Option<String>) {
    let ip_address = extract_client_ip(headers);
    let user_agent = headers
        .get("user-agent")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    (ip_address, user_agent)
}

// =============================================================================
// Handlers
// =============================================================================

/// Register a new user and organization
pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RegisterRequest>,
) -> ApiResult<(StatusCode, Json<AuthResponse>)> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // SOC 2 CC6.1: Rate limit registration by IP to prevent mass account creation
    if let Some(ip) = &ip_address {
        match state.rate_limiter.check_registration(ip).await {
            Ok(result) if !result.allowed => {
                tracing::warn!(ip = %ip, "register: Rate limit exceeded for IP");
                let retry_after = result.retry_after_seconds.unwrap_or(60);
                return Err(ApiError::TooManyRequests(format!(
                    "Too many registration attempts. Please try again in {} seconds.",
                    retry_after
                )));
            }
            Err(e) => {
                tracing::error!(error = ?e, "register: Rate limit check failed, allowing request");
            }
            _ => {}
        }
    }

    // Check if signup is enabled
    if !state.config.enable_signup {
        return Err(ApiError::BadRequest(
            "Registration is currently disabled".to_string(),
        ));
    }

    // Validate email format
    if !is_valid_email(&req.email) {
        return Err(ApiError::Validation("Invalid email format".to_string()));
    }

    // Validate password strength
    validate_password_strength(&req.password).map_err(|e| ApiError::Validation(e.to_string()))?;

    // Validate org name
    if req.org_name.trim().is_empty() || req.org_name.len() > 100 {
        return Err(ApiError::Validation(
            "Organization name must be between 1 and 100 characters".to_string(),
        ));
    }

    // Check if email already exists
    let exists: Option<(bool,)> =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)")
            .bind(req.email.to_lowercase())
            .fetch_optional(&state.pool)
            .await?;

    if exists.map(|r| r.0).unwrap_or(false) {
        return Err(ApiError::EmailAlreadyExists);
    }

    // Hash password
    let password_hash = hash_password(&req.password).map_err(|_| ApiError::Internal)?;

    // Generate slug from org name
    let slug = generate_slug(&req.org_name);

    // Create organization and user in a transaction
    let mut tx = state.pool.begin().await?;

    // Create organization
    let org_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO organizations (id, name, slug, subscription_tier, settings)
        VALUES ($1, $2, $3, 'free', '{}')
        "#,
    )
    .bind(org_id)
    .bind(req.org_name.trim())
    .bind(&slug)
    .execute(&mut *tx)
    .await?;

    // Create user
    let user_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO users (id, org_id, email, password_hash, role, email_verified)
        VALUES ($1, $2, $3, $4, 'owner', false)
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .bind(req.email.to_lowercase())
    .bind(&password_hash)
    .execute(&mut *tx)
    .await?;

    // Create initial subscription (free tier)
    let subscription_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO subscriptions (id, org_id, status)
        VALUES ($1, $2, 'active')
        "#,
    )
    .bind(subscription_id)
    .bind(org_id)
    .execute(&mut *tx)
    .await?;

    // Add user to organization_members (required for list_orgs to work)
    sqlx::query(
        r#"
        INSERT INTO organization_members (id, org_id, user_id, role, created_at, status)
        VALUES ($1, $2, $3, 'owner', NOW(), 'active')
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(org_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // Generate tokens
    let (access_token, access_jti, refresh_token, refresh_jti) = state
        .jwt_manager
        .generate_token_pair(user_id, org_id, "owner", &req.email)
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

    // Generate verification token and send email (fire and forget)
    let token_manager = TokenManager::new(state.pool.clone());
    let email_service = state.security_email.clone();
    let user_email = req.email.to_lowercase();
    let ip_for_token = ip_address.clone();
    let ua_for_token = user_agent.clone();
    tokio::spawn(async move {
        match token_manager
            .create_token(
                user_id,
                VerificationTokenType::EmailVerification,
                ip_for_token.as_deref(),
                ua_for_token.as_deref(),
            )
            .await
        {
            Ok(verification_token) => {
                email_service
                    .send_email_verification(&user_email, &verification_token)
                    .await;
                tracing::info!(user_id = %user_id, "Verification email sent");
            }
            Err(e) => {
                tracing::error!(
                    user_id = %user_id,
                    error = %e,
                    "Failed to create verification token"
                );
            }
        }
    });

    // Log successful registration (which auto-logs them in)
    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::LOGIN_SUCCESS,
        Some(req.email.to_lowercase()),
        Some(serde_json::json!({"registration": true, "org_id": org_id})),
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address,
        user_agent,
        true,
        Some("email".to_string()),
        Some("password".to_string()),
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            access_token,
            refresh_token,
            token_type: "Bearer".to_string(),
            expires_in: state.jwt_manager.access_token_expiry_seconds(),
            user: UserResponse {
                id: user_id,
                email: req.email.to_lowercase(),
                role: "owner".to_string(),
                org_id,
                org_name: req.org_name.trim().to_string(),
                is_admin: false,
                platform_role: "user".to_string(),
            },
            device_token: None,
        }),
    ))
}

/// Login with email and password
/// Returns either full auth tokens (if no 2FA) or a 2FA challenge (if 2FA enabled)
///
/// SOC 2 CC6.1: Uses constant-time response to prevent timing attacks.
/// All login attempts take a minimum of 500ms to prevent email enumeration
/// by measuring response time differences between existing/non-existing users.
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Json<LoginResponse>> {
    // SOC 2 CC6.1: Start timing for constant-time response
    let start = std::time::Instant::now();
    const MIN_RESPONSE_TIME: std::time::Duration = std::time::Duration::from_millis(500);

    // Inner function to do actual login, allowing timing wrapper
    let result = login_inner(&state, &headers, &req).await;

    // SOC 2 CC6.1: Ensure minimum response time to prevent timing attacks
    let elapsed = start.elapsed();
    if elapsed < MIN_RESPONSE_TIME {
        tokio::time::sleep(MIN_RESPONSE_TIME - elapsed).await;
    }

    result
}

/// Inner login logic (extracted for timing protection wrapper)
async fn login_inner(
    state: &AppState,
    headers: &HeaderMap,
    req: &LoginRequest,
) -> ApiResult<Json<LoginResponse>> {
    tracing::info!(email = %req.email, "login: Starting login attempt");

    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(headers);

    // SOC 2 CC6.1: Rate limit login attempts by IP to prevent brute force attacks
    if let Some(ip) = &ip_address {
        match state.rate_limiter.check_auth_by_ip(ip).await {
            Ok(result) if !result.allowed => {
                tracing::warn!(
                    ip = %ip,
                    retry_after = ?result.retry_after_seconds,
                    "login: Rate limit exceeded for IP"
                );
                let retry_after = result.retry_after_seconds.unwrap_or(60);
                return Err(ApiError::TooManyRequests(format!(
                    "Too many login attempts. Please try again in {} seconds.",
                    retry_after
                )));
            }
            Err(e) => {
                tracing::error!(error = ?e, "login: Rate limit check failed, allowing request");
                // Fail open for rate limiting errors to avoid blocking legitimate users
            }
            _ => {}
        }
    }

    let email_lower = req.email.to_lowercase();

    // Find user by email
    let user: UserWithOrgRow = sqlx::query_as(
        r#"
        SELECT u.id, u.org_id, u.email, u.password_hash, u.role,
               o.name as org_name, u.is_admin, u.platform_role::text as platform_role
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.email = $1
        "#,
    )
    .bind(&email_lower)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        tracing::warn!(email = %req.email, "login: User not found");

        // Log failed login attempt - user not found
        tokio::spawn({
            let pool = state.pool.clone();
            let email = email_lower.clone();
            let ip = ip_address.clone();
            let ua = user_agent.clone();
            async move {
                let _ = log_auth_event(
                    &pool,
                    None,
                    auth_event::LOGIN_FAILED,
                    Some(email),
                    Some(serde_json::json!({"reason": "user_not_found"})),
                    event_type::AUTHENTICATION,
                    severity::WARNING,
                    ip,
                    ua,
                    false,
                    Some("email".to_string()),
                    Some("password".to_string()),
                )
                .await;
            }
        });

        ApiError::InvalidCredentials
    })?;

    tracing::info!(
        user_id = %user.id,
        org_id = %user.org_id,
        role = %user.role,
        hash_prefix = %&user.password_hash[..50.min(user.password_hash.len())],
        "login: User found, verifying password"
    );

    // Verify password
    let valid = verify_password(&req.password, &user.password_hash).map_err(|e| {
        tracing::error!(error = ?e, "login: Password verification failed with error");
        ApiError::Internal
    })?;

    if !valid {
        tracing::warn!(user_id = %user.id, "login: Invalid password");

        // Log failed login attempt - invalid password
        log_auth_event(
            &state.pool,
            Some(user.id),
            auth_event::LOGIN_FAILED,
            Some(user.email.clone()),
            Some(serde_json::json!({"reason": "invalid_password"})),
            event_type::AUTHENTICATION,
            severity::WARNING,
            ip_address,
            user_agent,
            false,
            Some("email".to_string()),
            Some("password".to_string()),
        )
        .await?;

        return Err(ApiError::InvalidCredentials);
    }

    tracing::info!(user_id = %user.id, "login: Password verified successfully");

    // Check if user has 2FA enabled
    let has_2fa: Option<(bool,)> =
        sqlx::query_as("SELECT is_enabled FROM user_2fa WHERE user_id = $1")
            .bind(user.id)
            .fetch_optional(&state.pool)
            .await?;

    let two_fa_enabled = has_2fa.map(|r| r.0).unwrap_or(false);

    // Check if device is trusted (skip 2FA if so)
    let device_trusted = if two_fa_enabled {
        if let Some(ref device_token) = req.device_token {
            is_device_trusted(&state.pool, user.id, device_token)
                .await
                .unwrap_or(false)
        } else {
            false
        }
    } else {
        false
    };

    if two_fa_enabled && !device_trusted {
        // Generate temporary login token for 2FA verification
        let temp_token = totp::generate_token();
        let token_hash = totp::hash_token(&temp_token);
        let expires_at =
            OffsetDateTime::now_utc() + time::Duration::minutes(totp::LOGIN_TOKEN_EXPIRY_MINUTES);

        // Store the temp token (upsert to handle concurrent logins)
        sqlx::query(
            r#"
            INSERT INTO user_2fa_login_tokens (user_id, token_hash, expires_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE SET
                token_hash = EXCLUDED.token_hash,
                expires_at = EXCLUDED.expires_at,
                created_at = NOW()
            "#,
        )
        .bind(user.id)
        .bind(&token_hash)
        .bind(expires_at)
        .execute(&state.pool)
        .await?;

        return Ok(Json(LoginResponse::TwoFactorRequired(
            TwoFactorRequiredResponse {
                requires_2fa: true,
                temp_token,
                user_id: user.id,
            },
        )));
    }

    // No 2FA - proceed with normal login
    tracing::info!(user_id = %user.id, "login: No 2FA required, generating tokens");

    // Update last login
    sqlx::query("UPDATE users SET last_login_at = NOW() WHERE id = $1")
        .bind(user.id)
        .execute(&state.pool)
        .await?;

    tracing::info!(user_id = %user.id, "login: Updated last_login_at");

    // Generate tokens
    let (access_token, access_jti, refresh_token, refresh_jti) = state
        .jwt_manager
        .generate_token_pair(user.id, user.org_id, &user.role, &user.email)
        .map_err(|e| {
            tracing::error!(error = ?e, "login: JWT generation failed");
            ApiError::Internal
        })?;

    // Save session for revocation support
    let access_expires_at =
        OffsetDateTime::now_utc() + Duration::hours(state.config.jwt_expiry_hours);
    let refresh_expires_at = OffsetDateTime::now_utc() + Duration::days(30);
    sessions::save_session(
        &state.pool,
        user.id,
        &access_jti,
        access_expires_at,
        &refresh_jti,
        refresh_expires_at,
        ip_address.as_deref(),
        user_agent.as_deref(),
    )
    .await?;

    tracing::info!(user_id = %user.id, "login: Login successful");

    // Log successful login
    log_auth_event(
        &state.pool,
        Some(user.id),
        auth_event::LOGIN_SUCCESS,
        Some(user.email.clone()),
        Some(serde_json::json!({"two_fa_required": false})),
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address,
        user_agent,
        true,
        Some("email".to_string()),
        Some("password".to_string()),
    )
    .await?;

    Ok(Json(LoginResponse::Success(AuthResponse {
        access_token,
        refresh_token,
        token_type: "Bearer".to_string(),
        expires_in: state.jwt_manager.access_token_expiry_seconds(),
        user: UserResponse {
            id: user.id,
            email: user.email,
            role: user.role,
            org_id: user.org_id,
            org_name: user.org_name,
            is_admin: user.is_admin,
            platform_role: user.platform_role,
        },
        device_token: None,
    })))
}

/// Complete login with 2FA code
/// Called after initial login returns 2FA required
pub async fn login_2fa(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<Login2FARequest>,
) -> ApiResult<Json<AuthResponse>> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    let token_hash = totp::hash_token(&req.temp_token);

    // SOC 2 CC6.1: Rate limit 2FA attempts to prevent bypass attacks
    // Use token hash as identifier to rate limit per-token attempts
    match state.rate_limiter.check_2fa_attempts(&token_hash).await {
        Ok(result) if !result.allowed => {
            tracing::warn!(
                token_hash_prefix = %&token_hash[..20],
                "login_2fa: Rate limit exceeded for token"
            );
            let retry_after = result.retry_after_seconds.unwrap_or(60);
            return Err(ApiError::TooManyRequests(format!(
                "Too many 2FA attempts. Please try again in {} seconds.",
                retry_after
            )));
        }
        Err(e) => {
            tracing::error!(error = ?e, "login_2fa: Rate limit check failed, allowing request");
        }
        _ => {}
    }

    // DEBUG: Log the incoming request
    tracing::info!(
        temp_token_prefix = %&req.temp_token[..std::cmp::min(20, req.temp_token.len())],
        token_hash_prefix = %&token_hash[..20],
        "login_2fa: Looking up token in database"
    );

    // Find and validate the temp login token
    #[derive(Debug, FromRow)]
    struct LoginTokenRow {
        user_id: Uuid,
        expires_at: OffsetDateTime,
        email: Option<String>,
    }

    // DEBUG: First count all rows in the table to see if there's ANY data
    let row_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM user_2fa_login_tokens")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    tracing::info!(
        total_rows = row_count.0,
        "login_2fa: Total rows in user_2fa_login_tokens table"
    );

    let token_row: LoginTokenRow = sqlx::query_as(
        r#"
        SELECT user_id, expires_at, email
        FROM user_2fa_login_tokens
        WHERE token_hash = $1
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        tracing::error!(
            token_hash_prefix = %&token_hash[..20],
            "login_2fa: Token NOT FOUND in database"
        );
        ApiError::InvalidToken
    })?;

    // Check if token expired
    if token_row.expires_at < OffsetDateTime::now_utc() {
        // Clean up expired token
        sqlx::query("DELETE FROM user_2fa_login_tokens WHERE token_hash = $1")
            .bind(&token_hash)
            .execute(&state.pool)
            .await?;
        return Err(ApiError::InvalidToken);
    }

    let user_id = token_row.user_id;

    // Get user's 2FA settings
    #[derive(Debug, FromRow)]
    struct TwoFactorRow {
        totp_secret_encrypted: String,
        totp_secret_nonce: String,
        failed_attempts: i32,
        locked_until: Option<OffsetDateTime>,
    }

    let tfa: TwoFactorRow = sqlx::query_as(
        r#"
        SELECT totp_secret_encrypted, totp_secret_nonce, failed_attempts, locked_until
        FROM user_2fa
        WHERE user_id = $1 AND is_enabled = TRUE
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::BadRequest(
        "2FA not enabled for this user".to_string(),
    ))?;

    // Check if locked out
    if let Some(locked_until) = tfa.locked_until {
        if locked_until > OffsetDateTime::now_utc() {
            let remaining = (locked_until - OffsetDateTime::now_utc()).whole_minutes();
            return Err(ApiError::TooManyRequests(format!(
                "Too many failed attempts. Try again in {} minutes.",
                remaining + 1
            )));
        }
    }

    // Decrypt TOTP secret
    let encryption_key = totp::parse_encryption_key(&state.config.totp_encryption_key)
        .map_err(|_| ApiError::Internal)?;

    let secret = totp::decrypt_secret(
        &tfa.totp_secret_encrypted,
        &tfa.totp_secret_nonce,
        &encryption_key,
    )
    .map_err(|_| ApiError::Internal)?;

    // Get user email for TOTP verification
    // Priority: 1) Token email (OAuth), 2) users table, 3) auth.users (Supabase OAuth)
    tracing::info!(
        token_email = ?token_row.email,
        user_id = %user_id,
        "login_2fa: Resolving user email"
    );

    let user_email = if let Some(email) = token_row.email.clone() {
        tracing::info!(email = %email, "Using email from token");
        email
    } else {
        // Try users table first (for email/password users)
        let row: Option<(String,)> = sqlx::query_as("SELECT email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?;

        if let Some((email,)) = row {
            tracing::info!(email = %email, "Using email from users table");
            email
        } else {
            // Fallback to Supabase auth.users table (for OAuth users)
            tracing::info!("Trying auth.users fallback for OAuth user");
            let auth_row: Option<(String,)> =
                sqlx::query_as("SELECT email FROM auth.users WHERE id = $1")
                    .bind(user_id)
                    .fetch_optional(&state.pool)
                    .await?;

            auth_row.map(|r| r.0).ok_or_else(|| {
                tracing::error!(user_id = %user_id, "User email not found in any table");
                ApiError::BadRequest("User email not found".to_string())
            })?
        }
    };

    // Try TOTP code first
    tracing::info!(
        user_id = %user_id,
        code_length = req.code.len(),
        secret_length = secret.len(),
        "login_2fa: Attempting TOTP verification"
    );

    let code_valid = totp::verify_code(&secret, &req.code, &user_email).map_err(|e| {
        tracing::error!(error = ?e, "login_2fa: TOTP verification error");
        ApiError::Internal
    })?;

    tracing::info!(
        code_valid = code_valid,
        "login_2fa: TOTP verification result"
    );

    let verified = if code_valid {
        true
    } else {
        // Try backup codes
        #[derive(Debug, FromRow)]
        struct BackupCodeRow {
            id: Uuid,
            code_hash: String,
        }

        let backup_codes: Vec<BackupCodeRow> = sqlx::query_as(
            "SELECT id, code_hash FROM user_2fa_backup_codes WHERE user_id = $1 AND used_at IS NULL"
        )
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;

        let mut matched_code_id: Option<Uuid> = None;
        for bc in &backup_codes {
            if totp::verify_backup_code(&req.code, &bc.code_hash).unwrap_or(false) {
                matched_code_id = Some(bc.id);
                break;
            }
        }

        if let Some(code_id) = matched_code_id {
            // Mark backup code as used
            sqlx::query("UPDATE user_2fa_backup_codes SET used_at = NOW() WHERE id = $1")
                .bind(code_id)
                .execute(&state.pool)
                .await?;

            // Count remaining backup codes
            let remaining: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM user_2fa_backup_codes WHERE user_id = $1 AND used_at IS NULL",
            )
            .bind(user_id)
            .fetch_one(&state.pool)
            .await?;

            tracing::info!(
                user_id = %user_id,
                remaining_codes = remaining.0,
                "Backup code used for 2FA login"
            );

            // Send email notification about backup code usage (fire and forget)
            let email_service = state.security_email.clone();
            let email_to = user_email.clone();
            let codes_remaining = remaining.0;
            tokio::spawn(async move {
                email_service
                    .send_backup_code_used(&email_to, codes_remaining)
                    .await;
            });

            true
        } else {
            false
        }
    };

    if !verified {
        // Log failed 2FA attempt
        let _ = log_auth_event(
            &state.pool,
            Some(user_id),
            auth_event::TWO_FA_FAILED,
            Some(user_email.clone()),
            Some(serde_json::json!({"attempts": tfa.failed_attempts + 1})),
            event_type::AUTHENTICATION,
            severity::WARNING,
            ip_address.clone(),
            user_agent.clone(),
            false,
            None,
            Some("2fa".to_string()),
        )
        .await;

        // Increment failed attempts
        let new_attempts = tfa.failed_attempts + 1;

        if new_attempts >= totp::MAX_2FA_ATTEMPTS {
            // Lock the account
            let lock_until =
                OffsetDateTime::now_utc() + time::Duration::minutes(totp::LOCKOUT_DURATION_MINUTES);

            // Try to lock the account, but don't fail if DB update fails
            if let Err(e) = sqlx::query(
                "UPDATE user_2fa SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3",
            )
            .bind(new_attempts)
            .bind(lock_until)
            .bind(user_id)
            .execute(&state.pool)
            .await
            {
                tracing::error!(user_id = %user_id, error = ?e, "Failed to update lockout status");
            }

            return Err(ApiError::TooManyRequests(format!(
                "Too many failed attempts. Account locked for {} minutes.",
                totp::LOCKOUT_DURATION_MINUTES
            )));
        } else {
            // Try to increment failed attempts, but don't fail if DB update fails
            if let Err(e) =
                sqlx::query("UPDATE user_2fa SET failed_attempts = $1 WHERE user_id = $2")
                    .bind(new_attempts)
                    .bind(user_id)
                    .execute(&state.pool)
                    .await
            {
                tracing::error!(user_id = %user_id, error = ?e, "Failed to update failed attempts count");
            }
        }

        return Err(ApiError::Invalid2FACode);
    }

    // Success! Reset failed attempts and update last used
    sqlx::query(
        "UPDATE user_2fa SET failed_attempts = 0, locked_until = NULL, last_used_at = NOW() WHERE user_id = $1"
    )
    .bind(user_id)
    .execute(&state.pool)
    .await?;

    // Delete the temp login token
    sqlx::query("DELETE FROM user_2fa_login_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await?;

    // Fetch user profile for token generation
    // First try the users table (normal users)
    let user: UserProfileRow = match sqlx::query_as::<_, UserProfileRow>(
        r#"
        SELECT u.id, u.org_id, u.email, u.role, o.name as org_name,
               u.is_admin, u.platform_role::text as platform_role
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    {
        Some(u) => {
            tracing::info!(user_id = %user_id, "Found user in users table");
            u
        }
        None => {
            // OAuth user not in users table - create a profile for them
            tracing::info!(user_id = %user_id, "User not in users table, checking auth.users for OAuth user");

            // Get email from auth.users
            let auth_user: Option<(String,)> =
                sqlx::query_as("SELECT email FROM auth.users WHERE id = $1")
                    .bind(user_id)
                    .fetch_optional(&state.pool)
                    .await?;

            let email = auth_user.map(|r| r.0).ok_or_else(|| {
                tracing::error!(user_id = %user_id, "OAuth user not found in auth.users");
                ApiError::BadRequest("User not found".to_string())
            })?;

            tracing::info!(user_id = %user_id, email = %email, "Found OAuth user, checking for existing user record by email");

            // First check if a user with this email already exists (may have different id from previous signup)
            let existing_user_by_email: Option<(Uuid, Uuid, String, String, bool, String)> =
                sqlx::query_as(
                    r#"
                SELECT u.id, u.org_id, u.role, o.name as org_name, u.is_admin, u.platform_role::text
                FROM users u
                JOIN organizations o ON u.org_id = o.id
                WHERE u.email = $1
                "#,
                )
                .bind(&email)
                .fetch_optional(&state.pool)
                .await?;

            if let Some((existing_id, existing_org_id, role, org_name, is_admin, platform_role)) =
                existing_user_by_email
            {
                tracing::info!(
                    user_id = %user_id,
                    existing_user_id = %existing_id,
                    org_id = %existing_org_id,
                    "Found existing user record by email, using that record"
                );

                // Use the existing user record (even if auth.users id is different)
                UserProfileRow {
                    id: existing_id,
                    org_id: existing_org_id,
                    email,
                    role,
                    org_name,
                    is_admin,
                    platform_role,
                }
            } else {
                tracing::info!(user_id = %user_id, email = %email, "No existing user found, creating organization and user record");

                // Create a personal organization for the OAuth user (or get existing one)
                let org_name = format!(
                    "{}'s Organization",
                    email.split('@').next().unwrap_or("User")
                );
                // Generate a unique slug from the user_id (first 8 chars of UUID)
                let slug = format!("oauth-{}", &user_id.to_string()[..8]);

                // Use ON CONFLICT to handle re-login after partial creation
                let org_id: (Uuid,) = sqlx::query_as(
                    r#"
                    INSERT INTO organizations (name, slug)
                    VALUES ($1, $2)
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    "#,
                )
                .bind(&org_name)
                .bind(&slug)
                .fetch_one(&state.pool)
                .await?;

                tracing::info!(user_id = %user_id, org_id = %org_id.0, "Created/found organization for OAuth user");

                // SOC 2 CC6.1: Generate cryptographically random hash for OAuth users
                // (they authenticate via Supabase OAuth, not our password system)
                let impossible_hash = generate_impossible_hash().map_err(|_| ApiError::Internal)?;

                // Create the user record
                sqlx::query(
                    r#"
                    INSERT INTO users (id, org_id, email, password_hash, role)
                    VALUES ($1, $2, $3, $4, 'admin')
                    "#,
                )
                .bind(user_id)
                .bind(org_id.0)
                .bind(&email)
                .bind(&impossible_hash)
                .execute(&state.pool)
                .await?;

                tracing::info!(user_id = %user_id, "Created user record for OAuth user");

                UserProfileRow {
                    id: user_id,
                    org_id: org_id.0,
                    email,
                    role: "admin".to_string(),
                    org_name,
                    is_admin: false,
                    platform_role: "user".to_string(),
                }
            }
        }
    };

    // Update last login
    sqlx::query("UPDATE users SET last_login_at = NOW() WHERE id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await?;

    // Generate tokens
    let (access_token, access_jti, refresh_token, refresh_jti) = state
        .jwt_manager
        .generate_token_pair(user.id, user.org_id, &user.role, &user.email)
        .map_err(|_| ApiError::Internal)?;

    // Save session for revocation support
    let access_expires_at =
        OffsetDateTime::now_utc() + Duration::hours(state.config.jwt_expiry_hours);
    let refresh_expires_at = OffsetDateTime::now_utc() + Duration::days(30);
    sessions::save_session(
        &state.pool,
        user.id,
        &access_jti,
        access_expires_at,
        &refresh_jti,
        refresh_expires_at,
        ip_address.as_deref(),
        user_agent.as_deref(),
    )
    .await?;

    // Log successful 2FA verification
    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::TWO_FA_VERIFIED,
        Some(user.email.clone()),
        Some(serde_json::json!({"remember_device": req.remember_device})),
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address,
        user_agent,
        true,
        None,
        Some("2fa".to_string()),
    )
    .await?;

    // Create device trust token if requested
    let device_token = if req.remember_device {
        let user_agent = headers.get("user-agent").and_then(|h| h.to_str().ok());
        let client_ip = extract_client_ip(&headers);

        match trust_device(&state.pool, user_id, user_agent, client_ip.as_deref()).await {
            Ok(token) => Some(token),
            Err(e) => {
                // Log error but don't fail the login
                tracing::error!(error = %e, "Failed to create device trust token");
                None
            }
        }
    } else {
        None
    };

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        token_type: "Bearer".to_string(),
        expires_in: state.jwt_manager.access_token_expiry_seconds(),
        user: UserResponse {
            id: user.id,
            email: user.email,
            role: user.role,
            org_id: user.org_id,
            org_name: user.org_name,
            is_admin: user.is_admin,
            platform_role: user.platform_role,
        },
        device_token,
    }))
}

/// Refresh access token
pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RefreshRequest>,
) -> ApiResult<Json<AuthResponse>> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // Validate refresh token
    let claims = state
        .jwt_manager
        .validate_refresh_token(&req.refresh_token)
        .map_err(|_| ApiError::InvalidToken)?;

    // Fetch current user data
    let user: UserProfileRow = sqlx::query_as(
        r#"
        SELECT u.id, u.org_id, u.email, u.role, o.name as org_name,
               u.is_admin, u.platform_role::text as platform_role
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.id = $1
        "#,
    )
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::InvalidToken)?;

    // Generate new tokens
    let (access_token, access_jti, refresh_token, refresh_jti) = state
        .jwt_manager
        .generate_token_pair(user.id, user.org_id, &user.role, &user.email)
        .map_err(|_| ApiError::Internal)?;

    // Save session for revocation support
    let access_expires_at =
        OffsetDateTime::now_utc() + Duration::hours(state.config.jwt_expiry_hours);
    let refresh_expires_at = OffsetDateTime::now_utc() + Duration::days(30);
    sessions::save_session(
        &state.pool,
        user.id,
        &access_jti,
        access_expires_at,
        &refresh_jti,
        refresh_expires_at,
        ip_address.as_deref(),
        user_agent.as_deref(),
    )
    .await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        token_type: "Bearer".to_string(),
        expires_in: state.jwt_manager.access_token_expiry_seconds(),
        user: UserResponse {
            id: user.id,
            email: user.email,
            role: user.role,
            org_id: user.org_id,
            org_name: user.org_name,
            is_admin: user.is_admin,
            platform_role: user.platform_role,
        },
        device_token: None,
    }))
}

/// Request password reset
/// SOC 2 CC6.1: Constant-time response prevents timing-based email enumeration
pub async fn forgot_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ForgotPasswordRequest>,
) -> ApiResult<Json<MessageResponse>> {
    // Start timing for constant-time response
    let start = std::time::Instant::now();

    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // SOC 2 CC6.1: Rate limit password reset requests to prevent abuse
    if let Some(ip) = &ip_address {
        match state.rate_limiter.check_password_reset(ip).await {
            Ok(result) if !result.allowed => {
                tracing::warn!(ip = %ip, "forgot_password: Rate limit exceeded for IP");
                // Still use constant-time response even for rate limiting
                let elapsed = start.elapsed();
                let min_response_time = std::time::Duration::from_millis(500);
                if elapsed < min_response_time {
                    tokio::time::sleep(min_response_time - elapsed).await;
                }
                let retry_after = result.retry_after_seconds.unwrap_or(60);
                return Err(ApiError::TooManyRequests(format!(
                    "Too many password reset requests. Please try again in {} seconds.",
                    retry_after
                )));
            }
            Err(e) => {
                tracing::error!(error = ?e, "forgot_password: Rate limit check failed, allowing request");
            }
            _ => {}
        }
    }

    // Always return success to prevent email enumeration
    let result: Option<UserEmailRow> =
        sqlx::query_as("SELECT id, email FROM users WHERE email = $1")
            .bind(req.email.to_lowercase())
            .fetch_optional(&state.pool)
            .await?;

    if let Some(user) = result {
        // Log password reset request
        log_auth_event(
            &state.pool,
            Some(user.id),
            auth_event::PASSWORD_RESET_REQUESTED,
            Some(user.email.clone()),
            None,
            event_type::AUTHENTICATION,
            severity::INFO,
            ip_address.clone(),
            user_agent.clone(),
            true,
            Some("email".to_string()),
            Some("password".to_string()),
        )
        .await?;

        // Generate reset token and send email (fire and forget)
        let token_manager = TokenManager::new(state.pool.clone());
        let email_service = state.security_email.clone();
        let user_id = user.id;
        let user_email = user.email.clone();
        tokio::spawn(async move {
            match token_manager
                .create_token(
                    user_id,
                    VerificationTokenType::PasswordReset,
                    ip_address.as_deref(),
                    user_agent.as_deref(),
                )
                .await
            {
                Ok(reset_token) => {
                    email_service
                        .send_password_reset(&user_email, &reset_token)
                        .await;
                    tracing::info!(user_id = %user_id, "Password reset email sent");
                }
                Err(e) => {
                    tracing::error!(
                        user_id = %user_id,
                        error = %e,
                        "Failed to create password reset token"
                    );
                }
            }
        });
    }

    // Ensure constant-time response to prevent timing attacks (SOC 2 CC6.1)
    let elapsed = start.elapsed();
    let min_response_time = std::time::Duration::from_millis(500);
    if elapsed < min_response_time {
        tokio::time::sleep(min_response_time - elapsed).await;
    }

    Ok(Json(MessageResponse {
        message: "If an account exists with that email, a password reset link has been sent."
            .to_string(),
    }))
}

/// Reset password with token
pub async fn reset_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ResetPasswordRequest>,
) -> ApiResult<Json<MessageResponse>> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // Validate password strength
    validate_password_strength(&req.password).map_err(|e| ApiError::Validation(e.to_string()))?;

    // Validate and consume password reset token
    let token_manager = TokenManager::new(state.pool.clone());
    let user_id = token_manager
        .validate_and_consume_token(&req.token, VerificationTokenType::PasswordReset)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Invalid password reset token");
            ApiError::InvalidToken
        })?;

    // Fetch user email for logging
    let user_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;

    // Hash new password
    let password_hash = hash_password(&req.password).map_err(|_| ApiError::Internal)?;

    // Update password
    sqlx::query(
        r#"
        UPDATE users
        SET password_hash = $1
        WHERE id = $2
        "#,
    )
    .bind(&password_hash)
    .bind(user_id)
    .execute(&state.pool)
    .await?;

    // Invalidate any other password reset tokens for this user
    let _ = token_manager
        .invalidate_user_tokens(user_id, VerificationTokenType::PasswordReset)
        .await;

    // Log password reset completion
    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::PASSWORD_RESET_COMPLETED,
        Some(user_email.clone()),
        None,
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address.clone(),
        user_agent.clone(),
        true,
        Some("email".to_string()),
        Some("password".to_string()),
    )
    .await?;

    // Send password changed notification (fire and forget)
    let email_service = state.security_email.clone();
    tokio::spawn(async move {
        email_service
            .send_password_changed(&user_email, ip_address.as_deref())
            .await;
    });

    Ok(Json(MessageResponse {
        message: "Password has been reset successfully.".to_string(),
    }))
}

// =============================================================================
// OAuth 2FA Check
// =============================================================================

/// Response for OAuth 2FA check
#[derive(Debug, Serialize)]
#[serde(tag = "status")]
pub enum Check2FAResponse {
    /// No 2FA required, proceed with login
    #[serde(rename = "ok")]
    Ok,
    /// 2FA verification required
    #[serde(rename = "2fa_required")]
    TwoFactorRequired { temp_token: String, user_id: Uuid },
    /// 2FA already pending - reserved for potential future use
    /// Currently we always generate new tokens, but frontend handles this case as fallback
    #[allow(dead_code)]
    #[serde(rename = "2fa_pending")]
    TwoFactorPending { user_id: Uuid },
}

/// Check if 2FA is required for an OAuth-authenticated user
/// This endpoint is called after OAuth login to determine if 2FA verification is needed
/// The Supabase JWT token should be passed in the Authorization header
pub async fn check_2fa_required(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Check2FAResponse>> {
    // Extract the Supabase JWT from Authorization header
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or(ApiError::Unauthorized)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(ApiError::Unauthorized)?;

    // Verify the token via Supabase API
    let supabase_url = &state.config.supabase_url;
    let supabase_anon_key = &state.config.supabase_anon_key;

    if supabase_url.is_empty() || supabase_anon_key.is_empty() {
        return Err(ApiError::Internal);
    }

    // Call Supabase to verify token and get user info
    let client = reqwest::Client::new();
    let url = format!("{}/auth/v1/user", supabase_url);

    let response = client
        .get(&url)
        .header("apikey", supabase_anon_key)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to verify Supabase token: {}", e);
            ApiError::Unauthorized
        })?;

    if !response.status().is_success() {
        return Err(ApiError::Unauthorized);
    }

    #[derive(Deserialize)]
    struct SupabaseUser {
        id: String,
        email: Option<String>,
    }

    let supabase_user: SupabaseUser = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse Supabase user response: {}", e);
        ApiError::Internal
    })?;

    let oauth_user_id = Uuid::parse_str(&supabase_user.id).map_err(|_| ApiError::Internal)?;
    let user_email = supabase_user.email.clone();

    // Resolve the OAuth user ID to the actual user ID in our users table
    // This is necessary because OAuth users may have a different ID in our system
    // (e.g., when there's an existing user with the same org+email)
    let resolved_user_id = resolve_oauth_user_id(&state.pool, oauth_user_id, user_email.as_deref())
        .await
        .unwrap_or(oauth_user_id);

    tracing::info!(
        oauth_user_id = %oauth_user_id,
        resolved_user_id = %resolved_user_id,
        email = ?user_email,
        "check_2fa_required: Resolved OAuth user ID"
    );

    // Check if user has 2FA enabled using the resolved user ID
    let has_2fa: Option<(bool,)> =
        sqlx::query_as("SELECT is_enabled FROM user_2fa WHERE user_id = $1")
            .bind(resolved_user_id)
            .fetch_optional(&state.pool)
            .await?;

    let two_fa_enabled = has_2fa.map(|r| r.0).unwrap_or(false);

    if two_fa_enabled {
        // Always generate a new temporary login token for 2FA verification
        // The upsert below handles concurrent requests gracefully
        let temp_token = totp::generate_token();
        let token_hash = totp::hash_token(&temp_token);
        let expires_at =
            OffsetDateTime::now_utc() + time::Duration::minutes(totp::LOGIN_TOKEN_EXPIRY_MINUTES);

        // Store the temp token with email (upsert to handle concurrent logins)
        tracing::info!(
            user_id = %resolved_user_id,
            email = ?user_email,
            expires_at = %expires_at,
            "Creating 2FA login token for OAuth user"
        );

        let insert_result = sqlx::query(
            r#"
            INSERT INTO user_2fa_login_tokens (user_id, token_hash, expires_at, email)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) DO UPDATE SET
                token_hash = EXCLUDED.token_hash,
                expires_at = EXCLUDED.expires_at,
                email = EXCLUDED.email,
                created_at = NOW()
            RETURNING id
            "#,
        )
        .bind(resolved_user_id)
        .bind(&token_hash)
        .bind(expires_at)
        .bind(&user_email)
        .fetch_one(&state.pool)
        .await;

        match &insert_result {
            Ok(row) => {
                let token_id: Uuid = row.get("id");
                tracing::info!(
                    user_id = %resolved_user_id,
                    token_id = %token_id,
                    token_hash_prefix = %&token_hash[..20],
                    "Successfully created 2FA login token"
                );
            }
            Err(e) => {
                tracing::error!(
                    user_id = %resolved_user_id,
                    error = %e,
                    "Failed to insert 2FA login token"
                );
            }
        }

        insert_result?;

        tracing::info!(user_id = %resolved_user_id, "OAuth user requires 2FA verification");

        return Ok(Json(Check2FAResponse::TwoFactorRequired {
            temp_token,
            user_id: resolved_user_id,
        }));
    }

    // No 2FA required
    Ok(Json(Check2FAResponse::Ok))
}

/// Row type for password and email query
#[derive(FromRow)]
struct PasswordEmailRow {
    password_hash: String,
    email: String,
}

/// Change password (authenticated)
pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<ChangePasswordRequest>,
) -> ApiResult<Json<MessageResponse>> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Validate new password strength
    validate_password_strength(&req.new_password)
        .map_err(|e| ApiError::Validation(e.to_string()))?;

    // Get current password hash and email
    let user: PasswordEmailRow =
        sqlx::query_as("SELECT password_hash, email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.pool)
            .await?;

    // Verify current password
    let valid = verify_password(&req.current_password, &user.password_hash)
        .map_err(|_| ApiError::Internal)?;

    if !valid {
        return Err(ApiError::InvalidCredentials);
    }

    // Hash new password
    let password_hash = hash_password(&req.new_password).map_err(|_| ApiError::Internal)?;

    // Update password
    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(&password_hash)
        .bind(user_id)
        .execute(&state.pool)
        .await?;

    // Revoke all existing sessions to force re-authentication
    // This ensures compromised tokens can't be used after password change
    let revoked_count =
        sessions::revoke_all_sessions(&state.pool, user_id, "password_changed").await?;

    tracing::info!(
        user_id = %user_id,
        revoked_sessions = %revoked_count,
        "Revoked all user sessions after password change"
    );

    // Extract IP for logging and email
    let client_ip = extract_client_ip(&headers);

    // Log to audit table (ignore errors - best effort)
    let _ = sqlx::query(
        r#"
        INSERT INTO user_identity_audit (user_id, action, ip_address, user_agent)
        VALUES ($1, 'password_changed', $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(client_ip.as_deref())
    .bind(headers.get("user-agent").and_then(|h| h.to_str().ok()))
    .execute(&state.pool)
    .await;

    // Log password change to auth audit log
    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::PASSWORD_CHANGED,
        Some(user.email.clone()),
        None,
        event_type::AUTHENTICATION,
        severity::WARNING,
        ip_address,
        user_agent,
        true,
        None,
        Some("password".to_string()),
    )
    .await?;

    // Send email notification (fire and forget)
    let email_service = state.security_email.clone();
    let email_to = user.email;
    tokio::spawn(async move {
        email_service
            .send_password_changed(&email_to, client_ip.as_deref())
            .await;
    });

    Ok(Json(MessageResponse {
        message: "Password changed successfully.".to_string(),
    }))
}

/// Get current user profile
pub async fn me(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<UserResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let user: UserProfileRow = sqlx::query_as(
        r#"
        SELECT u.id, u.email, u.role, u.org_id, o.name as org_name,
               u.is_admin, u.platform_role::text as platform_role
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(UserResponse {
        id: user.id,
        email: user.email,
        role: user.role,
        org_id: user.org_id,
        org_name: user.org_name,
        is_admin: user.is_admin,
        platform_role: user.platform_role,
    }))
}

/// Logout (invalidate session and log event)
/// Note: With stateless JWT, tokens remain valid until expiry
/// Client should delete the token; we log the event for audit compliance
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<MessageResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // Get user email for audit log
    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;

    // Log logout event
    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::LOGOUT,
        email,
        None,
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address,
        user_agent,
        true,
        None,
        Some("session".to_string()),
    )
    .await?;

    Ok(Json(MessageResponse {
        message: "Logged out successfully".to_string(),
    }))
}

/// Check password strength (no authentication required - public endpoint)
/// Returns strength score, level, and feedback for password improvement
pub async fn check_password_strength(
    Json(req): Json<CheckPasswordStrengthRequest>,
) -> ApiResult<Json<CheckPasswordStrengthResponse>> {
    use crate::auth::password::calculate_password_strength;

    let strength = calculate_password_strength(&req.password);

    Ok(Json(CheckPasswordStrengthResponse {
        score: strength.score,
        level: strength.level,
        feedback: strength.feedback,
    }))
}

// =============================================================================
// Helpers
// =============================================================================

/// Validates email address according to RFC 5322 (simplified)
/// SOC 2 CC6.1: Strong input validation for authentication
fn is_valid_email(email: &str) -> bool {
    let email = email.trim().to_lowercase();

    // Length checks per RFC 5321
    if email.len() > 254 || email.is_empty() {
        return false;
    }

    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 {
        return false;
    }

    let local = parts[0];
    let domain = parts[1];

    // Local part validation
    if local.is_empty() || local.len() > 64 {
        return false;
    }
    // No leading/trailing/consecutive dots
    if local.starts_with('.') || local.ends_with('.') || local.contains("..") {
        return false;
    }
    // Allow alphanumeric, dots, hyphens, underscores, plus signs
    if !local
        .chars()
        .all(|c| c.is_alphanumeric() || ".+-_".contains(c))
    {
        return false;
    }

    // Domain validation
    if domain.is_empty() || domain.len() > 255 {
        return false;
    }
    // No leading/trailing hyphens
    if domain.starts_with('-') || domain.ends_with('-') {
        return false;
    }
    // No leading/trailing/consecutive dots
    if domain.starts_with('.') || domain.ends_with('.') || domain.contains("..") {
        return false;
    }

    // Must have valid TLD (at least 2 chars, alpha only)
    let domain_parts: Vec<&str> = domain.split('.').collect();
    if domain_parts.len() < 2 {
        return false;
    }
    if let Some(tld) = domain_parts.last() {
        if tld.len() < 2 || !tld.chars().all(|c| c.is_alphabetic()) {
            return false;
        }
    }

    // Domain characters: alphanumeric, dots, hyphens only
    if !domain
        .chars()
        .all(|c| c.is_alphanumeric() || c == '.' || c == '-')
    {
        return false;
    }

    true
}

fn generate_slug(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();

    // Remove consecutive dashes and trim
    let mut result = String::new();
    let mut prev_dash = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_dash && !result.is_empty() {
                result.push(c);
                prev_dash = true;
            }
        } else {
            result.push(c);
            prev_dash = false;
        }
    }

    // Trim trailing dash and add random suffix for uniqueness
    let trimmed = result.trim_end_matches('-');
    let suffix: u32 = rand::random::<u32>() % 10000;
    format!("{}-{:04}", trimmed, suffix)
}

/// Resolve an OAuth user ID to the actual user ID in our users table.
///
/// OAuth users from Supabase may have a different ID in our system when:
/// 1. A user with the same org+email already exists (e.g., created via API)
/// 2. The OAuth user ID was mapped to an existing user during first login
///
/// This function looks up the resolved user ID by checking:
/// 1. If the OAuth user ID directly exists in the users table
/// 2. If there's an organization membership for this OAuth user that points
///    to a user with the same org+email combination
///
/// Returns the resolved user ID, or None if no mapping is found.
async fn resolve_oauth_user_id(
    pool: &PgPool,
    oauth_user_id: Uuid,
    email: Option<&str>,
) -> Option<Uuid> {
    // First check if the OAuth user ID directly exists in users table
    let direct_user: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE id = $1")
        .bind(oauth_user_id)
        .fetch_optional(pool)
        .await
        .ok()?;

    if direct_user.is_some() {
        // OAuth user ID directly exists in users table
        return Some(oauth_user_id);
    }

    // Check if there's an org membership for this OAuth user
    // If so, look up if there's a user with the same org+email
    if let Some(email) = email {
        let org_membership: Option<(Uuid,)> =
            sqlx::query_as("SELECT org_id FROM organization_members WHERE user_id = $1 LIMIT 1")
                .bind(oauth_user_id)
                .fetch_optional(pool)
                .await
                .ok()?;

        if let Some((org_id,)) = org_membership {
            // Look for a user with the same org+email
            let existing_user: Option<(Uuid,)> =
                sqlx::query_as("SELECT id FROM users WHERE org_id = $1 AND email = $2")
                    .bind(org_id)
                    .bind(email)
                    .fetch_optional(pool)
                    .await
                    .ok()?;

            if let Some((user_id,)) = existing_user {
                tracing::debug!(
                    oauth_user_id = %oauth_user_id,
                    resolved_user_id = %user_id,
                    org_id = %org_id,
                    email = %email,
                    "Resolved OAuth user to existing user via org+email"
                );
                return Some(user_id);
            }
        }

        // Direct email lookup as final fallback
        let email_user: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(pool)
            .await
            .ok()?;

        if let Some((user_id,)) = email_user {
            tracing::info!(
                oauth_user_id = %oauth_user_id,
                resolved_user_id = %user_id,
                email = %email,
                "Resolved OAuth user to existing user via email"
            );
            return Some(user_id);
        }
    }

    // No mapping found
    None
}

// =============================================================================
// OAuth State Token Generation (CSRF Protection)
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct OAuthInitRequest {
    /// The PKCE code_verifier generated by the frontend
    pub code_verifier: String,
    /// The redirect URL after OAuth completes
    pub redirect_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OAuthInitResponse {
    /// The state token to include in the OAuth authorization URL
    pub state: String,
}

/// Initialize OAuth flow by generating a state token for CSRF protection
///
/// SOC 2 CC6.1: The state token prevents CSRF attacks by binding the OAuth
/// callback to this specific session. The code_verifier is stored with the
/// state and validated during token exchange.
/// Rate limited to prevent abuse.
pub async fn oauth_init(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<OAuthInitRequest>,
) -> ApiResult<Json<OAuthInitResponse>> {
    use rand::Rng;

    // SOC 2 CC6.1: Rate limit OAuth init by IP
    let (ip_address, _) = extract_auth_audit_context(&headers);
    if let Some(ref ip) = ip_address {
        match state.rate_limiter.check_oauth(ip).await {
            Ok(result) if !result.allowed => {
                tracing::warn!(ip = %ip, "OAuth init rate limit exceeded");
                return Err(ApiError::TooManyRequests(format!(
                    "Too many OAuth attempts. Retry in {} seconds.",
                    result.retry_after_seconds.unwrap_or(60)
                )));
            }
            Err(e) => {
                tracing::error!(error = ?e, "Failed to check OAuth rate limit");
                // Continue without rate limiting if check fails (fail open for availability)
            }
            _ => {}
        }
    }

    // Generate cryptographically secure state token (32 bytes = 256 bits)
    let state_token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    // Store state token with code_verifier for validation during exchange
    sqlx::query(
        "INSERT INTO oauth_state_tokens (state_token, code_verifier, redirect_url)
         VALUES ($1, $2, $3)",
    )
    .bind(&state_token)
    .bind(&req.code_verifier)
    .bind(&req.redirect_url)
    .execute(&state.pool)
    .await?;

    tracing::info!(
        state = %state_token,
        "oauth_init: Generated state token for OAuth flow"
    );

    Ok(Json(OAuthInitResponse { state: state_token }))
}

// =============================================================================
// OAuth Code Exchange (bypasses rate limits using service_role)
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct OAuthExchangeRequest {
    pub code: String,
    pub code_verifier: String,
    /// SOC 2 CC6.1: State parameter for CSRF protection
    /// Generated by oauth_init and validated here to prevent CSRF attacks
    pub state: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OAuthExchangeResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
    pub user: OAuthUserInfo,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthUserInfo {
    pub id: String,
    pub email: Option<String>,
}

/// Exchange OAuth code for tokens using service_role key
/// This bypasses Supabase rate limits that affect the anon key
///
/// SOC 2 CC6.1: Validates state parameter to prevent CSRF attacks on OAuth flow
/// Rate limited to prevent abuse.
pub async fn oauth_exchange(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<OAuthExchangeRequest>,
) -> ApiResult<Json<OAuthExchangeResponse>> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // SOC 2 CC6.1: Rate limit OAuth exchange by IP
    if let Some(ref ip) = ip_address {
        match state.rate_limiter.check_oauth(ip).await {
            Ok(result) if !result.allowed => {
                tracing::warn!(ip = %ip, "OAuth exchange rate limit exceeded");
                return Err(ApiError::TooManyRequests(format!(
                    "Too many OAuth attempts. Retry in {} seconds.",
                    result.retry_after_seconds.unwrap_or(60)
                )));
            }
            Err(e) => {
                tracing::error!(error = ?e, "Failed to check OAuth rate limit");
                // Continue without rate limiting if check fails (fail open for availability)
            }
            _ => {}
        }
    }

    // SOC 2 CC6.1: Validate state parameter if provided (CSRF protection)
    // State validation ensures the OAuth callback is in response to a request we initiated
    if let Some(ref state_param) = req.state {
        // Look up the state token
        let state_record: Option<(String, Option<time::OffsetDateTime>)> = sqlx::query_as(
            "SELECT code_verifier, used_at FROM oauth_state_tokens
             WHERE state_token = $1 AND expires_at > NOW()",
        )
        .bind(state_param)
        .fetch_optional(&state.pool)
        .await?;

        match state_record {
            Some((stored_verifier, used_at)) => {
                // Check if already used (replay attack prevention)
                if used_at.is_some() {
                    tracing::warn!(
                        state = %state_param,
                        "oauth_exchange: State token already used (potential replay attack)"
                    );
                    return Err(ApiError::BadRequest("OAuth state already used".into()));
                }

                // Verify code_verifier matches what was stored with state
                if stored_verifier != req.code_verifier {
                    tracing::warn!(
                        state = %state_param,
                        "oauth_exchange: Code verifier mismatch for state token"
                    );
                    return Err(ApiError::BadRequest("Invalid code verifier".into()));
                }

                // Mark state as used to prevent replay attacks
                sqlx::query("UPDATE oauth_state_tokens SET used_at = NOW() WHERE state_token = $1")
                    .bind(state_param)
                    .execute(&state.pool)
                    .await?;

                tracing::info!(state = %state_param, "oauth_exchange: State token validated successfully");
            }
            None => {
                tracing::warn!(
                    state = %state_param,
                    "oauth_exchange: State token not found or expired"
                );
                return Err(ApiError::BadRequest(
                    "Invalid or expired OAuth state".into(),
                ));
            }
        }
    } else {
        // Log warning but allow for backward compatibility during migration
        // TODO: Make state mandatory after frontend is updated
        tracing::warn!("oauth_exchange: No state parameter provided (legacy flow)");
    }

    let supabase_url = &state.config.supabase_url;
    let service_role_key = &state.config.supabase_service_role_key;

    if supabase_url.is_empty() || service_role_key.is_empty() {
        tracing::error!("Supabase URL or service role key not configured");
        return Err(ApiError::Internal);
    }

    // Exchange code for tokens using service_role key
    let client = reqwest::Client::new();
    let url = format!("{}/auth/v1/token?grant_type=pkce", supabase_url);

    let response = client
        .post(&url)
        .header("apikey", service_role_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "auth_code": req.code,
            "code_verifier": req.code_verifier,
        }))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to exchange OAuth code: {}", e);
            ApiError::Internal
        })?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        tracing::error!("OAuth code exchange failed: {} - {}", status, response_text);
        // Try to extract a user-friendly message from Supabase error
        let error_msg = if let Ok(error_json) =
            serde_json::from_str::<serde_json::Value>(&response_text)
        {
            if let Some(msg) = error_json.get("msg").and_then(|v| v.as_str()) {
                msg.to_string()
            } else if let Some(error_code) = error_json.get("error_code").and_then(|v| v.as_str()) {
                match error_code {
                    "bad_code_verifier" => {
                        "Invalid authentication state. Please try signing in again.".to_string()
                    }
                    "invalid_grant" => {
                        "Authorization code has expired. Please try signing in again.".to_string()
                    }
                    _ => format!("Authentication error: {}", error_code),
                }
            } else {
                "Authentication failed. Please try again.".to_string()
            }
        } else {
            "Authentication failed. Please try again.".to_string()
        };
        return Err(ApiError::BadRequest(error_msg));
    }

    #[derive(Deserialize)]
    struct SupabaseTokenResponse {
        access_token: String,
        refresh_token: String,
        expires_in: i64,
        token_type: String,
        user: SupabaseUser,
    }

    #[derive(Deserialize)]
    struct SupabaseUser {
        id: String,
        email: Option<String>,
    }

    let token_response: SupabaseTokenResponse =
        serde_json::from_str(&response_text).map_err(|e| {
            tracing::error!("Failed to parse OAuth response: {} - {}", e, response_text);
            ApiError::Internal
        })?;

    // Log successful OAuth login
    let user_id_parsed = Uuid::parse_str(&token_response.user.id).ok();
    log_auth_event(
        &state.pool,
        user_id_parsed,
        auth_event::OAUTH_LOGIN,
        token_response.user.email.clone(),
        Some(serde_json::json!({"provider": "oauth"})),
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address,
        user_agent,
        true,
        Some("oauth".to_string()),
        Some("oauth".to_string()),
    )
    .await?;

    Ok(Json(OAuthExchangeResponse {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        expires_in: token_response.expires_in,
        token_type: token_response.token_type,
        user: OAuthUserInfo {
            id: token_response.user.id,
            email: token_response.user.email,
        },
    }))
}

// =============================================================================
// Email Verification
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct VerifyEmailRequest {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct ResendVerificationRequest {
    pub email: String,
}

/// Verify email address with token
pub async fn verify_email(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<VerifyEmailRequest>,
) -> ApiResult<Json<MessageResponse>> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // Validate and consume verification token
    let token_manager = TokenManager::new(state.pool.clone());
    let user_id = token_manager
        .validate_and_consume_token(&req.token, VerificationTokenType::EmailVerification)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Invalid email verification token");
            ApiError::InvalidToken
        })?;

    // Mark email as verified
    sqlx::query(
        r#"
        UPDATE users
        SET email_verified = true
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .execute(&state.pool)
    .await?;

    // Log email verification
    let user_email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;

    log_auth_event(
        &state.pool,
        Some(user_id),
        "email_verified",
        user_email,
        None,
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address,
        user_agent,
        true,
        Some("email".to_string()),
        None,
    )
    .await?;

    tracing::info!(user_id = %user_id, "Email verified successfully");

    Ok(Json(MessageResponse {
        message: "Email verified successfully!".to_string(),
    }))
}

/// Resend verification email
pub async fn resend_verification_email(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ResendVerificationRequest>,
) -> ApiResult<Json<MessageResponse>> {
    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // Always return success to prevent email enumeration
    let result: Option<(Uuid, bool)> =
        sqlx::query_as("SELECT id, email_verified FROM users WHERE email = $1")
            .bind(req.email.to_lowercase())
            .fetch_optional(&state.pool)
            .await?;

    if let Some((user_id, email_verified)) = result {
        // Don't resend if already verified
        if !email_verified {
            // Generate new verification token and send email (fire and forget)
            let token_manager = TokenManager::new(state.pool.clone());
            let email_service = state.security_email.clone();
            let user_email = req.email.to_lowercase();
            tokio::spawn(async move {
                // Invalidate old tokens first
                let _ = token_manager
                    .invalidate_user_tokens(user_id, VerificationTokenType::EmailVerification)
                    .await;

                // Create new token
                match token_manager
                    .create_token(
                        user_id,
                        VerificationTokenType::EmailVerification,
                        ip_address.as_deref(),
                        user_agent.as_deref(),
                    )
                    .await
                {
                    Ok(verification_token) => {
                        email_service
                            .send_email_verification(&user_email, &verification_token)
                            .await;
                        tracing::info!(user_id = %user_id, "Verification email resent");
                    }
                    Err(e) => {
                        tracing::error!(
                            user_id = %user_id,
                            error = %e,
                            "Failed to create verification token for resend"
                        );
                    }
                }
            });
        }
    }

    Ok(Json(MessageResponse {
        message: "If an account exists with that email and is not yet verified, a verification email has been sent.".to_string(),
    }))
}

/// Session list response
#[derive(Debug, Serialize)]
pub struct SessionListResponse {
    pub sessions: Vec<sessions::UserSession>,
}

/// List active sessions for the authenticated user
pub async fn list_sessions(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<SessionListResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let sessions = sessions::list_sessions(&state.pool, user_id).await?;

    Ok(Json(SessionListResponse { sessions }))
}

/// Revoke session request (path parameter)
#[derive(Debug, Deserialize)]
pub struct RevokeSessionPath {
    pub session_id: Uuid,
}

/// Revoke a specific session by ID
pub async fn revoke_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(auth_user): Extension<AuthUser>,
    Path(params): Path<RevokeSessionPath>,
) -> ApiResult<Json<MessageResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Get the session to verify ownership
    let session: Option<sessions::UserSession> = sqlx::query_as(
        r#"
        SELECT
            id,
            jti,
            created_at,
            expires_at,
            last_used_at,
            ip_address,
            user_agent,
            token_type
        FROM user_sessions
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
        "#,
    )
    .bind(params.session_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;

    let session = session.ok_or(ApiError::NotFound)?;

    // Revoke the session by JTI
    let revoked = sessions::revoke_session(&state.pool, &session.jti, "user_revoked").await?;

    if !revoked {
        return Err(ApiError::NotFound);
    }

    // SOC 2 CC6.1: Audit log session revocation
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);
    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;

    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::SESSION_REVOKED,
        email,
        Some(serde_json::json!({
            "session_id": params.session_id.to_string(),
            "revoked_session_ip": session.ip_address,
            "revoked_session_user_agent": session.user_agent,
        })),
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address,
        user_agent,
        true,
        Some(session.jti.clone()),
        Some("session".to_string()),
    )
    .await?;

    tracing::info!(
        user_id = %user_id,
        session_id = %params.session_id,
        "User revoked session"
    );

    Ok(Json(MessageResponse {
        message: "Session revoked successfully.".to_string(),
    }))
}

/// Revoke all sessions for the authenticated user (logout everywhere)
pub async fn logout_all(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<MessageResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let revoked_count =
        sessions::revoke_all_sessions(&state.pool, user_id, "user_logout_all").await?;

    // SOC 2 CC6.1: Audit log bulk session revocation
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);
    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;

    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::SESSION_REVOKED,
        email,
        Some(serde_json::json!({
            "action": "logout_all",
            "revoked_count": revoked_count,
        })),
        event_type::AUTHENTICATION,
        severity::INFO,
        ip_address,
        user_agent,
        true,
        None,
        Some("session".to_string()),
    )
    .await?;

    tracing::info!(
        user_id = %user_id,
        revoked_sessions = %revoked_count,
        "User logged out from all sessions"
    );

    Ok(Json(MessageResponse {
        message: format!("Successfully logged out from {} session(s).", revoked_count),
    }))
}
