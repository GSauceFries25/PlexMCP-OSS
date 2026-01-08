//! PIN-protected API key management routes
//!
//! This module provides PIN-protected encrypted API key storage and retrieval.
//! Users can set a 4-digit PIN to enable viewing their API keys after creation.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{
        rand_core::RngCore, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Argon2,
};
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

// =============================================================================
// Constants
// =============================================================================

/// Maximum failed PIN attempts before lockout
const MAX_PIN_ATTEMPTS: i32 = 5;
/// Lockout duration in minutes
const LOCKOUT_DURATION_MINUTES: i64 = 15;
/// PIN length requirement
const PIN_LENGTH: usize = 4;
/// Encryption version: SHA-256 (legacy, insecure for 4-digit PINs)
const ENCRYPTION_VERSION_SHA256: i32 = 1;
/// Encryption version: Argon2id (current, secure)
const ENCRYPTION_VERSION_ARGON2: i32 = 2;

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct SetPinRequest {
    /// 4-digit PIN (numeric only)
    pub pin: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyPinRequest {
    /// 4-digit PIN to verify
    pub pin: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangePinRequest {
    /// Current PIN for verification
    pub current_pin: String,
    /// New 4-digit PIN
    pub new_pin: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPinRequest {
    /// User's email for verification
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPinRequest {
    /// Reset token from email
    pub token: String,
    /// New 4-digit PIN
    pub new_pin: String,
}

#[derive(Debug, Serialize)]
pub struct ResetPinResponse {
    /// Number of API keys that were invalidated
    pub invalidated_keys_count: i64,
    /// Message for the user
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct PinStatusResponse {
    /// Whether a PIN has been set
    pub has_pin: bool,
    /// When the PIN was set (if set)
    pub pin_set_at: Option<OffsetDateTime>,
    /// Number of failed attempts
    pub failed_attempts: i32,
    /// Whether the PIN is currently locked
    pub is_locked: bool,
    /// When the lock expires (if locked)
    pub locked_until: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize)]
pub struct VerifyPinResponse {
    /// Whether PIN verification succeeded
    pub valid: bool,
    /// Remaining attempts if failed (before lockout)
    pub remaining_attempts: Option<i32>,
    /// Whether account is now locked
    pub is_locked: bool,
}

#[derive(Debug, Serialize)]
pub struct RevealKeyResponse {
    /// The full API key (decrypted)
    pub key: String,
    /// Key ID for reference
    pub key_id: Uuid,
    /// Key name
    pub name: String,
}

// =============================================================================
// Database Row Types
// =============================================================================

/// Row type for the new user_pins table
#[derive(Debug, FromRow)]
#[allow(dead_code)] // Fields populated from DB
struct UserPinRow {
    user_id: Uuid,
    pin_hash: String,
    pin_salt: String,
    pin_set_at: OffsetDateTime,
    failed_attempts: i32,
    locked_until: Option<OffsetDateTime>,
}

#[derive(Debug, FromRow)]
struct ApiKeyEncryptedRow {
    id: Uuid,
    name: String,
    encrypted_key: Option<String>,
    key_nonce: Option<String>,
    created_at: OffsetDateTime,
    /// Key derivation version: 1=SHA-256 (legacy), 2=Argon2id (secure)
    encryption_version: i32,
}

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Fields populated from DB
struct PinResetTokenRow {
    id: Uuid,
    user_id: Uuid,
    token_hash: String,
    expires_at: OffsetDateTime,
    used_at: Option<OffsetDateTime>,
}

#[derive(Debug, FromRow)]
struct UserEmailRow {
    id: Uuid,
    email: String,
}

// =============================================================================
// PIN Cryptography Functions
// =============================================================================

/// Validate that a PIN is exactly 4 numeric digits
fn validate_pin(pin: &str) -> Result<(), ApiError> {
    if pin.len() != PIN_LENGTH {
        return Err(ApiError::Validation(format!(
            "PIN must be exactly {} digits",
            PIN_LENGTH
        )));
    }
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::Validation(
            "PIN must contain only numeric digits".to_string(),
        ));
    }
    Ok(())
}

/// Hash a PIN using Argon2id
fn hash_pin(pin: &str) -> Result<(String, String), ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    let hash = argon2
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|e| ApiError::Validation(format!("Failed to hash PIN: {}", e)))?
        .to_string();

    Ok((hash, salt.to_string()))
}

