//! Email verification and password reset tokens
//!
//! Provides secure token generation, validation, and database management
//! for email verification and password reset flows.

use sha2::{Digest, Sha256};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

/// Token type for verification flows
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenType {
    EmailVerification,
    PasswordReset,
}

impl TokenType {
    pub fn as_str(&self) -> &'static str {
        match self {
            TokenType::EmailVerification => "email_verification",
            TokenType::PasswordReset => "password_reset",
        }
    }
}

/// Token manager for email verification and password reset
pub struct TokenManager {
    pool: PgPool,
}

impl TokenManager {
    /// Create a new token manager
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Generate a secure random token
    ///
    /// Returns a 32-byte hex-encoded token (64 characters)
    fn generate_token() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let bytes: [u8; 32] = rng.gen();
        hex::encode(bytes)
    }

    /// Hash a token using SHA-256
    fn hash_token(token: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Create a new verification token
    ///
    /// Returns the raw token (to send to user) and stores the hashed version
    pub async fn create_token(
        &self,
        user_id: Uuid,
        token_type: TokenType,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<String, sqlx::Error> {
        // Generate random token
        let raw_token = Self::generate_token();
        let token_hash = Self::hash_token(&raw_token);

        // Tokens expire in 24 hours
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(24);

        // Store hashed token in database
        sqlx::query(
            r#"
            INSERT INTO verification_tokens (user_id, token_hash, token_type, expires_at, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(user_id)
        .bind(&token_hash)
        .bind(token_type.as_str())
        .bind(expires_at)
        .bind(ip_address)
        .bind(user_agent)
        .execute(&self.pool)
        .await?;

        tracing::info!(
            user_id = %user_id,
            token_type = %token_type.as_str(),
            expires_at = %expires_at,
            "Verification token created"
        );

        Ok(raw_token)
    }

    /// Validate and consume a token
    ///
    /// Returns the user_id if token is valid, marks token as used
    pub async fn validate_and_consume_token(
        &self,
        raw_token: &str,
        token_type: TokenType,
    ) -> Result<Uuid, TokenError> {
        let token_hash = Self::hash_token(raw_token);

        // Fetch token from database
        let record = sqlx::query_as::<_, TokenRecord>(
            r#"
            SELECT id, user_id, expires_at, used_at, created_at
            FROM verification_tokens
            WHERE token_hash = $1 AND token_type = $2
            "#,
        )
        .bind(&token_hash)
        .bind(token_type.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| TokenError::DatabaseError)?;

        let record = record.ok_or(TokenError::InvalidToken)?;

        // Check if token already used
        if record.used_at.is_some() {
            tracing::warn!(
                token_id = %record.id,
                user_id = %record.user_id,
                "Attempted to reuse token"
            );
            return Err(TokenError::AlreadyUsed);
        }

        // Check if token expired
        if OffsetDateTime::now_utc() > record.expires_at {
            tracing::warn!(
                token_id = %record.id,
                user_id = %record.user_id,
                expires_at = %record.expires_at,
                "Attempted to use expired token"
            );
            return Err(TokenError::Expired);
        }

        // Mark token as used
        sqlx::query(
            r#"
            UPDATE verification_tokens
            SET used_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(record.id)
        .execute(&self.pool)
        .await
        .map_err(|_| TokenError::DatabaseError)?;

        tracing::info!(
            token_id = %record.id,
            user_id = %record.user_id,
            token_type = %token_type.as_str(),
            "Token validated and consumed"
        );

        Ok(record.user_id)
    }

    /// Invalidate all tokens for a user of a specific type
    ///
    /// Useful when user changes email or password
    pub async fn invalidate_user_tokens(
        &self,
        user_id: Uuid,
        token_type: TokenType,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE verification_tokens
            SET used_at = NOW()
            WHERE user_id = $1 AND token_type = $2 AND used_at IS NULL
            "#,
        )
        .bind(user_id)
        .bind(token_type.as_str())
        .execute(&self.pool)
        .await?;

        tracing::info!(
            user_id = %user_id,
            token_type = %token_type.as_str(),
            "User tokens invalidated"
        );

        Ok(())
    }

    /// Cleanup expired tokens (run periodically via background job)
    pub async fn cleanup_expired_tokens(&self) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            DELETE FROM verification_tokens
            WHERE expires_at < NOW() AND used_at IS NULL
            "#,
        )
        .execute(&self.pool)
        .await?;

        let deleted = result.rows_affected();
        if deleted > 0 {
            tracing::info!(count = deleted, "Cleaned up expired tokens");
        }

        Ok(deleted)
    }
}

/// Token validation errors
#[derive(Debug, thiserror::Error)]
pub enum TokenError {
    #[error("Invalid or unknown token")]
    InvalidToken,
    #[error("Token has already been used")]
    AlreadyUsed,
    #[error("Token has expired")]
    Expired,
    #[error("Database error")]
    DatabaseError,
}

/// Token database record
#[derive(sqlx::FromRow)]
#[allow(dead_code)] // Fields populated from DB via FromRow
struct TokenRecord {
    id: Uuid,
    user_id: Uuid,
    expires_at: OffsetDateTime,
    used_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_generation() {
        let token1 = TokenManager::generate_token();
        let token2 = TokenManager::generate_token();

        // Tokens should be 64 characters (32 bytes hex-encoded)
        assert_eq!(token1.len(), 64);
        assert_eq!(token2.len(), 64);

        // Tokens should be unique
        assert_ne!(token1, token2);

        // Tokens should only contain hex characters
        assert!(token1.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(token2.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_token_hashing() {
        let token = "test_token_12345";
        let hash1 = TokenManager::hash_token(token);
        let hash2 = TokenManager::hash_token(token);

        // Same token should produce same hash
        assert_eq!(hash1, hash2);

        // Hash should be 64 characters (SHA-256 hex-encoded)
        assert_eq!(hash1.len(), 64);

        // Different token should produce different hash
        let different_token = "different_token";
        let hash3 = TokenManager::hash_token(different_token);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_token_type_as_str() {
        assert_eq!(TokenType::EmailVerification.as_str(), "email_verification");
        assert_eq!(TokenType::PasswordReset.as_str(), "password_reset");
    }
}
