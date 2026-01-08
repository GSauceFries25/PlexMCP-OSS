//! Shared types and utilities for admin routes
//!
//! This module contains common types, helper functions, and utilities
//! used across multiple admin sub-modules.

use uuid::Uuid;

/// Log comprehensive database error details for debugging
///
/// This helper provides detailed error logging for database operations,
/// including constraint violations, table names, and error codes.
pub fn log_db_err(req_id: Uuid, step: &'static str, e: &sqlx::Error) {
    if let Some(db) = e.as_database_error() {
        tracing::error!(
            %req_id,
            step,
            code = ?db.code(),
            message = db.message(),
            table = ?db.table(),
            constraint = ?db.constraint(),
            full_error = ?e,
            "Database query failed"
        );
    } else {
        tracing::error!(%req_id, step, error = ?e, "Non-database SQLx error");
    }
}

// NOTE: Additional shared types from admin_legacy.rs will be migrated here
// during future refactoring phases. This includes:
// - ListUsersQuery
// - AdminUserListResponse
// - AdminUserSummary
// - AdminUserDetailResponse
// - UsageSummary
// - UserSecurityInfo
// - And ~50+ other request/response types
//
// These types should be extracted systematically to avoid breaking changes.