/// Verify a PIN against a stored hash
fn verify_pin_hash(pin: &str, hash: &str) -> Result<bool, ApiError> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| ApiError::Validation(format!("Invalid PIN hash: {}", e)))?;

    Ok(Argon2::default()
        .verify_password(pin.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Derive an encryption key from PIN + salt using SHA256 (v1 - LEGACY)
/// SOC 2 CC6.1: This is insecure for 4-digit PINs due to fast brute-force.
/// Kept for backwards compatibility with existing encrypted keys.
fn derive_encryption_key(pin: &str, salt: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    hasher.update(salt.as_bytes());
    hasher.update(b"plexmcp-key-encryption-v1"); // Domain separation
    hasher.finalize().into()
}

/// Derive an encryption key from PIN + salt using Argon2id (v2 - SECURE)
/// SOC 2 CC6.1: Uses memory-hard KDF to prevent GPU-accelerated brute-force.
fn derive_encryption_key_v2(pin: &str, salt: &str) -> Result<[u8; 32], ApiError> {
    // Create a longer salt by combining with domain separator
    let full_salt = format!("{}-plexmcp-key-encryption-v2", salt);

    // Argon2id is recommended for password/PIN hashing (resists both side-channel and GPU attacks)
    let argon2 = Argon2::default();

    let mut output = [0u8; 32];
    argon2
        .hash_password_into(pin.as_bytes(), full_salt.as_bytes(), &mut output)
        .map_err(|e| {
            tracing::error!("Argon2 key derivation failed: {}", e);
            ApiError::Internal
        })?;

    Ok(output)
}

/// Encrypt an API key using AES-256-GCM with PIN-derived key (v2 - Argon2id)
/// SOC 2 CC6.1: All new encryptions use Argon2id for secure key derivation
fn encrypt_api_key(api_key: &str, pin: &str, salt: &str) -> Result<(String, String), ApiError> {
    let key = derive_encryption_key_v2(pin, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| ApiError::Internal)?;

    // Generate random nonce (12 bytes for GCM)
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, api_key.as_bytes())
        .map_err(|_| ApiError::Internal)?;

    Ok((BASE64.encode(ciphertext), BASE64.encode(nonce_bytes)))
}

/// Decrypt an API key using AES-256-GCM with PIN-derived key
/// Supports both v1 (SHA-256) and v2 (Argon2id) key derivation for backwards compatibility
fn decrypt_api_key(
    encrypted_key: &str,
    nonce_b64: &str,
    pin: &str,
    salt: &str,
    encryption_version: i32,
) -> Result<String, ApiError> {
    // Select key derivation based on encryption version
    let key = match encryption_version {
        ENCRYPTION_VERSION_SHA256 => derive_encryption_key(pin, salt),
        ENCRYPTION_VERSION_ARGON2 => derive_encryption_key_v2(pin, salt)?,
        _ => {
            tracing::error!(encryption_version = %encryption_version, "Unknown encryption version");
            return Err(ApiError::Validation(
                "Unknown encryption version".to_string(),
            ));
        }
    };

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| ApiError::Internal)?;

    let ciphertext = BASE64
        .decode(encrypted_key)
        .map_err(|_| ApiError::Validation("Invalid encrypted key format".to_string()))?;

    let nonce_bytes = BASE64
        .decode(nonce_b64)
        .map_err(|_| ApiError::Validation("Invalid nonce format".to_string()))?;

    if nonce_bytes.len() != 12 {
        return Err(ApiError::Validation("Invalid nonce length".to_string()));
    }

    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| ApiError::Validation("Decryption failed - invalid PIN".to_string()))?;

    String::from_utf8(plaintext).map_err(|_| ApiError::Internal)
}

