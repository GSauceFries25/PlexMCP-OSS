//! Two-Factor Authentication (2FA) routes
//!
//! Provides TOTP-based 2FA setup, verification, and management.
//! Compatible with Google Authenticator, Authy, and other TOTP apps.

use axum::{
    extract::{Extension, State},
    http::{HeaderMap, StatusCode},
    Json,
};

use super::auth::{extract_auth_audit_context, log_auth_event};
use super::extract_client_ip;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    audit_constants::{auth_event, event_type, severity},
    auth::{totp, AuthUser},
    error::{ApiError, ApiResult},
    state::AppState,
};

// =============================================================================
// Request/Response Types
// =============================================================================

/// Response for 2FA status check
#[derive(Debug, Serialize)]
pub struct TwoFactorStatusResponse {
    /// Whether 2FA is currently enabled
    pub is_enabled: bool,
    /// When 2FA was enabled (if enabled)
    #[serde(with = "time::serde::rfc3339::option")]
    pub enabled_at: Option<OffsetDateTime>,
    /// Whether the account is currently locked due to failed attempts
    pub is_locked: bool,
    /// When the lock expires (if locked)
    #[serde(with = "time::serde::rfc3339::option")]
    pub locked_until: Option<OffsetDateTime>,
    /// Number of unused backup codes remaining
    pub backup_codes_remaining: i64,
}

/// Response for beginning 2FA setup
#[derive(Debug, Serialize)]
pub struct TwoFactorSetupResponse {
    /// QR code as base64 PNG data URL
    pub qr_code: String,
    /// TOTP secret for manual entry
    pub secret: String,
    /// Token to use when confirming setup
    pub setup_token: String,
}

/// Request to confirm 2FA setup
#[derive(Debug, Deserialize)]
pub struct TwoFactorConfirmRequest {
    /// Setup token from the setup response
    pub setup_token: String,
    /// 6-digit TOTP code from authenticator app
    pub code: String,
}

/// Response after confirming 2FA setup
#[derive(Debug, Serialize)]
pub struct TwoFactorConfirmResponse {
    /// Backup codes for recovery (xxxxx-xxxxx format, alphanumeric)
    /// These are shown once and should be saved securely
    pub backup_codes: Vec<String>,
}

/// Request to verify a 2FA code (for operations requiring re-auth)
#[derive(Debug, Deserialize)]
pub struct TwoFactorVerifyRequest {
    /// 6-digit TOTP code or backup code
    pub code: String,
}

/// Response for 2FA verification
#[derive(Debug, Serialize)]
pub struct TwoFactorVerifyResponse {
    /// Whether the code was valid
    pub valid: bool,
    /// Remaining attempts before lockout (if invalid)
    pub remaining_attempts: Option<i32>,
    /// Whether the account is now locked
    pub is_locked: bool,
}

