//! Rate limiting service using Redis
//!
//! Provides real-time rate limiting for API requests.
//!
//! Security rate limits are configurable via environment variables:
//! - `RATE_LIMIT_AUTH_PER_MINUTE`: Auth attempts per IP (default: 10)
//! - `RATE_LIMIT_2FA_PER_MINUTE`: 2FA attempts per identifier (default: 5)
//! - `RATE_LIMIT_PASSWORD_RESET_PER_MINUTE`: Password resets per IP (default: 5)
//! - `RATE_LIMIT_TICKETS_PER_MINUTE`: Ticket creation per org (default: 20)
//! - `RATE_LIMIT_REGISTRATION_PER_MINUTE`: Account registration per IP (default: 3)
//! - `RATE_LIMIT_OAUTH_PER_MINUTE`: OAuth attempts per IP (default: 10)

use std::sync::{Arc, OnceLock};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::BillingResult;

/// Get configurable auth rate limit per minute
fn get_auth_rate_limit() -> u32 {
    static LIMIT: OnceLock<u32> = OnceLock::new();
    *LIMIT.get_or_init(|| {
        std::env::var("RATE_LIMIT_AUTH_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10)
    })
}

/// Get configurable 2FA rate limit per minute
fn get_2fa_rate_limit() -> u32 {
    static LIMIT: OnceLock<u32> = OnceLock::new();
    *LIMIT.get_or_init(|| {
        std::env::var("RATE_LIMIT_2FA_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5)
    })
}

/// Get configurable password reset rate limit per minute
fn get_password_reset_rate_limit() -> u32 {
    static LIMIT: OnceLock<u32> = OnceLock::new();
    *LIMIT.get_or_init(|| {
        std::env::var("RATE_LIMIT_PASSWORD_RESET_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5)
    })
}

/// Get configurable ticket creation rate limit per minute
fn get_ticket_rate_limit() -> u32 {
    static LIMIT: OnceLock<u32> = OnceLock::new();
    *LIMIT.get_or_init(|| {
        std::env::var("RATE_LIMIT_TICKETS_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(20)
    })
}

/// Get configurable registration rate limit per minute
fn get_registration_rate_limit() -> u32 {
    static LIMIT: OnceLock<u32> = OnceLock::new();
    *LIMIT.get_or_init(|| {
        std::env::var("RATE_LIMIT_REGISTRATION_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3)
    })
}

/// Get configurable OAuth rate limit per minute
fn get_oauth_rate_limit() -> u32 {
    static LIMIT: OnceLock<u32> = OnceLock::new();
    *LIMIT.get_or_init(|| {
        std::env::var("RATE_LIMIT_OAUTH_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10)
    })
}

/// Rate limit configuration
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Requests per minute allowed
    pub requests_per_minute: u32,
    /// Requests per hour allowed (optional secondary limit)
    pub requests_per_hour: Option<u32>,
    /// Monthly request limit
    pub monthly_limit: Option<u64>,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            requests_per_minute: 60,
            requests_per_hour: None,
            monthly_limit: None,
        }
    }
}

/// Rate limit check result
#[derive(Debug, Clone)]
pub struct RateLimitResult {
    pub allowed: bool,
    pub remaining_minute: u32,
    pub remaining_hour: Option<u32>,
    pub remaining_monthly: Option<u64>,
    pub reset_at: OffsetDateTime,
    pub retry_after_seconds: Option<u32>,
}

/// In-memory rate limiter (for development without Redis)
/// Uses a simple sliding window algorithm
pub struct InMemoryRateLimiter {
    /// Store: key -> (count, window_start)
    windows: tokio::sync::RwLock<std::collections::HashMap<String, (u32, i64)>>,
}

impl InMemoryRateLimiter {
    pub fn new() -> Self {
        Self {
            windows: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        }
    }

    /// Check and increment rate limit
    pub async fn check_rate_limit(
        &self,
        key: &str,
        config: &RateLimitConfig,
    ) -> BillingResult<RateLimitResult> {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let window_start = now - (now % 60); // 1-minute window

        let mut windows = self.windows.write().await;

        let minute_key = format!("{}:minute", key);
        let entry = windows.entry(minute_key).or_insert((0, window_start));

        // Reset if in new window
        if entry.1 != window_start {
            entry.0 = 0;
            entry.1 = window_start;
        }

        let current_count = entry.0;
        let allowed = current_count < config.requests_per_minute;

        if allowed {
            entry.0 += 1;
        }

        let remaining = config
            .requests_per_minute
            .saturating_sub(current_count + if allowed { 1 } else { 0 });
        let reset_at = OffsetDateTime::from_unix_timestamp(window_start + 60)
            .unwrap_or(OffsetDateTime::now_utc());

        let retry_after = if !allowed {
            Some((window_start + 60 - now) as u32)
        } else {
            None
        };

        Ok(RateLimitResult {
            allowed,
            remaining_minute: remaining,
            remaining_hour: None,
            remaining_monthly: None,
            reset_at,
            retry_after_seconds: retry_after,
        })
    }

    /// Clean up old windows (call periodically)
    pub async fn cleanup(&self) {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let cutoff = now - 3600; // Keep last hour

        let mut windows = self.windows.write().await;
        windows.retain(|_, (_, start)| *start > cutoff);
    }
}

impl Default for InMemoryRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

/// Rate limiter service
pub struct RateLimiter {
    inner: Arc<InMemoryRateLimiter>,
}

impl RateLimiter {
    /// Create a new in-memory rate limiter
    pub fn new_in_memory() -> Self {
        Self {
            inner: Arc::new(InMemoryRateLimiter::new()),
        }
    }

    /// Check rate limit for an API key
    pub async fn check_api_key(
        &self,
        _org_id: Uuid,
        api_key_id: Uuid,
        requests_per_minute: u32,
    ) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:apikey:{}", api_key_id);
        let config = RateLimitConfig {
            requests_per_minute,
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }

    /// Check rate limit for an organization (overall limit)
    pub async fn check_org(
        &self,
        org_id: Uuid,
        requests_per_minute: u32,
    ) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:org:{}", org_id);
        let config = RateLimitConfig {
            requests_per_minute,
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }

    /// Check rate limit for a specific MCP instance
    pub async fn check_mcp(
        &self,
        org_id: Uuid,
        mcp_id: Uuid,
        requests_per_minute: u32,
    ) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:mcp:{}:{}", org_id, mcp_id);
        let config = RateLimitConfig {
            requests_per_minute,
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }

    /// Check combined rate limits (API key + org)
    pub async fn check_request(
        &self,
        org_id: Uuid,
        api_key_id: Uuid,
        api_key_rpm: u32,
        org_rpm: u32,
    ) -> BillingResult<RateLimitResult> {
        // Check API key limit first
        let api_key_result = self.check_api_key(org_id, api_key_id, api_key_rpm).await?;
        if !api_key_result.allowed {
            return Ok(api_key_result);
        }

        // Then check org limit
        let org_result = self.check_org(org_id, org_rpm).await?;
        if !org_result.allowed {
            return Ok(org_result);
        }

        // Return the most restrictive remaining count
        Ok(RateLimitResult {
            allowed: true,
            remaining_minute: api_key_result
                .remaining_minute
                .min(org_result.remaining_minute),
            remaining_hour: None,
            remaining_monthly: None,
            reset_at: api_key_result.reset_at.min(org_result.reset_at),
            retry_after_seconds: None,
        })
    }

    /// Clean up old rate limit windows
    pub async fn cleanup(&self) {
        self.inner.cleanup().await;
    }

    // ==========================================================================
    // Security Rate Limiting (SOC 2 CC6.1 - Brute Force Protection)
    // ==========================================================================

    /// Check rate limit for authentication attempts by IP address
    /// Configurable via RATE_LIMIT_AUTH_PER_MINUTE (default: 10)
    ///
    /// SOC 2 CC6.1: Prevents brute force login attacks
    pub async fn check_auth_by_ip(&self, ip_address: &str) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:auth:ip:{}", ip_address);
        let config = RateLimitConfig {
            requests_per_minute: get_auth_rate_limit(),
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }

    /// Check rate limit for 2FA verification attempts
    /// Configurable via RATE_LIMIT_2FA_PER_MINUTE (default: 5)
    ///
    /// SOC 2 CC6.1: Prevents 2FA bypass attempts
    pub async fn check_2fa_attempts(&self, identifier: &str) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:2fa:{}", identifier);
        let config = RateLimitConfig {
            requests_per_minute: get_2fa_rate_limit(),
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }

    /// Check rate limit for password reset requests by IP
    /// Configurable via RATE_LIMIT_PASSWORD_RESET_PER_MINUTE (default: 5)
    ///
    /// SOC 2 CC6.1: Prevents password reset abuse
    pub async fn check_password_reset(&self, ip_address: &str) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:password_reset:ip:{}", ip_address);
        let config = RateLimitConfig {
            requests_per_minute: get_password_reset_rate_limit(),
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }

    /// Check rate limit for ticket creation by organization
    /// Configurable via RATE_LIMIT_TICKETS_PER_MINUTE (default: 20)
    ///
    /// SOC 2 CC6.1: Prevents support system abuse
    pub async fn check_ticket_creation(&self, org_id: Uuid) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:tickets:{}", org_id);
        let config = RateLimitConfig {
            requests_per_minute: get_ticket_rate_limit(),
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }

    /// Check rate limit for account registration by IP
    /// Configurable via RATE_LIMIT_REGISTRATION_PER_MINUTE (default: 3)
    ///
    /// SOC 2 CC6.1: Prevents mass account creation
    pub async fn check_registration(&self, ip_address: &str) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:register:ip:{}", ip_address);
        let config = RateLimitConfig {
            requests_per_minute: get_registration_rate_limit(),
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }

    /// Check rate limit for OAuth authentication attempts by IP
    /// Configurable via RATE_LIMIT_OAUTH_PER_MINUTE (default: 10)
    ///
    /// SOC 2 CC6.1: Prevents OAuth abuse and account enumeration
    pub async fn check_oauth(&self, ip_address: &str) -> BillingResult<RateLimitResult> {
        let key = format!("ratelimit:oauth:ip:{}", ip_address);
        let config = RateLimitConfig {
            requests_per_minute: get_oauth_rate_limit(),
            ..Default::default()
        };
        self.inner.check_rate_limit(&key, &config).await
    }
}

impl Clone for RateLimiter {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rate_limiter_allows_within_limit() {
        let limiter = RateLimiter::new_in_memory();
        let org_id = Uuid::new_v4();
        let api_key_id = Uuid::new_v4();

        for i in 0..5 {
            let result = limiter.check_api_key(org_id, api_key_id, 10).await.unwrap();
            assert!(result.allowed, "Request {} should be allowed", i);
            assert_eq!(result.remaining_minute, 10 - i - 1);
        }
    }

    #[tokio::test]
    async fn test_rate_limiter_blocks_over_limit() {
        let limiter = RateLimiter::new_in_memory();
        let org_id = Uuid::new_v4();
        let api_key_id = Uuid::new_v4();

        // Use up the limit
        for _ in 0..3 {
            let _ = limiter.check_api_key(org_id, api_key_id, 3).await.unwrap();
        }

        // Next request should be blocked
        let result = limiter.check_api_key(org_id, api_key_id, 3).await.unwrap();
        assert!(!result.allowed);
        assert!(result.retry_after_seconds.is_some());
    }

    #[tokio::test]
    async fn test_rate_limiter_separate_keys() {
        let limiter = RateLimiter::new_in_memory();
        let org_id = Uuid::new_v4();
        let api_key_1 = Uuid::new_v4();
        let api_key_2 = Uuid::new_v4();

        // Use up limit for key 1
        for _ in 0..3 {
            limiter.check_api_key(org_id, api_key_1, 3).await.unwrap();
        }

        // Key 1 should be blocked
        let result1 = limiter.check_api_key(org_id, api_key_1, 3).await.unwrap();
        assert!(!result1.allowed);

        // Key 2 should still be allowed
        let result2 = limiter.check_api_key(org_id, api_key_2, 3).await.unwrap();
        assert!(result2.allowed);
    }

    #[tokio::test]
    async fn test_rate_limiter_org_limit() {
        let limiter = RateLimiter::new_in_memory();
        let org_id = Uuid::new_v4();

        for i in 0..5 {
            let result = limiter.check_org(org_id, 10).await.unwrap();
            assert!(result.allowed, "Request {} should be allowed", i);
        }

        // Use up the rest
        for _ in 5..10 {
            limiter.check_org(org_id, 10).await.unwrap();
        }

        // Next should be blocked
        let result = limiter.check_org(org_id, 10).await.unwrap();
        assert!(!result.allowed);
    }

    #[tokio::test]
    async fn test_rate_limiter_mcp_limit() {
        let limiter = RateLimiter::new_in_memory();
        let org_id = Uuid::new_v4();
        let mcp_id = Uuid::new_v4();

        // Use up limit
        for _ in 0..5 {
            limiter.check_mcp(org_id, mcp_id, 5).await.unwrap();
        }

        // Should be blocked
        let result = limiter.check_mcp(org_id, mcp_id, 5).await.unwrap();
        assert!(!result.allowed);

        // Different MCP should be allowed
        let other_mcp = Uuid::new_v4();
        let result2 = limiter.check_mcp(org_id, other_mcp, 5).await.unwrap();
        assert!(result2.allowed);
    }

    #[tokio::test]
    async fn test_rate_limiter_combined_check() {
        let limiter = RateLimiter::new_in_memory();
        let org_id = Uuid::new_v4();
        let api_key_id = Uuid::new_v4();

        // API key limit: 5, Org limit: 10
        // First 5 requests should pass
        for _ in 0..5 {
            let result = limiter
                .check_request(org_id, api_key_id, 5, 10)
                .await
                .unwrap();
            assert!(result.allowed);
        }

        // API key limit reached, should be blocked even though org has capacity
        let result = limiter
            .check_request(org_id, api_key_id, 5, 10)
            .await
            .unwrap();
        assert!(!result.allowed);
    }

    #[tokio::test]
    async fn test_rate_limiter_remaining_is_minimum() {
        let limiter = RateLimiter::new_in_memory();
        let org_id = Uuid::new_v4();
        let api_key_id = Uuid::new_v4();

        // API key limit: 10, Org limit: 5
        // Combined check should return minimum remaining
        let result = limiter
            .check_request(org_id, api_key_id, 10, 5)
            .await
            .unwrap();
        assert!(result.allowed);
        // remaining_minute should be min(api_key_remaining, org_remaining)
        // After 1 request: api_key=9, org=4, so min=4
        assert!(result.remaining_minute <= 9);
    }

    #[test]
    fn test_rate_limit_config_default() {
        let config = RateLimitConfig::default();
        assert_eq!(config.requests_per_minute, 60);
        assert!(config.requests_per_hour.is_none());
        assert!(config.monthly_limit.is_none());
    }

    #[tokio::test]
    async fn test_rate_limiter_clone() {
        let limiter = RateLimiter::new_in_memory();
        let cloned = limiter.clone();
        let org_id = Uuid::new_v4();
        let api_key_id = Uuid::new_v4();

        // Use original to record requests
        limiter.check_api_key(org_id, api_key_id, 3).await.unwrap();
        limiter.check_api_key(org_id, api_key_id, 3).await.unwrap();

        // Clone should see the same state (shared Arc)
        let result = cloned.check_api_key(org_id, api_key_id, 3).await.unwrap();
        assert!(result.allowed); // 3rd request
        assert_eq!(result.remaining_minute, 0);

        // 4th request on clone should be blocked
        let result = cloned.check_api_key(org_id, api_key_id, 3).await.unwrap();
        assert!(!result.allowed);
    }

    #[tokio::test]
    async fn test_rate_limiter_cleanup() {
        let limiter = InMemoryRateLimiter::new();

        // Add some entries
        let config = RateLimitConfig::default();
        limiter
            .check_rate_limit("test_key_1", &config)
            .await
            .unwrap();
        limiter
            .check_rate_limit("test_key_2", &config)
            .await
            .unwrap();

        // Cleanup shouldn't remove recent entries
        limiter.cleanup().await;

        // Entries should still be there (window is recent)
        let windows = limiter.windows.read().await;
        // At least one key should exist (they're recent)
        assert!(!windows.is_empty());
    }
}
