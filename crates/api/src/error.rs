//! API error types and handling

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Application error type
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    // Authentication errors
    #[error("Invalid credentials")]
    InvalidCredentials,
    #[error("Invalid verification code")]
    Invalid2FACode,
    #[error("Email already registered")]
    EmailAlreadyExists,
    #[error("Invalid or expired token")]
    InvalidToken,
    #[error("Authentication required")]
    Unauthorized,
    #[error("Insufficient permissions")]
    Forbidden,

    // Validation errors
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Invalid request: {0}")]
    BadRequest(String),

    // Resource errors
    #[error("Resource not found")]
    NotFound,
    #[error("Resource already exists")]
    Conflict(String),
    #[error("No organization found")]
    NoOrganization,

    // Rate limiting
    #[error("Too many requests")]
    RateLimited,
    #[error("Too many requests: {0}")]
    TooManyRequests(String),

    // Billing errors
    #[error("Subscription required")]
    SubscriptionRequired,
    #[error("Usage limit exceeded")]
    UsageLimitExceeded,
    #[error("Payment required")]
    PaymentRequired,
    #[error("Quota exceeded: {0}")]
    QuotaExceeded(String),

    // Internal errors
    #[error("Database error: {0}")]
    Database(String),
    #[error("Internal server error")]
    Internal,
    #[error("Service unavailable")]
    ServiceUnavailable,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            // Authentication
            ApiError::InvalidCredentials => (StatusCode::UNAUTHORIZED, "INVALID_CREDENTIALS", self.to_string()),
            ApiError::Invalid2FACode => (StatusCode::UNAUTHORIZED, "INVALID_2FA_CODE", "Invalid verification code. Please check your authenticator app and try again.".to_string()),
            ApiError::EmailAlreadyExists => (StatusCode::CONFLICT, "EMAIL_EXISTS", self.to_string()),
            ApiError::InvalidToken => (StatusCode::UNAUTHORIZED, "INVALID_TOKEN", self.to_string()),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", self.to_string()),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, "FORBIDDEN", self.to_string()),

            // Validation
            ApiError::Validation(msg) => (StatusCode::BAD_REQUEST, "VALIDATION_ERROR", msg.clone()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", msg.clone()),

            // Resources
            ApiError::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND", self.to_string()),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.clone()),
            ApiError::NoOrganization => (StatusCode::BAD_REQUEST, "NO_ORGANIZATION", "No organization found. Please create an organization first.".to_string()),

            // Rate limiting
            ApiError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", self.to_string()),
            ApiError::TooManyRequests(msg) => (StatusCode::TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS", msg.clone()),

            // Billing
            ApiError::SubscriptionRequired => (StatusCode::PAYMENT_REQUIRED, "SUBSCRIPTION_REQUIRED", self.to_string()),
            ApiError::UsageLimitExceeded => (StatusCode::PAYMENT_REQUIRED, "USAGE_LIMIT_EXCEEDED", self.to_string()),
            ApiError::PaymentRequired => (StatusCode::PAYMENT_REQUIRED, "PAYMENT_REQUIRED", self.to_string()),
            ApiError::QuotaExceeded(msg) => (StatusCode::PAYMENT_REQUIRED, "QUOTA_EXCEEDED", msg.clone()),

            // Internal
            ApiError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Database error".to_string()),
            ApiError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", self.to_string()),
            ApiError::ServiceUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", self.to_string()),
        };

        let body = Json(json!({
            "error": {
                "code": code,
                "message": message,
            }
        }));

        (status, body).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!("Database error: {:?}", err);
        match err {
            sqlx::Error::RowNotFound => ApiError::NotFound,
            sqlx::Error::Database(db_err) => {
                if let Some(code) = db_err.code() {
                    // PostgreSQL unique violation
                    if code == "23505" {
                        return ApiError::Conflict("Resource already exists".to_string());
                    }
                }
                ApiError::Database(db_err.to_string())
            }
            _ => ApiError::Database(err.to_string()),
        }
    }
}

/// Result type alias for API handlers
pub type ApiResult<T> = Result<T, ApiError>;