/// Request to disable 2FA
#[derive(Debug, Deserialize)]
pub struct TwoFactorDisableRequest {
    /// Valid TOTP code or backup code to confirm disable
    pub code: String,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Fields populated from DB
struct TwoFactorRow {
    user_id: Uuid,
    totp_secret_encrypted: String,
    totp_secret_nonce: String,
    is_enabled: bool,
    enabled_at: Option<OffsetDateTime>,
    failed_attempts: i32,
    locked_until: Option<OffsetDateTime>,
    last_used_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Fields populated from DB
struct SetupTokenRow {
    id: Uuid,
    user_id: Uuid,
    temp_secret_encrypted: String,
    temp_secret_nonce: String,
    expires_at: OffsetDateTime,
    created_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct BackupCodeRow {
    id: Uuid,
    #[allow(dead_code)]
    user_id: Uuid,
    code_hash: String,
    #[allow(dead_code)]
    used_at: Option<OffsetDateTime>,
    #[allow(dead_code)]
    created_at: OffsetDateTime,
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Parse the TOTP encryption key from config
fn get_encryption_key(state: &AppState) -> Result<[u8; 32], ApiError> {
    totp::parse_encryption_key(&state.config.totp_encryption_key).map_err(|_| ApiError::Internal)
}

/// Get 2FA record for a user
async fn get_2fa_record(state: &AppState, user_id: Uuid) -> Result<Option<TwoFactorRow>, ApiError> {
    sqlx::query_as::<_, TwoFactorRow>(
        "SELECT user_id, totp_secret_encrypted, totp_secret_nonce, is_enabled, enabled_at, \
         failed_attempts, locked_until, last_used_at, created_at, updated_at \
         FROM user_2fa WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))
}

/// Count unused backup codes for a user
async fn count_backup_codes(state: &AppState, user_id: Uuid) -> Result<i64, ApiError> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM user_2fa_backup_codes WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(count.0)
}

/// Verify a 2FA code (TOTP or backup) for a user
async fn verify_2fa_code_internal(
    state: &AppState,
    user_id: Uuid,
    email: &str,
    code: &str,
) -> Result<bool, ApiError> {
    let tfa = get_2fa_record(state, user_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("2FA is not enabled".to_string()))?;

    // Check lockout
    let now = OffsetDateTime::now_utc();
    if let Some(locked_until) = tfa.locked_until {
        if locked_until > now {
            return Err(ApiError::RateLimited);
        }
    }

    let encryption_key = get_encryption_key(state)?;
    let secret = totp::decrypt_secret(
        &tfa.totp_secret_encrypted,
        &tfa.totp_secret_nonce,
        &encryption_key,
    )
    .map_err(|_| ApiError::Internal)?;

    // Try TOTP code first (6 digits)
    if code.len() == 6
        && code.chars().all(|c| c.is_ascii_digit())
        && totp::verify_code(&secret, code, email).map_err(|_| ApiError::Internal)?
    {
        // Reset failed attempts on success
        sqlx::query(
                "UPDATE user_2fa SET failed_attempts = 0, locked_until = NULL, last_used_at = $1 WHERE user_id = $2"
            )
            .bind(now)
            .bind(user_id)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        return Ok(true);
    }

    // Try backup codes (XXXX-XXXX format or without hyphen)
    let backup_codes: Vec<BackupCodeRow> = sqlx::query_as(
        "SELECT id, user_id, code_hash, used_at, created_at \
         FROM user_2fa_backup_codes WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    for bc in backup_codes {
        if totp::verify_backup_code(code, &bc.code_hash).map_err(|_| ApiError::Internal)? {
            // Mark backup code as used
            sqlx::query("UPDATE user_2fa_backup_codes SET used_at = $1 WHERE id = $2")
                .bind(now)
                .bind(bc.id)
                .execute(&state.pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

            // Reset failed attempts
            sqlx::query(
                "UPDATE user_2fa SET failed_attempts = 0, locked_until = NULL, last_used_at = $1 WHERE user_id = $2"
            )
            .bind(now)
            .bind(user_id)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            return Ok(true);
        }
    }

    // Failed - increment attempts
    let new_attempts = tfa.failed_attempts + 1;
    let locked_until = if new_attempts >= totp::MAX_2FA_ATTEMPTS {
        Some(now + time::Duration::minutes(totp::LOCKOUT_DURATION_MINUTES))
    } else {
        None
    };

    sqlx::query("UPDATE user_2fa SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3")
        .bind(new_attempts)
        .bind(locked_until)
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(false)
}

// =============================================================================
// Route Handlers
// =============================================================================

/// Get 2FA status for current user
///
/// GET /api/v1/2fa/status
pub async fn get_2fa_status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<TwoFactorStatusResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let row = get_2fa_record(&state, user_id).await?;
    let now = OffsetDateTime::now_utc();

    match row {
        Some(r) => {
            let is_locked = r.locked_until.map(|u| u > now).unwrap_or(false);
            let backup_codes_remaining = if r.is_enabled {
                count_backup_codes(&state, user_id).await?
            } else {
                0
            };

            Ok(Json(TwoFactorStatusResponse {
                is_enabled: r.is_enabled,
                enabled_at: r.enabled_at,
                is_locked,
                locked_until: if is_locked { r.locked_until } else { None },
                backup_codes_remaining,
            }))
        }
        None => Ok(Json(TwoFactorStatusResponse {
            is_enabled: false,
            enabled_at: None,
            is_locked: false,
            locked_until: None,
            backup_codes_remaining: 0,
        })),
    }
}

/// Begin 2FA setup - generates secret and QR code
///
/// POST /api/v1/2fa/setup
pub async fn begin_2fa_setup(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<TwoFactorSetupResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    let email = auth_user.email.as_deref().ok_or(ApiError::Unauthorized)?;

    // Check if 2FA already enabled
    let existing = get_2fa_record(&state, user_id).await?;
    if existing.map(|r| r.is_enabled).unwrap_or(false) {
        return Err(ApiError::BadRequest("2FA is already enabled".to_string()));
    }

    // Generate new secret
    let secret = totp::generate_secret();
    let qr_code = totp::generate_qr_code(&secret, email).map_err(|_| ApiError::Internal)?;

    // Encrypt secret for temporary storage
    let encryption_key = get_encryption_key(&state)?;
    let (encrypted, nonce) =
        totp::encrypt_secret(&secret, &encryption_key).map_err(|_| ApiError::Internal)?;

    // Generate setup token
    let setup_token = totp::generate_token();
    let expires_at =
        OffsetDateTime::now_utc() + time::Duration::minutes(totp::SETUP_TOKEN_EXPIRY_MINUTES);

    // Store in setup_tokens (UPSERT to replace any existing)
    sqlx::query(
        r#"
        INSERT INTO user_2fa_setup_tokens
            (id, user_id, temp_secret_encrypted, temp_secret_nonce, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE SET
            temp_secret_encrypted = EXCLUDED.temp_secret_encrypted,
            temp_secret_nonce = EXCLUDED.temp_secret_nonce,
            expires_at = EXCLUDED.expires_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&encrypted)
    .bind(&nonce)
    .bind(expires_at)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tracing::info!(user_id = %user_id, "2FA setup started");

    Ok(Json(TwoFactorSetupResponse {
        qr_code,
        secret, // Show once for manual entry
        setup_token,
    }))
}

/// Confirm 2FA setup with TOTP code
///
/// POST /api/v1/2fa/setup/confirm
pub async fn confirm_2fa_setup(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    headers: HeaderMap,
    Json(req): Json<TwoFactorConfirmRequest>,
) -> ApiResult<Json<TwoFactorConfirmResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    let email = auth_user.email.as_deref().ok_or(ApiError::Unauthorized)?;

    // Validate code format
    if req.code.len() != 6 || !req.code.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::Validation("Code must be 6 digits".to_string()));
    }

