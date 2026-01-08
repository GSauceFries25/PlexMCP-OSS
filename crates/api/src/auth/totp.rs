//! TOTP (Time-based One-Time Password) module for 2FA
//!
//! Provides TOTP generation, verification, and QR code generation
//! compatible with Google Authenticator, Authy, and other TOTP apps.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{rand_core::RngCore, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use subtle::ConstantTimeEq;
use totp_rs::{Algorithm, Secret, TOTP};

// =============================================================================
// Constants
// =============================================================================

/// TOTP code length (standard is 6 digits)
pub const TOTP_DIGITS: usize = 6;

/// Time step in seconds (standard is 30 seconds)
pub const TOTP_STEP: u64 = 30;

/// Issuer name shown in authenticator apps
pub const TOTP_ISSUER: &str = "PlexMCP";

/// Maximum failed 2FA attempts before lockout
pub const MAX_2FA_ATTEMPTS: i32 = 5;

/// Lockout duration in minutes after max failed attempts
pub const LOCKOUT_DURATION_MINUTES: i64 = 15;

/// Number of backup codes to generate
pub const BACKUP_CODE_COUNT: usize = 10;

/// Character set for backup codes (excludes ambiguous chars: i, l, o, 0, 1)
const BACKUP_CODE_CHARSET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

/// Setup token expiry in minutes
pub const SETUP_TOKEN_EXPIRY_MINUTES: i64 = 10;

/// Login token expiry in minutes (after password verified, before 2FA)
pub const LOGIN_TOKEN_EXPIRY_MINUTES: i64 = 5;

/// Trusted device expiry in days
pub const TRUSTED_DEVICE_EXPIRY_DAYS: i64 = 30;

// =============================================================================
// Error Types
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum TotpError {
    #[error("Invalid TOTP secret")]
    InvalidSecret,
    #[error("Failed to create TOTP instance")]
    Creation,
    #[error("Failed to generate QR code")]
    QrGeneration,
    #[error("Failed to hash backup code")]
    HashError,
    #[error("Invalid hash format")]
    InvalidHash,
    #[error("Encryption failed")]
    Encryption,
    #[error("Decryption failed")]
    Decryption,
    #[error("Invalid encryption key")]
    InvalidKey,
}

// =============================================================================
// TOTP Operations
// =============================================================================

/// Generate a new TOTP secret (base32 encoded)
pub fn generate_secret() -> String {
    let secret = Secret::generate_secret();
    secret.to_encoded().to_string()
}

/// Create a TOTP instance for verification
pub fn create_totp(secret: &str, email: &str) -> Result<TOTP, TotpError> {
    let secret_bytes = Secret::Encoded(secret.to_string())
        .to_bytes()
        .map_err(|_| TotpError::InvalidSecret)?;

    TOTP::new(
        Algorithm::SHA1, // SHA1 is standard for TOTP compatibility
        TOTP_DIGITS,
        1, // skew: allow 1 step before/after for clock drift
        TOTP_STEP,
        secret_bytes,
        Some(TOTP_ISSUER.to_string()),
        email.to_string(),
    )
    .map_err(|_| TotpError::Creation)
}

/// Verify a TOTP code against a secret using constant-time comparison
///
/// SOC 2 CC6.1: Uses constant-time comparison to prevent timing attacks.
/// Timing attacks could allow an attacker to determine how many digits match,
/// significantly reducing the search space for brute-force attacks.
pub fn verify_code(secret: &str, code: &str, email: &str) -> Result<bool, TotpError> {
    let totp = create_totp(secret, email)?;

    // Validate code format (must be 6 digits)
    if code.len() != TOTP_DIGITS {
        return Ok(false);
    }
    if !code.chars().all(|c| c.is_ascii_digit()) {
        return Ok(false);
    }

    // Get current time
    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| TotpError::Creation)?
        .as_secs();

    // Generate codes for current window and adjacent windows (for clock skew)
    // skew=1 means we check time-30s, time, time+30s
    let time_steps = [
        current_time.saturating_sub(TOTP_STEP), // Previous window
        current_time,                             // Current window
        current_time.saturating_add(TOTP_STEP), // Next window
    ];

    let code_bytes = code.as_bytes();

    for time_step in time_steps {
        // Generate expected code for this time window
        let expected_code = totp.generate(time_step);
        // Constant-time comparison to prevent timing attacks
        let expected_bytes = expected_code.as_bytes();
        if code_bytes.len() == expected_bytes.len()
            && code_bytes.ct_eq(expected_bytes).into()
        {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Generate the current TOTP code (for testing)
#[allow(dead_code)]
pub fn generate_current_code(secret: &str, email: &str) -> Result<String, TotpError> {
    let totp = create_totp(secret, email)?;
    totp.generate_current().map_err(|_| TotpError::Creation)
}

// =============================================================================
// QR Code Generation
// =============================================================================

/// Generate QR code as base64 PNG data URL
pub fn generate_qr_code(secret: &str, email: &str) -> Result<String, TotpError> {
    let totp = create_totp(secret, email)?;
    let uri = totp.get_url();

    // Generate QR code
    let qr = qrcode::QrCode::new(uri.as_bytes()).map_err(|_| TotpError::QrGeneration)?;

    // Render to image
    let qr_image = qr.render::<image::Luma<u8>>().build();

    // Convert to DynamicImage and encode as PNG
    let dynamic_image = image::DynamicImage::ImageLuma8(qr_image);
    let mut png_data = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_data);
    dynamic_image
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|_| TotpError::QrGeneration)?;

    // Return as data URL
    Ok(format!(
        "data:image/png;base64,{}",
        BASE64.encode(&png_data)
    ))
}

