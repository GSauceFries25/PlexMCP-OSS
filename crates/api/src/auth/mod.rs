//! Authentication module for PlexMCP

pub mod api_key;
pub mod jwt;
pub mod middleware;
#[cfg(test)]
mod middleware_tests;
#[cfg(test)]
mod edge_case_tests;
pub mod password;
pub mod sessions;
pub mod tokens;
pub mod totp;

pub use api_key::ApiKeyManager;
pub use jwt::{Claims, JwtManager, TokenType};
pub use middleware::{require_auth, optional_auth, require_billing_active, require_auth_with_billing, require_active_member, require_full_access, AuthState, AuthUser, AuthMethod, TokenCache};
pub(crate) use middleware::InFlightRequests;
pub use password::{hash_password, verify_password, validate_password_strength, generate_impossible_hash};
pub use tokens::{TokenManager, TokenType as VerificationTokenType, TokenError};
pub use totp::TotpError;
