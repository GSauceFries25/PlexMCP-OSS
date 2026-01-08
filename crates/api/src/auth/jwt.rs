//! JWT token generation and validation

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

/// JWT claims structure for PlexMCP-issued tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user ID)
    pub sub: Uuid,
    /// Organization ID
    pub org_id: Uuid,
    /// User role
    pub role: String,
    /// Email
    pub email: String,
    /// Issued at
    pub iat: i64,
    /// Expiration
    pub exp: i64,
    /// Token type (access or refresh)
    pub token_type: TokenType,
    /// JWT ID (jti) for session tracking and revocation
    pub jti: String,
}

/// JWT claims structure for Supabase-issued tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupabaseClaims {
    /// Subject (user ID as string, will be parsed to UUID)
    pub sub: String,
    /// Email (may be in top-level or in user_metadata)
    pub email: Option<String>,
    /// Role (authenticated, anon, etc.)
    pub role: Option<String>,
    /// Audience
    pub aud: Option<String>,
    /// Issued at
    pub iat: Option<i64>,
    /// Expiration
    pub exp: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenType {
    Access,
    Refresh,
}

/// JWT manager for token operations
#[derive(Clone)]
pub struct JwtManager {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    supabase_decoding_key: Option<DecodingKey>,
    access_token_expiry_hours: i64,
    refresh_token_expiry_days: i64,
}

impl JwtManager {
    /// Create a new JWT manager
    pub fn new(secret: &str, access_token_expiry_hours: i64) -> Self {
        Self {
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            supabase_decoding_key: None,
            access_token_expiry_hours,
            refresh_token_expiry_days: 30, // Refresh tokens last 30 days
        }
    }

    /// Create a new JWT manager with Supabase JWT secret
    pub fn with_supabase_secret(
        secret: &str,
        supabase_secret: &str,
        access_token_expiry_hours: i64,
    ) -> Self {
        Self {
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            supabase_decoding_key: if supabase_secret.is_empty() {
                None
            } else {
                Some(DecodingKey::from_secret(supabase_secret.as_bytes()))
            },
            access_token_expiry_hours,
            refresh_token_expiry_days: 30,
        }
    }

    /// Generate an access token with unique JTI for session tracking
    pub fn generate_access_token(
        &self,
        user_id: Uuid,
        org_id: Uuid,
        role: &str,
        email: &str,
    ) -> Result<(String, String), JwtError> {
        let now = OffsetDateTime::now_utc();
        let exp = now + Duration::hours(self.access_token_expiry_hours);
        let jti = Uuid::new_v4().to_string(); // Unique token ID for revocation

        let claims = Claims {
            sub: user_id,
            org_id,
            role: role.to_string(),
            email: email.to_string(),
            iat: now.unix_timestamp(),
            exp: exp.unix_timestamp(),
            token_type: TokenType::Access,
            jti: jti.clone(),
        };

        // SOC 2 CC6.1: Explicit algorithm prevents algorithm confusion attacks
        let token = encode(&Header::new(Algorithm::HS256), &claims, &self.encoding_key)
            .map_err(|e| JwtError::Encoding(e.to_string()))?;

        Ok((token, jti))
    }

    /// Generate a refresh token with unique JTI for session tracking
    pub fn generate_refresh_token(
        &self,
        user_id: Uuid,
        org_id: Uuid,
        role: &str,
        email: &str,
    ) -> Result<(String, String), JwtError> {
        let now = OffsetDateTime::now_utc();
        let exp = now + Duration::days(self.refresh_token_expiry_days);
        let jti = Uuid::new_v4().to_string(); // Unique token ID for revocation

        let claims = Claims {
            sub: user_id,
            org_id,
            role: role.to_string(),
            email: email.to_string(),
            iat: now.unix_timestamp(),
            exp: exp.unix_timestamp(),
            token_type: TokenType::Refresh,
            jti: jti.clone(),
        };

        // SOC 2 CC6.1: Explicit algorithm prevents algorithm confusion attacks
        let token = encode(&Header::new(Algorithm::HS256), &claims, &self.encoding_key)
            .map_err(|e| JwtError::Encoding(e.to_string()))?;

        Ok((token, jti))
    }

    /// Generate both access and refresh tokens with JTIs for session tracking
    /// Returns: (access_token, access_jti, refresh_token, refresh_jti)
    pub fn generate_token_pair(
        &self,
        user_id: Uuid,
        org_id: Uuid,
        role: &str,
        email: &str,
    ) -> Result<(String, String, String, String), JwtError> {
        let (access_token, access_jti) =
            self.generate_access_token(user_id, org_id, role, email)?;
        let (refresh_token, refresh_jti) =
            self.generate_refresh_token(user_id, org_id, role, email)?;
        Ok((access_token, access_jti, refresh_token, refresh_jti))
    }

    /// Validate and decode a token
    /// SOC 2 CC6.1: Explicit algorithm validation prevents algorithm confusion attacks
    pub fn validate_token(&self, token: &str) -> Result<Claims, JwtError> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.leeway = 60; // 60 second clock skew tolerance