/// Get the otpauth URI for manual entry
pub fn get_otpauth_uri(secret: &str, email: &str) -> Result<String, TotpError> {
    let totp = create_totp(secret, email)?;
    Ok(totp.get_url())
}

// =============================================================================
// Backup Codes
// =============================================================================

/// Generate backup codes in xxxxx-xxxxx format (alphanumeric, ~51 bits entropy)
pub fn generate_backup_codes() -> Vec<String> {
    (0..BACKUP_CODE_COUNT)
        .map(|_| {
            let code: String = (0..10)
                .map(|_| {
                    let mut byte = [0u8; 1];
                    OsRng.fill_bytes(&mut byte);
                    let idx = (byte[0] as usize) % BACKUP_CODE_CHARSET.len();
                    BACKUP_CODE_CHARSET[idx] as char
                })
                .collect();
            // Format as xxxxx-xxxxx (10 chars split by hyphen)
            format!("{}-{}", &code[0..5], &code[5..10])
        })
        .collect()
}

/// Hash a backup code using Argon2 for secure storage
pub fn hash_backup_code(code: &str) -> Result<String, TotpError> {
    // Normalize: remove hyphens and convert to uppercase
    let normalized = code.replace('-', "").to_uppercase();

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(normalized.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| TotpError::HashError)
}

/// Verify a backup code against its hash
pub fn verify_backup_code(code: &str, hash: &str) -> Result<bool, TotpError> {
    // Normalize: remove hyphens and convert to uppercase
    let normalized = code.replace('-', "").to_uppercase();

    let parsed_hash = PasswordHash::new(hash).map_err(|_| TotpError::InvalidHash)?;

    Ok(Argon2::default()
        .verify_password(normalized.as_bytes(), &parsed_hash)
        .is_ok())
}

// =============================================================================
// Secret Encryption (for storage at rest)
// =============================================================================

/// Encrypt a TOTP secret for database storage
/// Returns (encrypted_base64, nonce_base64)
pub fn encrypt_secret(secret: &str, encryption_key: &[u8; 32]) -> Result<(String, String), TotpError> {
    let cipher = Aes256Gcm::new_from_slice(encryption_key).map_err(|_| TotpError::InvalidKey)?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, secret.as_bytes())
        .map_err(|_| TotpError::Encryption)?;

    Ok((BASE64.encode(ciphertext), BASE64.encode(nonce_bytes)))
}

/// Decrypt a TOTP secret from database storage
pub fn decrypt_secret(
    encrypted_b64: &str,
    nonce_b64: &str,
    encryption_key: &[u8; 32],
) -> Result<String, TotpError> {
    let cipher = Aes256Gcm::new_from_slice(encryption_key).map_err(|_| TotpError::InvalidKey)?;

    // Decode from base64
    let ciphertext = BASE64.decode(encrypted_b64).map_err(|_| TotpError::Decryption)?;
    let nonce_bytes = BASE64.decode(nonce_b64).map_err(|_| TotpError::Decryption)?;

    let nonce = Nonce::from_slice(&nonce_bytes);

    // Decrypt
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| TotpError::Decryption)?;

    String::from_utf8(plaintext).map_err(|_| TotpError::Decryption)
}

/// Parse encryption key from hex string
pub fn parse_encryption_key(hex_key: &str) -> Result<[u8; 32], TotpError> {
    let bytes = hex::decode(hex_key).map_err(|_| TotpError::InvalidKey)?;
    bytes.try_into().map_err(|_| TotpError::InvalidKey)
}

// =============================================================================
// Token Generation
// =============================================================================