    // Get setup token
    let setup: SetupTokenRow = sqlx::query_as(
        r#"
        SELECT id, user_id, temp_secret_encrypted, temp_secret_nonce, expires_at, created_at
        FROM user_2fa_setup_tokens
        WHERE user_id = $1 AND expires_at > $2
        "#,
    )
    .bind(user_id)
    .bind(OffsetDateTime::now_utc())
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| {
        ApiError::BadRequest("Setup session expired. Please start again.".to_string())
    })?;

    // Decrypt secret
    let encryption_key = get_encryption_key(&state)?;
    let secret = totp::decrypt_secret(
        &setup.temp_secret_encrypted,
        &setup.temp_secret_nonce,
        &encryption_key,
    )
    .map_err(|_| ApiError::Internal)?;

    // Verify TOTP code
    if !totp::verify_code(&secret, &req.code, email).map_err(|_| ApiError::Internal)? {
        return Err(ApiError::Validation(
            "Invalid verification code. Please try again.".to_string(),
        ));
    }

    // Generate backup codes
    let backup_codes = totp::generate_backup_codes();

    // Start transaction
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Re-encrypt secret for permanent storage
    let (encrypted, nonce) =
        totp::encrypt_secret(&secret, &encryption_key).map_err(|_| ApiError::Internal)?;

