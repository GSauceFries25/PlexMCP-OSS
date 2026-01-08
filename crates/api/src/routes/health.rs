//! Health check endpoints

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub database: String,
}

/// Health check endpoint
pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    // Check database connectivity
    let db_status = match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => "healthy".to_string(),
        Err(_) => "unhealthy".to_string(),
    };

    let overall_status = if db_status == "healthy" {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        overall_status,
        Json(HealthResponse {
            status: if overall_status == StatusCode::OK {
                "healthy".to_string()
            } else {
                "unhealthy".to_string()
            },
            version: env!("CARGO_PKG_VERSION").to_string(),
            database: db_status,
        }),
    )
}

/// Liveness probe (just returns 200 if the server is running)
pub async fn liveness() -> StatusCode {
    StatusCode::OK
}

/// Readiness probe (checks if the service is ready to accept traffic)
pub async fn readiness(State(state): State<AppState>) -> StatusCode {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => StatusCode::OK,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