        decode::<Claims>(token, &self.decoding_key, &validation)
            .map(|data| data.claims)
            .map_err(|e| match e.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => JwtError::Expired,
                jsonwebtoken::errors::ErrorKind::InvalidToken => JwtError::Invalid,
                jsonwebtoken::errors::ErrorKind::InvalidAlgorithm => JwtError::Invalid,
                _ => JwtError::Validation(e.to_string()),
            })
    }

    /// Validate an access token specifically
    pub fn validate_access_token(&self, token: &str) -> Result<Claims, JwtError> {
        let claims = self.validate_token(token)?;
        if claims.token_type != TokenType::Access {
            return Err(JwtError::WrongTokenType);
        }
        Ok(claims)
    }

    /// Validate a refresh token specifically
    pub fn validate_refresh_token(&self, token: &str) -> Result<Claims, JwtError> {
        let claims = self.validate_token(token)?;
        if claims.token_type != TokenType::Refresh {
            return Err(JwtError::WrongTokenType);
        }
        Ok(claims)
    }

    /// Get access token expiry in seconds
    pub fn access_token_expiry_seconds(&self) -> i64 {
        self.access_token_expiry_hours * 3600
    }

    /// Validate a Supabase-issued JWT token
    /// Returns the user ID and email if valid
    /// SOC 2 CC6.1: Explicit algorithm and audience validation
    pub fn validate_supabase_token(&self, token: &str) -> Result<SupabaseClaims, JwtError> {
        let decoding_key = self
            .supabase_decoding_key
            .as_ref()
            .ok_or(JwtError::Validation(
                "Supabase JWT secret not configured".to_string(),
            ))?;

        let mut validation = Validation::new(Algorithm::HS256);
        validation.leeway = 60; // 60 second clock skew tolerance
                                // Supabase uses "authenticated" as the audience
        validation.set_audience(&["authenticated"]);

        match decode::<SupabaseClaims>(token, decoding_key, &validation) {
            Ok(data) => Ok(data.claims),
            Err(e) => match e.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => Err(JwtError::Expired),
                jsonwebtoken::errors::ErrorKind::InvalidToken => Err(JwtError::Invalid),
                jsonwebtoken::errors::ErrorKind::InvalidAlgorithm => Err(JwtError::Invalid),
                jsonwebtoken::errors::ErrorKind::InvalidAudience => {
                    // SOC 2 CC6.1: Reject tokens with invalid audience - no fallback
                    tracing::warn!("Supabase JWT audience validation failed - rejecting token");
                    Err(JwtError::Invalid)
                }
                _ => Err(JwtError::Validation(e.to_string())),
            },
        }
    }

    /// Check if Supabase JWT validation is available
    pub fn has_supabase_support(&self) -> bool {
        self.supabase_decoding_key.is_some()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum JwtError {
    #[error("Token has expired")]
    Expired,
    #[error("Invalid token")]
    Invalid,
    #[error("Wrong token type")]
    WrongTokenType,
    #[error("Token encoding failed: {0}")]
    Encoding(String),
    #[error("Token validation failed: {0}")]
    Validation(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_generation_and_validation() {
        let jwt = JwtManager::new("test-secret-key-at-least-32-chars!", 24);
        let user_id = Uuid::new_v4();
        let org_id = Uuid::new_v4();

        let (access_token, access_jti, refresh_token, refresh_jti) = jwt
            .generate_token_pair(user_id, org_id, "owner", "test@example.com")
            .expect("Failed to generate tokens");

        // Validate access token
        let access_claims = jwt
            .validate_access_token(&access_token)
            .expect("Invalid access token");
        assert_eq!(access_claims.sub, user_id);
        assert_eq!(access_claims.org_id, org_id);
        assert_eq!(access_claims.token_type, TokenType::Access);
        assert_eq!(access_claims.jti, access_jti);
        assert!(!access_claims.jti.is_empty());

        // Validate refresh token
        let refresh_claims = jwt
            .validate_refresh_token(&refresh_token)
            .expect("Invalid refresh token");
        assert_eq!(refresh_claims.sub, user_id);
        assert_eq!(refresh_claims.token_type, TokenType::Refresh);
        assert_eq!(refresh_claims.jti, refresh_jti);
        assert!(!refresh_claims.jti.is_empty());

        // Ensure JTIs are different
        assert_ne!(access_jti, refresh_jti);
    }

    #[test]
    fn test_wrong_token_type() {
        let jwt = JwtManager::new("test-secret-key-at-least-32-chars!", 24);
        let user_id = Uuid::new_v4();
        let org_id = Uuid::new_v4();

        let (access_token, _jti) = jwt
            .generate_access_token(user_id, org_id, "owner", "test@example.com")
            .expect("Failed to generate token");

        // Using access token as refresh should fail
        let result = jwt.validate_refresh_token(&access_token);
        assert!(matches!(result, Err(JwtError::WrongTokenType)));
    }
}
