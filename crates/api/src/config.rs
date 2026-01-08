//! Application configuration

use std::env;

/// Application configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    // Server
    pub bind_address: String,
    pub public_url: String,
    pub base_domain: String, // e.g., "plexmcp.com" for *.plexmcp.com routing

    // Database
    pub database_url: String,
    pub database_direct_url: Option<String>,
    pub database_max_connections: u32,

    // Redis
    pub redis_url: String,

    // Authentication
    pub jwt_secret: String,
    pub supabase_jwt_secret: String,
    pub supabase_url: String,
    pub supabase_anon_key: String,
    pub supabase_service_role_key: String,
    pub jwt_expiry_hours: i64,
    pub api_key_hmac_secret: String,
    pub totp_encryption_key: String, // 32-byte hex key for 2FA secret encryption

    // Stripe
    pub stripe_secret_key: String,
    pub stripe_webhook_secret: String,
    pub stripe_price_free: String,
    pub stripe_price_pro: String,
    pub stripe_price_team: String,
    pub stripe_price_enterprise: String,

    // Email
    pub resend_api_key: String,
    pub resend_webhook_secret: String,
    pub email_from: String,

    // Feature flags
    pub enable_signup: bool,
    pub enable_billing: bool,
    pub enable_email_routing: bool,

    // MCP
    pub mcp_request_timeout_ms: u64,
    pub mcp_max_connections_per_org: u32,
    pub mcp_max_request_body_bytes: usize,
    pub mcp_partial_timeout_ms: u64,

    // Fly.io (for custom domain SSL provisioning)
    pub fly_api_token: Option<String>,
    pub fly_app_name: Option<String>,

    // MaxMind GeoIP
    pub maxmind_license_key: String,
}