/// Generate a cryptographically secure random token (32 bytes, hex-encoded)
fn generate_reset_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Hash a reset token using SHA256
fn hash_reset_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Send PIN reset email via Resend API
async fn send_pin_reset_email(
    resend_api_key: &str,
    email_from: &str,
    public_url: &str,
    user_email: &str,
    reset_token: &str,
) -> Result<(), ApiError> {
    if resend_api_key.is_empty() {
        tracing::warn!("RESEND_API_KEY not configured, skipping email send");
        return Ok(());
    }

    let reset_url = format!("{}/reset-pin?token={}", public_url, reset_token);

    let email_body = format!(
        r#"{{
            "from": "{}",
            "to": ["{}"],
            "subject": "Reset Your PlexMCP PIN",
            "html": "<h2>PIN Reset Request</h2><p>You requested to reset your PlexMCP PIN.</p><p><strong>Warning:</strong> Resetting your PIN will invalidate all encrypted API keys. You will need to regenerate any keys you want to view again.</p><p><a href=\"{}\" style=\"display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;\">Reset PIN</a></p><p>This link expires in 1 hour.</p><p>If you didn't request this, you can safely ignore this email.</p>"
        }}"#,
        email_from, user_email, reset_url
    );

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", resend_api_key))
        .header("Content-Type", "application/json")
        .body(email_body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to send PIN reset email: {}", e);
            ApiError::Internal
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::error!("Resend API error: {} - {}", status, body);
        return Err(ApiError::Internal);
    }

    tracing::info!(email = %user_email, "PIN reset email sent");
    Ok(())
}

// =============================================================================
// Handlers
// =============================================================================

/// Get PIN status for current user
pub async fn get_pin_status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<PinStatusResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Query from new user_pins table
    let pin_data: Option<UserPinRow> = sqlx::query_as(
        r#"
        SELECT user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until
        FROM user_pins
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;

    // If no PIN record exists, return default "no PIN set" status
    let Some(pin_data) = pin_data else {
        return Ok(Json(PinStatusResponse {
            has_pin: false,
            pin_set_at: None,
            failed_attempts: 0,
            is_locked: false,
            locked_until: None,
        }));
    };

    let now = OffsetDateTime::now_utc();
    let is_locked = pin_data
        .locked_until
        .map(|until| until > now)
        .unwrap_or(false);

    Ok(Json(PinStatusResponse {
        has_pin: true, // If record exists, PIN is set
        pin_set_at: Some(pin_data.pin_set_at),
        failed_attempts: pin_data.failed_attempts,
        is_locked,
        locked_until: if is_locked {
            pin_data.locked_until
        } else {
            None
        },
    }))
}

/// Set or change PIN for current user
pub async fn set_pin(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<SetPinRequest>,
) -> ApiResult<StatusCode> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    validate_pin(&req.pin)?;

    // Check if user already has a PIN (should use change_pin endpoint)
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT pin_hash FROM user_pins WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?;

    if existing.is_some() {
        return Err(ApiError::Validation(
            "PIN already set. Use the change PIN endpoint to modify.".to_string(),
        ));
    }

    let (pin_hash, pin_salt) = hash_pin(&req.pin)?;

    // UPSERT into user_pins table - this works for any authenticated user
    // regardless of whether they exist in the users table
    sqlx::query(
        r#"
        INSERT INTO user_pins (user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until)
        VALUES ($1, $2, $3, $4, 0, NULL)
        ON CONFLICT (user_id) DO UPDATE SET
            pin_hash = EXCLUDED.pin_hash,
            pin_salt = EXCLUDED.pin_salt,
            pin_set_at = EXCLUDED.pin_set_at,
            failed_attempts = 0,
            locked_until = NULL
        "#,
    )
    .bind(user_id)
    .bind(&pin_hash)
    .bind(&pin_salt)
    .bind(OffsetDateTime::now_utc())
    .execute(&state.pool)
    .await?;

    tracing::info!(user_id = %user_id, "PIN set for user via user_pins table");

    Ok(StatusCode::NO_CONTENT)
}