/// Generate a random token for setup/login flows
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Hash a token for secure storage
pub fn hash_token(token: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

// =============================================================================
// Device Trust
// =============================================================================

/// Generate a device token for "remember this device" feature
pub fn generate_device_token() -> String {
    generate_token() // Reuse the same secure random generation
}

/// Hash a device token for database storage
pub fn hash_device_token(token: &str) -> String {
    hash_token(token) // Reuse the same SHA256 hashing
}

/// Parse User-Agent to generate a human-readable device name
pub fn parse_device_name(user_agent: &str) -> String {
    // Extract browser and OS from user agent
    let browser = if user_agent.contains("Chrome") && !user_agent.contains("Edge") {
        "Chrome"
    } else if user_agent.contains("Firefox") {
        "Firefox"
    } else if user_agent.contains("Safari") && !user_agent.contains("Chrome") {
        "Safari"
    } else if user_agent.contains("Edge") {
        "Edge"
    } else {
        "Browser"
    };

    let os = if user_agent.contains("Windows") {
        "Windows"
    } else if user_agent.contains("Mac OS") || user_agent.contains("Macintosh") {
        "macOS"
    } else if user_agent.contains("Linux") {
        "Linux"
    } else if user_agent.contains("iPhone") || user_agent.contains("iPad") {
        "iOS"
    } else if user_agent.contains("Android") {
        "Android"
    } else {
        "Unknown"
    };

    format!("{} on {}", browser, os)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
#[allow(clippy::unwrap_used)]  // Allow unwrap() in tests for cleaner test code
mod tests {
    use super::*;

    #[test]
    fn test_generate_secret() {
        let secret = generate_secret();
        // Base32 encoded secrets should be uppercase letters and digits 2-7
        assert!(!secret.is_empty());
        assert!(secret.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_totp_creation() {
        let secret = generate_secret();
        let email = "test@example.com";

        let totp = create_totp(&secret, email);
        assert!(totp.is_ok());
    }

    #[test]
    fn test_verify_code() {
        let secret = generate_secret();
        let email = "test@example.com";

        // Generate current code
        let code = generate_current_code(&secret, email).unwrap();

        // Verify it
        let result = verify_code(&secret, &code, email).unwrap();
        assert!(result);

        // Wrong code should fail
        let wrong = verify_code(&secret, "000000", email).unwrap();
        assert!(!wrong);
    }

    #[test]
    fn test_qr_code_generation() {
        let secret = generate_secret();
        let email = "test@example.com";

        let qr = generate_qr_code(&secret, email);
        assert!(qr.is_ok());

        let data_url = qr.unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn test_backup_codes() {
        let codes = generate_backup_codes();

        assert_eq!(codes.len(), BACKUP_CODE_COUNT);

        for code in &codes {
            // Should be in xxxxx-xxxxx format (11 chars total)
            assert_eq!(code.len(), 11);
            assert_eq!(&code[5..6], "-");
            // First 5 chars should be alphanumeric lowercase
            assert!(code[..5].chars().all(|c| c.is_ascii_alphanumeric() && !c.is_uppercase()));
            // Last 5 chars should be alphanumeric lowercase
            assert!(code[6..].chars().all(|c| c.is_ascii_alphanumeric() && !c.is_uppercase()));
        }
    }

    #[test]
    fn test_backup_code_hash_verify() {
        let codes = generate_backup_codes();
        let code = &codes[0];

        let hash = hash_backup_code(code).unwrap();

        // Should verify with original code
        assert!(verify_backup_code(code, &hash).unwrap());

        // Should verify without hyphen
        let no_hyphen = code.replace('-', "");
        assert!(verify_backup_code(&no_hyphen, &hash).unwrap());

        // Should verify uppercase (normalization handles this)
        assert!(verify_backup_code(&code.to_uppercase(), &hash).unwrap());

        // Wrong code should fail
        assert!(!verify_backup_code("aaaaa-bbbbb", &hash).unwrap());
    }

    #[test]
    fn test_secret_encryption() {
        let secret = generate_secret();
        let key: [u8; 32] = [0x42; 32]; // Test key

        let (encrypted, nonce) = encrypt_secret(&secret, &key).unwrap();

        // Should be base64
        assert!(BASE64.decode(&encrypted).is_ok());
        assert!(BASE64.decode(&nonce).is_ok());

        // Should decrypt correctly
        let decrypted = decrypt_secret(&encrypted, &nonce, &key).unwrap();
        assert_eq!(secret, decrypted);

        // Wrong key should fail
        let wrong_key: [u8; 32] = [0x00; 32];
        assert!(decrypt_secret(&encrypted, &nonce, &wrong_key).is_err());
    }

    #[test]
    fn test_token_generation() {
        let token = generate_token();

        // Should be 64 hex characters (32 bytes)
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));

        // Hash should be deterministic
        let hash1 = hash_token(&token);
        let hash2 = hash_token(&token);
        assert_eq!(hash1, hash2);

        // Different tokens should have different hashes
        let token2 = generate_token();
        let hash3 = hash_token(&token2);
        assert_ne!(hash1, hash3);
    }
}