impl Config {
    /// Load configuration from environment variables
    pub fn from_env() -> Result<Self, ConfigError> {
        Ok(Self {
            // Server
            bind_address: env::var("BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:3000".to_string()),
            public_url: env::var("PUBLIC_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            base_domain: env::var("BASE_DOMAIN").unwrap_or_else(|_| "localhost".to_string()),

            // Database
            database_url: env::var("DATABASE_URL")
                .map_err(|_| ConfigError::Missing("DATABASE_URL"))?,
            database_direct_url: env::var("DATABASE_DIRECT_URL").ok(),
            database_max_connections: env::var("DATABASE_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "20".to_string())
                .parse()
                .unwrap_or(20),

            // Redis
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),

            // Authentication
            jwt_secret: {
                let secret =
                    env::var("JWT_SECRET").map_err(|_| ConfigError::Missing("JWT_SECRET"))?;
                // SOC 2 CC6.1: Ensure JWT signing key is cryptographically strong
                if secret.len() < 32 {
                    return Err(ConfigError::WeakSecret(
                        "JWT_SECRET must be at least 32 characters",
                    ));
                }
                secret
            },
            supabase_jwt_secret: env::var("SUPABASE_JWT_SECRET").unwrap_or_else(|_| "".to_string()),
            supabase_url: env::var("SUPABASE_URL").unwrap_or_else(|_| "".to_string()),
            supabase_anon_key: env::var("SUPABASE_ANON_KEY").unwrap_or_else(|_| "".to_string()),
            supabase_service_role_key: env::var("SUPABASE_SERVICE_ROLE_KEY")
                .unwrap_or_else(|_| "".to_string()),
            jwt_expiry_hours: env::var("JWT_EXPIRY_HOURS")
                .unwrap_or_else(|_| "24".to_string())
                .parse()
                .unwrap_or(24),
            api_key_hmac_secret: {
                let secret = env::var("API_KEY_HMAC_SECRET")
                    .map_err(|_| ConfigError::Missing("API_KEY_HMAC_SECRET"))?;
                // SOC 2 CC6.1: Ensure HMAC key is cryptographically strong
                if secret.len() < 32 {
                    return Err(ConfigError::WeakSecret(
                        "API_KEY_HMAC_SECRET must be at least 32 characters",
                    ));
                }
                secret
            },
            // 2FA encryption key - generate with: openssl rand -hex 32
            totp_encryption_key: {
                let key = env::var("TOTP_ENCRYPTION_KEY")
                    .map_err(|_| ConfigError::Missing("TOTP_ENCRYPTION_KEY"))?;

                // Validate key is 64 hex characters (32 bytes)
                if key.len() != 64 {
                    return Err(ConfigError::InvalidTotpKey(
                        "TOTP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)",
                    ));
                }

                // Reject known insecure default keys
                const INSECURE_KEYS: &[&str] = &[
                    "0000000000000000000000000000000000000000000000000000000000000000",
                    "1111111111111111111111111111111111111111111111111111111111111111",
                    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                ];

                if INSECURE_KEYS.contains(&key.as_str()) {
                    return Err(ConfigError::InsecureTotpKey(
                        "TOTP_ENCRYPTION_KEY is using a known insecure default value",
                    ));
                }

                // Validate all characters are valid hex
                if !key.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err(ConfigError::InvalidTotpKey("TOTP_ENCRYPTION_KEY must contain only hexadecimal characters (0-9, a-f, A-F)"));
                }

                key
            },

            // Stripe
            stripe_secret_key: env::var("STRIPE_SECRET_KEY").unwrap_or_default(),
            stripe_webhook_secret: env::var("STRIPE_WEBHOOK_SECRET").unwrap_or_default(),
            stripe_price_free: env::var("STRIPE_PRICE_FREE")
                .unwrap_or_else(|_| "price_free".to_string()),
            stripe_price_pro: env::var("STRIPE_PRICE_PRO")
                .unwrap_or_else(|_| "price_pro".to_string()),
            stripe_price_team: env::var("STRIPE_PRICE_TEAM")
                .unwrap_or_else(|_| "price_team".to_string()),
            stripe_price_enterprise: env::var("STRIPE_PRICE_ENTERPRISE")
                .unwrap_or_else(|_| "price_enterprise".to_string()),

            // Email
            resend_api_key: env::var("RESEND_API_KEY").unwrap_or_default(),
            resend_webhook_secret: env::var("RESEND_WEBHOOK_SECRET").unwrap_or_default(),
            email_from: env::var("EMAIL_FROM")
                .unwrap_or_else(|_| "PlexMCP <noreply@localhost>".to_string()),

            // Feature flags
            enable_signup: env::var("ENABLE_SIGNUP")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .unwrap_or(true),
            enable_billing: env::var("ENABLE_BILLING")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .unwrap_or(true),
            enable_email_routing: env::var("ENABLE_EMAIL_ROUTING")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),

            // MCP
            mcp_request_timeout_ms: env::var("MCP_REQUEST_TIMEOUT_MS")
                .unwrap_or_else(|_| "30000".to_string())
                .parse()
                .unwrap_or(30000),
            mcp_max_connections_per_org: env::var("MCP_MAX_CONNECTIONS_PER_ORG")
                .unwrap_or_else(|_| "100".to_string())
                .parse()
                .unwrap_or(100),
            mcp_max_request_body_bytes: env::var("MCP_MAX_REQUEST_BODY_BYTES")
                .unwrap_or_else(|_| "1048576".to_string()) // 1MB default
                .parse()
                .unwrap_or(1048576),
            mcp_partial_timeout_ms: env::var("MCP_PARTIAL_TIMEOUT_MS")
                .unwrap_or_else(|_| "5000".to_string()) // 5 seconds default
                .parse()
                .unwrap_or(5000),

            // Fly.io
            fly_api_token: env::var("FLY_API_TOKEN").ok(),
            fly_app_name: env::var("FLY_APP_NAME").ok(),

            // MaxMind (optional - for auto-updates)
            maxmind_license_key: env::var("MAXMIND_LICENSE_KEY").unwrap_or_default(),
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Missing required environment variable: {0}")]
    Missing(&'static str),
    #[error("Invalid TOTP encryption key: {0}")]
    InvalidTotpKey(&'static str),
    #[error("Insecure TOTP encryption key: {0}")]
    InsecureTotpKey(&'static str),
    #[error("Weak secret: {0}")]
    WeakSecret(&'static str),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::Mutex;

    // Mutex to ensure config tests run serially (they modify shared env vars)
    static CONFIG_TEST_MUTEX: Mutex<()> = Mutex::new(());

    /// Helper to set required env vars for testing
    fn setup_minimal_config() {
        env::set_var("DATABASE_URL", "postgres://test");
        // Must be at least 32 characters for SOC 2 validation
        env::set_var(
            "JWT_SECRET",
            "test-jwt-secret-must-be-at-least-32-characters-long",
        );
        env::set_var(
            "API_KEY_HMAC_SECRET",
            "test-hmac-secret-must-be-at-least-32-chars",
        );
    }

    /// Helper to clear env vars after tests
    fn cleanup_config() {
        env::remove_var("DATABASE_URL");
        env::remove_var("JWT_SECRET");
        env::remove_var("API_KEY_HMAC_SECRET");
        env::remove_var("TOTP_ENCRYPTION_KEY");
    }

    /// Combined TOTP key validation tests - runs serially to avoid env var race conditions
    #[test]
    fn test_totp_key_validation() {
        let _lock = CONFIG_TEST_MUTEX.lock().unwrap();

        // === Test 1: Missing key ===
        setup_minimal_config();
        env::remove_var("TOTP_ENCRYPTION_KEY");

        let result = Config::from_env();
        assert!(result.is_err(), "Missing TOTP key should fail");
        match result {
            Err(ConfigError::Missing("TOTP_ENCRYPTION_KEY")) => {}
            other => panic!(
                "Expected Missing error for TOTP_ENCRYPTION_KEY, got: {:?}",
                other
            ),
        }

        // === Test 2: All-zeros key rejected (insecure) ===
        env::set_var(
            "TOTP_ENCRYPTION_KEY",
            "0000000000000000000000000000000000000000000000000000000000000000",
        );
        let result = Config::from_env();
        assert!(result.is_err(), "All-zeros key should be rejected");
        assert!(
            matches!(result, Err(ConfigError::InsecureTotpKey(_))),
            "All-zeros should return InsecureTotpKey error"
        );

        // === Test 3: All-ones key rejected (insecure) ===
        env::set_var(
            "TOTP_ENCRYPTION_KEY",
            "1111111111111111111111111111111111111111111111111111111111111111",
        );
        let result = Config::from_env();
        assert!(result.is_err(), "All-ones key should be rejected");
        assert!(
            matches!(result, Err(ConfigError::InsecureTotpKey(_))),
            "All-ones should return InsecureTotpKey error"
        );

        // === Test 4: All-F's key rejected (insecure) ===
        env::set_var(
            "TOTP_ENCRYPTION_KEY",
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        );
        let result = Config::from_env();
        assert!(result.is_err(), "All-F's key should be rejected");
        assert!(
            matches!(result, Err(ConfigError::InsecureTotpKey(_))),
            "All-F's should return InsecureTotpKey error"
        );

        // === Test 5: Too short key rejected ===
        env::set_var("TOTP_ENCRYPTION_KEY", "abc123");
        let result = Config::from_env();
        assert!(result.is_err(), "Too short key should be rejected");
        assert!(
            matches!(result, Err(ConfigError::InvalidTotpKey(_))),
            "Too short should return InvalidTotpKey error"
        );

        // === Test 6: Too long key rejected ===
        env::set_var(
            "TOTP_ENCRYPTION_KEY",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefEXTRA",
        );
        let result = Config::from_env();
        assert!(result.is_err(), "Too long key should be rejected");
        assert!(
            matches!(result, Err(ConfigError::InvalidTotpKey(_))),
            "Too long should return InvalidTotpKey error"
        );

        // === Test 7: Non-hex characters rejected ===
        env::set_var(
            "TOTP_ENCRYPTION_KEY",
            "xyz123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
        );
        let result = Config::from_env();
        assert!(result.is_err(), "Non-hex key should be rejected");
        assert!(
            matches!(result, Err(ConfigError::InvalidTotpKey(_))),
            "Non-hex should return InvalidTotpKey error"
        );

        // === Test 8: Valid key accepted ===
        env::set_var(
            "TOTP_ENCRYPTION_KEY",
            "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
        );
        let result = Config::from_env();
        assert!(result.is_ok(), "Valid key should be accepted");
        let config = result.unwrap();
        assert_eq!(
            config.totp_encryption_key,
            "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
        );

        cleanup_config();
    }
}