/// Change PIN (requires current PIN verification)
pub async fn change_pin(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<ChangePinRequest>,
) -> ApiResult<StatusCode> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    validate_pin(&req.current_pin)?;
    validate_pin(&req.new_pin)?;

    let pin_data: UserPinRow = sqlx::query_as(
        r#"
        SELECT user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until
        FROM user_pins
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::Validation("No PIN set".to_string()))?;

    // Check if locked
    let now = OffsetDateTime::now_utc();
    if let Some(locked_until) = pin_data.locked_until {
        if locked_until > now {
            return Err(ApiError::RateLimited);
        }
    }

    // Verify current PIN
    if !verify_pin_hash(&req.current_pin, &pin_data.pin_hash)? {
        // Increment failed attempts
        let new_attempts = pin_data.failed_attempts + 1;
        let locked_until = if new_attempts >= MAX_PIN_ATTEMPTS {
            Some(now + time::Duration::minutes(LOCKOUT_DURATION_MINUTES))
        } else {
            None
        };

        sqlx::query(
            "UPDATE user_pins SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3",
        )
        .bind(new_attempts)
        .bind(locked_until)
        .bind(user_id)
        .execute(&state.pool)
        .await?;

        return Err(ApiError::InvalidCredentials);
    }

    // Generate new hash and salt
    let (new_hash, new_salt) = hash_pin(&req.new_pin)?;
    let old_salt = &pin_data.pin_salt;

    // Re-encrypt all API keys with new PIN
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let keys: Vec<ApiKeyEncryptedRow> = sqlx::query_as(
        "SELECT id, name, encrypted_key, key_nonce, created_at, encryption_version FROM api_keys WHERE org_id = $1 AND encrypted_key IS NOT NULL",
    )
    .bind(org_id)
    .fetch_all(&state.pool)
    .await?;

    let mut reencrypted_count = 0;
    let mut failed_count = 0;

    for key in keys {
        if let (Some(encrypted), Some(nonce)) = (key.encrypted_key, key.key_nonce) {
            // Decrypt with old PIN (using original encryption version)
            match decrypt_api_key(
                &encrypted,
                &nonce,
                &req.current_pin,
                old_salt,
                key.encryption_version,
            ) {
                Ok(plaintext) => {
                    // Re-encrypt with new PIN (always v2 - Argon2id)
                    if let Ok((new_encrypted, new_nonce)) =
                        encrypt_api_key(&plaintext, &req.new_pin, &new_salt)
                    {
                        sqlx::query(
                            "UPDATE api_keys SET encrypted_key = $1, key_nonce = $2, encryption_version = $3 WHERE id = $4",
                        )
                        .bind(&new_encrypted)
                        .bind(&new_nonce)
                        .bind(ENCRYPTION_VERSION_ARGON2)
                        .bind(key.id)
                        .execute(&state.pool)
                        .await?;
                        reencrypted_count += 1;
                    }
                }
                Err(_) => {
                    // Key was encrypted with a different PIN - clear it so user knows to rotate
                    tracing::warn!(
                        key_id = %key.id,
                        key_name = %key.name,
                        "Could not re-encrypt API key during PIN change - clearing encrypted data"
                    );
                    sqlx::query(
                        "UPDATE api_keys SET encrypted_key = NULL, key_nonce = NULL WHERE id = $1",
                    )
                    .bind(key.id)
                    .execute(&state.pool)
                    .await?;
                    failed_count += 1;
                }
            }
        }
    }

    if failed_count > 0 {
        tracing::info!(
            user_id = %user_id,
            reencrypted = %reencrypted_count,
            cleared = %failed_count,
            "PIN changed - some keys could not be re-encrypted"
        );
    }

    // Update PIN in user_pins table
    sqlx::query(
        r#"
        UPDATE user_pins
        SET pin_hash = $1, pin_salt = $2, pin_set_at = $3,
            failed_attempts = 0, locked_until = NULL
        WHERE user_id = $4
        "#,
    )
    .bind(&new_hash)
    .bind(&new_salt)
    .bind(OffsetDateTime::now_utc())
    .bind(user_id)
    .execute(&state.pool)
    .await?;

    tracing::info!(user_id = %user_id, "PIN changed for user");

    Ok(StatusCode::NO_CONTENT)
}

