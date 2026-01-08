//! Error types for PlexMCP

use thiserror::Error;

#[derive(Debug, Error)]
pub enum PlexError {
    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Rate limit exceeded")]
    RateLimited,

    #[error("Billing error: {0}")]
    Billing(String),

    #[error("Internal error: {0}")]
    Internal(String),
}