    // Store 2FA config (UPSERT)
    sqlx::query(
        r#"
        INSERT INTO user_2fa
            (user_id, totp_secret_encrypted, totp_secret_nonce, is_enabled, enabled_at)
        VALUES ($1, $2, $3, TRUE, $4)
        ON CONFLICT (user_id) DO UPDATE SET
            totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
            totp_secret_nonce = EXCLUDED.totp_secret_nonce,
            is_enabled = TRUE,
            enabled_at = EXCLUDED.enabled_at,
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(&encrypted)
    .bind(&nonce)
    .bind(OffsetDateTime::now_utc())
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Delete any existing backup codes
    sqlx::query("DELETE FROM user_2fa_backup_codes WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Store hashed backup codes
    for code in &backup_codes {
        let hash = totp::hash_backup_code(code).map_err(|_| ApiError::Internal)?;
        sqlx::query("INSERT INTO user_2fa_backup_codes (user_id, code_hash) VALUES ($1, $2)")
            .bind(user_id)
            .bind(&hash)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    // Delete setup token
    sqlx::query("DELETE FROM user_2fa_setup_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    tracing::info!(user_id = %user_id, "2FA enabled successfully");

    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // Log 2FA enabled event (security enhancement is noteworthy)
    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::TWO_FA_ENABLED,
        Some(email.to_string()),
        None,
        event_type::AUTHENTICATION,
        severity::WARNING,
        ip_address,
        user_agent,
        true,
        None,
        Some("2fa".to_string()),
    )
    .await?;

    // Send email notification (fire and forget)
    let email_service = state.security_email.clone();
    let email_to = email.to_string();
    let client_ip = extract_client_ip(&headers);
    tokio::spawn(async move {
        email_service
            .send_2fa_enabled(&email_to, client_ip.as_deref())
            .await;
    });

    Ok(Json(TwoFactorConfirmResponse { backup_codes }))
}

/// Verify a 2FA code
///
/// POST /api/v1/2fa/verify
pub async fn verify_2fa(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<TwoFactorVerifyRequest>,
) -> ApiResult<Json<TwoFactorVerifyResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    let email = auth_user.email.as_deref().ok_or(ApiError::Unauthorized)?;

    let tfa = get_2fa_record(&state, user_id).await?;

    // Check if 2FA is enabled and extract the record
    let tfa = match tfa {
        Some(record) if record.is_enabled => record,
        _ => return Err(ApiError::BadRequest("2FA is not enabled".to_string())),
    };

    // Check lockout
    let now = OffsetDateTime::now_utc();
    if let Some(locked_until) = tfa.locked_until {
        if locked_until > now {
            return Ok(Json(TwoFactorVerifyResponse {
                valid: false,
                remaining_attempts: Some(0),
                is_locked: true,
            }));
        }
    }

    // Verify code
    let valid = verify_2fa_code_internal(&state, user_id, email, &req.code).await?;

    if valid {
        Ok(Json(TwoFactorVerifyResponse {
            valid: true,
            remaining_attempts: None,
            is_locked: false,
        }))
    } else {
        // Get updated record for remaining attempts
        let updated = get_2fa_record(&state, user_id)
            .await?
            .ok_or_else(|| ApiError::Database("2FA record disappeared".to_string()))?;
        let remaining = totp::MAX_2FA_ATTEMPTS - updated.failed_attempts;
        let is_locked = updated.locked_until.map(|u| u > now).unwrap_or(false);

        Ok(Json(TwoFactorVerifyResponse {
            valid: false,
            remaining_attempts: Some(remaining.max(0)),
            is_locked,
        }))
    }
}

/// Disable 2FA (requires valid code)
///
/// POST /api/v1/2fa/disable
pub async fn disable_2fa(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    headers: HeaderMap,
    Json(req): Json<TwoFactorDisableRequest>,
) -> ApiResult<StatusCode> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    let email = auth_user.email.as_deref().ok_or(ApiError::Unauthorized)?;

    // Verify code first
    let verified = verify_2fa_code_internal(&state, user_id, email, &req.code).await?;

    if !verified {
        return Err(ApiError::Validation(
            "Invalid verification code".to_string(),
        ));
    }

    // Delete all 2FA data
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query("DELETE FROM user_2fa_backup_codes WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query("DELETE FROM user_2fa WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    tracing::info!(user_id = %user_id, "2FA disabled");

    // Extract audit context
    let (ip_address, user_agent) = extract_auth_audit_context(&headers);

    // Log 2FA disabled event (CRITICAL - security degradation)
    log_auth_event(
        &state.pool,
        Some(user_id),
        auth_event::TWO_FA_DISABLED,
        Some(email.to_string()),
        None,
        event_type::AUTHENTICATION,
        severity::CRITICAL,
        ip_address,
        user_agent,
        true,
        None,
        Some("2fa".to_string()),
    )
    .await?;

    // Send email notification (fire and forget)
    let email_service = state.security_email.clone();
    let email_to = email.to_string();
    let client_ip = extract_client_ip(&headers);
    tokio::spawn(async move {
        email_service
            .send_2fa_disabled(&email_to, client_ip.as_deref())
            .await;
    });

    Ok(StatusCode::NO_CONTENT)
}

/// Regenerate backup codes (requires valid TOTP code)
///
/// POST /api/v1/2fa/backup-codes/regenerate
pub async fn regenerate_backup_codes(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<TwoFactorVerifyRequest>,
) -> ApiResult<Json<TwoFactorConfirmResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    let email = auth_user.email.as_deref().ok_or(ApiError::Unauthorized)?;

    // Must use TOTP (not backup code) to regenerate
    let tfa = get_2fa_record(&state, user_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("2FA is not enabled".to_string()))?;

    if !tfa.is_enabled {
        return Err(ApiError::BadRequest("2FA is not enabled".to_string()));
    }

    // Validate it's a 6-digit code (TOTP only, not backup)
    if req.code.len() != 6 || !req.code.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::Validation(
            "Must use authenticator code to regenerate backup codes".to_string(),
        ));
    }