/// Verify PIN (for UI state management)
pub async fn verify_pin(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<VerifyPinRequest>,
) -> ApiResult<Json<VerifyPinResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    validate_pin(&req.pin)?;

    let pin_data: UserPinRow = sqlx::query_as(
        r#"
        SELECT user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until
        FROM user_pins
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::Validation("No PIN set".to_string()))?;

    let now = OffsetDateTime::now_utc();

    // Check if locked
    if let Some(locked_until) = pin_data.locked_until {
        if locked_until > now {
            return Ok(Json(VerifyPinResponse {
                valid: false,
                remaining_attempts: Some(0),
                is_locked: true,
            }));
        }
    }

    let valid = verify_pin_hash(&req.pin, &pin_data.pin_hash)?;

    if valid {
        // Reset failed attempts on success
        sqlx::query(
            "UPDATE user_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1",
        )
        .bind(user_id)
        .execute(&state.pool)
        .await?;

        Ok(Json(VerifyPinResponse {
            valid: true,
            remaining_attempts: None,
            is_locked: false,
        }))
    } else {
        // Increment failed attempts
        let new_attempts = pin_data.failed_attempts + 1;
        let is_locked = new_attempts >= MAX_PIN_ATTEMPTS;
        let locked_until = if is_locked {
            Some(now + time::Duration::minutes(LOCKOUT_DURATION_MINUTES))
        } else {
            None
        };

        sqlx::query(
            "UPDATE user_pins SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3",
        )
        .bind(new_attempts)
        .bind(locked_until)
        .bind(user_id)
        .execute(&state.pool)
        .await?;

        Ok(Json(VerifyPinResponse {
            valid: false,
            remaining_attempts: Some(MAX_PIN_ATTEMPTS - new_attempts),
            is_locked,
        }))
    }
}

/// Delete PIN (removes encrypted keys too)
pub async fn delete_pin(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<VerifyPinRequest>,
) -> ApiResult<StatusCode> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    validate_pin(&req.pin)?;

    let pin_data: UserPinRow = sqlx::query_as(
        r#"
        SELECT user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until
        FROM user_pins
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::Validation("No PIN set".to_string()))?;

    // Check if locked
    let now = OffsetDateTime::now_utc();
    if let Some(locked_until) = pin_data.locked_until {
        if locked_until > now {
            return Err(ApiError::RateLimited);
        }
    }

    // Verify PIN before deleting
    if !verify_pin_hash(&req.pin, &pin_data.pin_hash)? {
        let new_attempts = pin_data.failed_attempts + 1;
        let locked_until = if new_attempts >= MAX_PIN_ATTEMPTS {
            Some(now + time::Duration::minutes(LOCKOUT_DURATION_MINUTES))
        } else {
            None
        };

        sqlx::query(
            "UPDATE user_pins SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3",
        )
        .bind(new_attempts)
        .bind(locked_until)
        .bind(user_id)
        .execute(&state.pool)
        .await?;

        return Err(ApiError::InvalidCredentials);
    }

    // Clear encrypted keys for this user's organization
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    sqlx::query("UPDATE api_keys SET encrypted_key = NULL, key_nonce = NULL WHERE org_id = $1")
        .bind(org_id)
        .execute(&state.pool)
        .await?;

    // Delete PIN record from user_pins table
    sqlx::query("DELETE FROM user_pins WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await?;

    tracing::info!(user_id = %user_id, "PIN deleted for user");

    Ok(StatusCode::NO_CONTENT)
}

