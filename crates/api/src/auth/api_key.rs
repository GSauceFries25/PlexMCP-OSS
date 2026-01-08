//! API Key generation and validation

use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

const API_KEY_PREFIX: &str = "pmcp_";
const API_KEY_VERSION: &str = "01";

/// API Key manager for generation and validation
#[derive(Clone)]
pub struct ApiKeyManager {
    hmac_secret: Vec<u8>,
}

impl ApiKeyManager {
    /// Create a new API key manager
    pub fn new(secret: &str) -> Self {
        Self {
            hmac_secret: secret.as_bytes().to_vec(),
        }
    }

    /// Generate a new API key
    /// Returns (full_key, key_hash, key_prefix)
    pub fn generate_key(&self) -> Result<(String, String, String), ApiKeyError> {
        // Generate random identifier
        let key_id = Uuid::new_v4();
        let random_bytes: [u8; 16] = rand::random();
        let random_hex = hex::encode(random_bytes);

        // Create the key payload: version + uuid + random
        let payload = format!("{}{}{}", API_KEY_VERSION, key_id.simple(), random_hex);

        // Sign with HMAC
        let mut mac = HmacSha256::new_from_slice(&self.hmac_secret)
            .map_err(|_| ApiKeyError::HmacInitFailed)?;
        mac.update(payload.as_bytes());
        let signature = mac.finalize().into_bytes();
        let sig_hex = hex::encode(&signature[..8]); // Use first 8 bytes of signature

        // Full key: prefix + payload + signature
        let full_key = format!("{}{}{}", API_KEY_PREFIX, payload, sig_hex);

        // Hash for storage
        let key_hash = self.hash_key(&full_key);

        // Prefix for display (first 12 chars after prefix)
        let key_prefix = format!("{}{}...", API_KEY_PREFIX, &payload[..12]);

        Ok((full_key, key_hash, key_prefix))
    }

    /// Validate an API key format and signature
    pub fn validate_key(&self, key: &str) -> Result<bool, ApiKeyError> {
        // Check prefix
        if !key.starts_with(API_KEY_PREFIX) {
            return Ok(false);
        }

        let key_body = &key[API_KEY_PREFIX.len()..];

        // Key body should be: version(2) + uuid(32) + random(32) + signature(16) = 82 chars
        if key_body.len() != 82 {
            return Ok(false);
        }

        // Extract parts
        let payload = &key_body[..66]; // version + uuid + random
        let provided_sig = &key_body[66..]; // signature

        // Verify HMAC signature
        let mut mac = HmacSha256::new_from_slice(&self.hmac_secret)
            .map_err(|_| ApiKeyError::HmacInitFailed)?;
        mac.update(payload.as_bytes());
        let expected_sig = mac.finalize().into_bytes();
        let expected_sig_hex = hex::encode(&expected_sig[..8]);

        Ok(constant_time_compare(provided_sig, &expected_sig_hex))
    }

    /// Hash an API key for storage
    pub fn hash_key(&self, key: &str) -> String {
        use sha2::Digest;
        let mut hasher = Sha256::new();
        hasher.update(key.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Extract the prefix from a key for display
    pub fn extract_prefix(key: &str) -> String {
        if key.len() > 16 {
            format!("{}...", &key[..16])
        } else {
            key.to_string()
        }
    }
}

/// Constant-time comparison to prevent timing attacks
/// SOC 2 CC6.1: Uses subtle crate for proper constant-time comparison
fn constant_time_compare(a: &str, b: &str) -> bool {
    // Even when lengths differ, we do constant-time work to avoid leaking length
    if a.len() != b.len() {
        // Do a dummy comparison to avoid length-based timing attacks
        let dummy = vec![0u8; a.len()];
        let _ = a.as_bytes().ct_eq(&dummy);
        return false;
    }

    a.as_bytes().ct_eq(b.as_bytes()).into()
}

#[derive(Debug, thiserror::Error)]
pub enum ApiKeyError {
    #[error("HMAC initialization failed")]
    HmacInitFailed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_and_validate() {
        let manager = ApiKeyManager::new("test-secret-key-32-chars-minimum!");

        let (key, hash, prefix) = manager.generate_key().expect("Failed to generate key");

        // Key should start with prefix
        assert!(key.starts_with(API_KEY_PREFIX));

        // Should validate successfully
        assert!(manager.validate_key(&key).expect("Validation failed"));

        // Hash should match
        assert_eq!(manager.hash_key(&key), hash);

        // Prefix should be set
        assert!(prefix.starts_with(API_KEY_PREFIX));
        assert!(prefix.ends_with("..."));
    }

    #[test]
    fn test_invalid_key() {
        let manager = ApiKeyManager::new("test-secret-key-32-chars-minimum!");

        // Invalid prefix
        assert!(!manager.validate_key("invalid_key").expect("Validation failed"));

        // Modified key
        let (key, _, _) = manager.generate_key().expect("Failed to generate key");
        let modified_key = format!("{}x", &key[..key.len() - 1]);
        assert!(!manager.validate_key(&modified_key).expect("Validation failed"));
    }
}
