//! Platform Admin routes - Modularized structure
//!
//! This module organizes admin functionality into logical sub-modules:
//! - `users`: User listing, retrieval, updates, usage management
//! - `user_actions`: Security actions (suspend, force password reset, revoke sessions, 2FA)
//! - `billing`: Billing testing endpoints (inject usage, spend caps, overage testing)
//! - `limits`: Enterprise custom limits management
//! - `mcp_logs`: MCP proxy request logs
//! - `staff_emails`: Staff email assignment
//! - `organizations`: Organization listing and management
//! - `shared`: Shared types, helpers, and utilities

// Sub-modules
pub mod shared;

// Re-export main router
pub use super::admin_legacy::*;

// NOTE: This is Phase 1 of the admin.rs refactoring.
// The original admin.rs has been renamed to admin_legacy.rs to maintain backward compatibility.
// Future phases will progressively extract functionality into the sub-modules above.
//
// Migration strategy:
// 1. Extract shared types and helpers to admin/shared.rs
// 2. Extract user management routes to admin/users.rs
// 3. Extract user action routes to admin/user_actions.rs
// 4. Extract billing routes to admin/billing.rs
// 5. Extract limits routes to admin/limits.rs
// 6. Extract MCP logs routes to admin/mcp_logs.rs
// 7. Extract staff email routes to admin/staff_emails.rs
// 8. Extract organization routes to admin/organizations.rs
// 9. Update router registration in main app
// 10. Delete admin_legacy.rs