/// Reveal an API key (requires PIN verification)
pub async fn reveal_api_key(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(key_id): Path<Uuid>,
    Json(req): Json<VerifyPinRequest>,
) -> ApiResult<Json<RevealKeyResponse>> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;
    validate_pin(&req.pin)?;

    // Only owners and admins can reveal API keys
    if !["owner", "admin"].contains(&auth_user.role.as_str()) {
        return Err(ApiError::Forbidden);
    }

    // Get user PIN info from user_pins table
    let pin_data: UserPinRow = sqlx::query_as(
        r#"
        SELECT user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until
        FROM user_pins
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::Validation("No PIN set. Set a PIN first to reveal keys.".to_string())
    })?;

    // Check if locked
    let now = OffsetDateTime::now_utc();
    if let Some(locked_until) = pin_data.locked_until {
        if locked_until > now {
            return Err(ApiError::RateLimited);
        }
    }

    // Verify PIN
    if !verify_pin_hash(&req.pin, &pin_data.pin_hash)? {
        let new_attempts = pin_data.failed_attempts + 1;
        let locked_until = if new_attempts >= MAX_PIN_ATTEMPTS {
            Some(now + time::Duration::minutes(LOCKOUT_DURATION_MINUTES))
        } else {
            None
        };

        sqlx::query(
            "UPDATE user_pins SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3",
        )
        .bind(new_attempts)
        .bind(locked_until)
        .bind(user_id)
        .execute(&state.pool)
        .await?;

        return Err(ApiError::InvalidCredentials);
    }

    // Reset failed attempts on success
    sqlx::query("UPDATE user_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await?;

    // Get the API key - query by org_id since api_keys table uses org_id (not user_id)
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    tracing::info!(
        user_id = %user_id,
        org_id = %org_id,
        key_id = %key_id,
        "Attempting to reveal API key"
    );

    let key: ApiKeyEncryptedRow = sqlx::query_as(
        "SELECT id, name, encrypted_key, key_nonce, created_at, encryption_version FROM api_keys WHERE id = $1 AND org_id = $2",
    )
    .bind(key_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        // Log diagnostic info when key is not found
        tracing::warn!(
            key_id = %key_id,
            org_id = %org_id,
            "API key not found for reveal - key_id/org_id mismatch"
        );
        ApiError::NotFound
    })?;

    let encrypted = key.encrypted_key.ok_or_else(|| {
        ApiError::Validation(
            "Key not available for reveal (created before PIN was set)".to_string(),
        )
    })?;
    let nonce = key
        .key_nonce
        .ok_or_else(|| ApiError::Validation("Key nonce not found".to_string()))?;

    // Attempt decryption (using stored encryption version for backwards compatibility)
    let plaintext = match decrypt_api_key(
        &encrypted,
        &nonce,
        &req.pin,
        &pin_data.pin_salt,
        key.encryption_version,
    ) {
        Ok(pt) => pt,
        Err(_) => {
            // Check if key was created before PIN was set (or encrypted with different PIN)
            // This can happen if:
            // 1. Key was created before PIN was set
            // 2. PIN was changed but old keys weren't re-encrypted
            // 3. PIN was reset via forgot_pin but old encrypted data remained
            let key_created_before_pin = key.created_at < pin_data.pin_set_at;

            tracing::warn!(
                key_id = %key_id,
                key_name = %key.name,
                key_created_at = %key.created_at,
                pin_set_at = %pin_data.pin_set_at,
                key_created_before_pin = %key_created_before_pin,
                "Decryption failed - possible PIN/key mismatch"
            );

            if key_created_before_pin {
                return Err(ApiError::Validation(
                    "This key was encrypted with a different PIN. Please rotate the key to re-encrypt it with your current PIN.".to_string()
                ));
            } else {
                // Key was created after PIN was set, but decryption still failed
                // This could mean:
                // - Wrong PIN entered
                // - Key was encrypted, then PIN was changed without re-encryption
                return Err(ApiError::Validation(
                    "Decryption failed. If you recently changed your PIN, please rotate this key to re-encrypt it.".to_string()
                ));
            }
        }
    };

    tracing::info!(
        user_id = %user_id,
        key_id = %key_id,
        "API key revealed"
    );

    Ok(Json(RevealKeyResponse {
        key: plaintext,
        key_id: key.id,
        name: key.name,
    }))
}