    let encryption_key = get_encryption_key(&state)?;
    let secret = totp::decrypt_secret(
        &tfa.totp_secret_encrypted,
        &tfa.totp_secret_nonce,
        &encryption_key,
    )
    .map_err(|_| ApiError::Internal)?;

    if !totp::verify_code(&secret, &req.code, email).map_err(|_| ApiError::Internal)? {
        return Err(ApiError::Validation(
            "Invalid verification code".to_string(),
        ));
    }

    // Generate new backup codes
    let backup_codes = totp::generate_backup_codes();

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Delete old codes
    sqlx::query("DELETE FROM user_2fa_backup_codes WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Insert new codes
    for code in &backup_codes {
        let hash = totp::hash_backup_code(code).map_err(|_| ApiError::Internal)?;
        sqlx::query("INSERT INTO user_2fa_backup_codes (user_id, code_hash) VALUES ($1, $2)")
            .bind(user_id)
            .bind(&hash)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    tracing::info!(user_id = %user_id, "Backup codes regenerated");

    Ok(Json(TwoFactorConfirmResponse { backup_codes }))
}

// =============================================================================
// Trusted Device Types
// =============================================================================

/// Response for a single trusted device
#[derive(Debug, Serialize)]
pub struct TrustedDeviceResponse {
    pub id: Uuid,
    pub device_name: Option<String>,
    pub ip_address: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub last_used_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// Response for listing trusted devices
#[derive(Debug, Serialize)]
pub struct TrustedDevicesListResponse {
    pub devices: Vec<TrustedDeviceResponse>,
}

#[derive(Debug, FromRow)]
struct TrustedDeviceRow {
    id: Uuid,
    #[allow(dead_code)]
    user_id: Uuid,
    #[allow(dead_code)]
    device_hash: String,
    device_name: Option<String>,
    ip_address: Option<String>,
    last_used_at: OffsetDateTime,
    expires_at: OffsetDateTime,
    created_at: OffsetDateTime,
}

// =============================================================================
// Trusted Device Handlers
// =============================================================================

/// List all trusted devices for the current user
///
/// GET /api/v1/2fa/devices
pub async fn list_trusted_devices(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<TrustedDevicesListResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let now = OffsetDateTime::now_utc();

    let devices: Vec<TrustedDeviceRow> = sqlx::query_as(
        r#"
        SELECT id, user_id, device_hash, device_name, ip_address, last_used_at, expires_at, created_at
        FROM user_trusted_devices
        WHERE user_id = $1 AND expires_at > $2
        ORDER BY last_used_at DESC
        "#,
    )
    .bind(user_id)
    .bind(now)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let devices: Vec<TrustedDeviceResponse> = devices
        .into_iter()
        .map(|d| TrustedDeviceResponse {
            id: d.id,
            device_name: d.device_name,
            ip_address: d.ip_address,
            last_used_at: d.last_used_at,
            expires_at: d.expires_at,
            created_at: d.created_at,
        })
        .collect();

    Ok(Json(TrustedDevicesListResponse { devices }))
}

/// Revoke a specific trusted device
///
/// DELETE /api/v1/2fa/devices/:device_id
pub async fn revoke_trusted_device(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    axum::extract::Path(device_id): axum::extract::Path<Uuid>,
) -> ApiResult<StatusCode> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let result = sqlx::query("DELETE FROM user_trusted_devices WHERE id = $1 AND user_id = $2")
        .bind(device_id)
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    tracing::info!(user_id = %user_id, device_id = %device_id, "Trusted device revoked");

    Ok(StatusCode::NO_CONTENT)
}

/// Revoke all trusted devices for the current user
///
/// DELETE /api/v1/2fa/devices
pub async fn revoke_all_trusted_devices(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<StatusCode> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    sqlx::query("DELETE FROM user_trusted_devices WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    tracing::info!(user_id = %user_id, "All trusted devices revoked");

    Ok(StatusCode::NO_CONTENT)
}

// =============================================================================
// Device Trust Helper Functions
// =============================================================================

/// Check if a device is trusted for a user (skips 2FA if trusted)
pub async fn is_device_trusted(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    device_token: &str,
) -> Result<bool, ApiError> {
    let device_hash = totp::hash_device_token(device_token);
    let now = OffsetDateTime::now_utc();

    let result: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT id FROM user_trusted_devices
        WHERE user_id = $1 AND device_hash = $2 AND expires_at > $3
        "#,
    )
    .bind(user_id)
    .bind(&device_hash)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.is_some() {
        // Update last_used_at
        sqlx::query(
            "UPDATE user_trusted_devices SET last_used_at = $1 WHERE user_id = $2 AND device_hash = $3"
        )
        .bind(now)
        .bind(user_id)
        .bind(&device_hash)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        return Ok(true);
    }

    Ok(false)
}

/// Trust a device for a user (creates or updates trust record)
/// Returns the device token to be stored client-side
pub async fn trust_device(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    user_agent: Option<&str>,
    ip_address: Option<&str>,
) -> Result<String, ApiError> {
    let device_token = totp::generate_device_token();
    let device_hash = totp::hash_device_token(&device_token);
    let device_name = user_agent.map(totp::parse_device_name);

    let now = OffsetDateTime::now_utc();
    let expires_at = now + time::Duration::days(totp::TRUSTED_DEVICE_EXPIRY_DAYS);

    sqlx::query(
        r#"
        INSERT INTO user_trusted_devices
            (user_id, device_hash, device_name, ip_address, last_used_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, device_hash) DO UPDATE SET
            device_name = EXCLUDED.device_name,
            ip_address = EXCLUDED.ip_address,
            last_used_at = EXCLUDED.last_used_at,
            expires_at = EXCLUDED.expires_at
        "#,
    )
    .bind(user_id)
    .bind(&device_hash)
    .bind(&device_name)
    .bind(ip_address)
    .bind(now)
    .bind(expires_at)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tracing::info!(user_id = %user_id, device_name = ?device_name, "Device trusted");

    Ok(device_token)
}