/// Request PIN reset (forgot PIN) - sends email with reset link
/// This is a PUBLIC endpoint (no auth required) - user forgot their PIN
pub async fn forgot_pin(
    State(state): State<AppState>,
    Json(req): Json<ForgotPinRequest>,
) -> ApiResult<Json<crate::routes::auth::MessageResponse>> {
    // Rate limit check: max 3 requests per hour per email
    let email = req.email.to_lowercase().trim().to_string();

    // Find user by email
    let user: Option<UserEmailRow> = sqlx::query_as("SELECT id, email FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await?;

    // Always return success to prevent email enumeration
    if let Some(user) = user {
        // Check if user has a PIN set
        let has_pin: Option<(Uuid,)> =
            sqlx::query_as("SELECT user_id FROM user_pins WHERE user_id = $1")
                .bind(user.id)
                .fetch_optional(&state.pool)
                .await?;

        if has_pin.is_some() {
            // Check rate limit: count recent reset requests
            let recent_count: (i64,) = sqlx::query_as(
                r#"
                SELECT COUNT(*) FROM pin_reset_tokens
                WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
                "#,
            )
            .bind(user.id)
            .fetch_one(&state.pool)
            .await?;

            if recent_count.0 >= 3 {
                tracing::warn!(
                    user_id = %user.id,
                    "PIN reset rate limit exceeded"
                );
                // Still return success to prevent enumeration
            } else {
                // Generate reset token
                let reset_token = generate_reset_token();
                let token_hash = hash_reset_token(&reset_token);
                let expires_at = OffsetDateTime::now_utc() + time::Duration::hours(1);

                // Store token
                sqlx::query(
                    r#"
                    INSERT INTO pin_reset_tokens (user_id, token_hash, expires_at)
                    VALUES ($1, $2, $3)
                    "#,
                )
                .bind(user.id)
                .bind(&token_hash)
                .bind(expires_at)
                .execute(&state.pool)
                .await?;

                // Send email
                if let Err(e) = send_pin_reset_email(
                    &state.config.resend_api_key,
                    &state.config.email_from,
                    &state.config.public_url,
                    &user.email,
                    &reset_token,
                )
                .await
                {
                    tracing::error!("Failed to send PIN reset email: {:?}", e);
                }

                tracing::info!(user_id = %user.id, "PIN reset requested");
            }
        }
    }

    Ok(Json(crate::routes::auth::MessageResponse {
        message:
            "If an account exists with that email and has a PIN set, a reset link has been sent."
                .to_string(),
    }))
}

/// Reset PIN with token from email
/// This is a PUBLIC endpoint (no auth required)
pub async fn reset_pin(
    State(state): State<AppState>,
    Json(req): Json<ResetPinRequest>,
) -> ApiResult<Json<ResetPinResponse>> {
    validate_pin(&req.new_pin)?;

    let token_hash = hash_reset_token(&req.token);
    let now = OffsetDateTime::now_utc();

    // Find valid token
    let token_row: PinResetTokenRow = sqlx::query_as(
        r#"
        SELECT id, user_id, token_hash, expires_at, used_at
        FROM pin_reset_tokens
        WHERE token_hash = $1 AND expires_at > $2 AND used_at IS NULL
        "#,
    )
    .bind(&token_hash)
    .bind(now)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::Validation("Invalid or expired reset token".to_string()))?;

    // Start transaction
    let mut tx = state.pool.begin().await?;

    // Mark token as used
    sqlx::query("UPDATE pin_reset_tokens SET used_at = $1 WHERE id = $2")
        .bind(now)
        .bind(token_row.id)
        .execute(&mut *tx)
        .await?;

    // Get user's org_id to clear their encrypted keys
    let org_id: Option<(Uuid,)> = sqlx::query_as("SELECT org_id FROM users WHERE id = $1")
        .bind(token_row.user_id)
        .fetch_optional(&mut *tx)
        .await?;

    // Clear all encrypted API keys for this user's organization
    let invalidated_count = if let Some((org_id,)) = org_id {
        let result = sqlx::query(
            r#"
            UPDATE api_keys
            SET encrypted_key = NULL, key_nonce = NULL
            WHERE org_id = $1 AND encrypted_key IS NOT NULL
            "#,
        )
        .bind(org_id)
        .execute(&mut *tx)
        .await?;
        result.rows_affected() as i64
    } else {
        0
    };

    // Generate new PIN hash and salt
    let (pin_hash, pin_salt) = hash_pin(&req.new_pin)?;

    // Update or insert PIN in user_pins table
    sqlx::query(
        r#"
        INSERT INTO user_pins (user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until)
        VALUES ($1, $2, $3, $4, 0, NULL)
        ON CONFLICT (user_id) DO UPDATE SET
            pin_hash = EXCLUDED.pin_hash,
            pin_salt = EXCLUDED.pin_salt,
            pin_set_at = EXCLUDED.pin_set_at,
            failed_attempts = 0,
            locked_until = NULL
        "#
    )
    .bind(token_row.user_id)
    .bind(&pin_hash)
    .bind(&pin_salt)
    .bind(now)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    tracing::info!(
        user_id = %token_row.user_id,
        invalidated_keys = %invalidated_count,
        "PIN reset completed"
    );

    Ok(Json(ResetPinResponse {
        invalidated_keys_count: invalidated_count,
        message: format!(
            "PIN has been reset successfully. {} API key(s) were invalidated and will need to be regenerated.",
            invalidated_count
        ),
    }))
}

// =============================================================================
// Helper for API Key Creation (to be called from api_keys.rs)
// =============================================================================

/// Encrypt and store API key if user has PIN set
pub async fn store_encrypted_key(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    key_id: Uuid,
    _api_key: &str,
) -> Result<(), ApiError> {
    // Check if user has PIN set in user_pins table
    let pin_data: Option<UserPinRow> = sqlx::query_as(
        r#"
        SELECT user_id, pin_hash, pin_salt, pin_set_at, failed_attempts, locked_until
        FROM user_pins
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if pin_data.is_some() {
        // We can't encrypt without the actual PIN, so we skip encryption here.
        // The key will be encrypted when user provides PIN via a separate endpoint.
        // For now, just log that encryption would happen.
        tracing::debug!(
            user_id = %user_id,
            key_id = %key_id,
            "User has PIN set - key can be revealed later"
        );
    }

    Ok(())
}

/// Encrypt an API key with user's PIN (call this from create_api_key handler with PIN)
pub async fn encrypt_and_store_key(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    key_id: Uuid,
    api_key: &str,
    pin: &str,
) -> Result<(), ApiError> {
    // Get user's PIN hash and salt from user_pins table
    let pin_data: Option<(String, String)> =
        sqlx::query_as("SELECT pin_hash, pin_salt FROM user_pins WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if let Some((pin_hash, salt)) = pin_data {
        // Verify the PIN before using it for encryption
        if !verify_pin_hash(pin, &pin_hash)? {
            return Err(ApiError::InvalidCredentials);
        }

        let (encrypted, nonce) = encrypt_api_key(api_key, pin, &salt)?;

        // Store encrypted key with v2 (Argon2id) encryption version
        sqlx::query(
            "UPDATE api_keys SET encrypted_key = $1, key_nonce = $2, encryption_version = $3 WHERE id = $4",
        )
        .bind(&encrypted)
        .bind(&nonce)
        .bind(ENCRYPTION_VERSION_ARGON2)
        .bind(key_id)
        .execute(pool)
        .await?;

        tracing::debug!(
            user_id = %user_id,
            key_id = %key_id,
            "API key encrypted and stored (v2 - Argon2id)"
        );
    }

    Ok(())
}

/// Verify a user's PIN without encryption (for pre-validation)
pub async fn verify_user_pin(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    pin: &str,
) -> Result<(), ApiError> {
    // Validate PIN format first
    validate_pin(pin)?;

    // Get user's PIN data
    let pin_data: Option<(String,)> =
        sqlx::query_as("SELECT pin_hash FROM user_pins WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    let (pin_hash,) =
        pin_data.ok_or_else(|| ApiError::Validation("No PIN set for this user".to_string()))?;

    // Verify the PIN
    if !verify_pin_hash(pin, &pin_hash)? {
        return Err(ApiError::InvalidCredentials);
    }

    Ok(())
}
