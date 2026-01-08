//! SOC 2 compliant audit logging constants
//! Prevents magic strings and ensures consistency across the codebase
//!
//! This module provides strongly-typed constants for all audit logging operations,
//! ensuring compliance with SOC 2 Type II requirements and reducing the risk of
//! logging errors due to typos or inconsistent string values.

/// Event types for audit logging
///
/// These constants categorize audit events into logical groups for filtering
/// and analysis.
pub mod event_type {
    /// Authentication-related events (login, logout, password changes)
    pub const AUTHENTICATION: &str = "authentication";

    /// User management actions (create, update, delete, suspend users)
    pub const USER_MANAGEMENT: &str = "user_management";

    /// Data modification events (database table changes)
    pub const DATA_MODIFICATION: &str = "data_modification";

    /// Security setting changes (2FA, password policy, RLS)
    pub const SECURITY_SETTING: &str = "security_setting";

    /// General administrative actions
    pub const ADMIN_ACTION: &str = "admin_action";

    /// System configuration changes
    pub const CONFIGURATION: &str = "configuration";
}

/// Severity levels for audit events
///
/// Used to prioritize alerts and indicate the criticality of events for
/// SOC 2 compliance monitoring.
pub mod severity {
    /// Informational events (normal operations, successful logins)
    pub const INFO: &str = "info";

    /// Warning events (failed logins, configuration changes, updates)
    pub const WARNING: &str = "warning";

    /// Critical events (deletions, suspensions, security degradation, breaches)
    pub const CRITICAL: &str = "critical";
}

/// Authentication event types
///
/// Specific events related to user authentication, password management,
/// 2FA, and OAuth integrations.
pub mod auth_event {
    // Login/Logout Events
    /// Successful login attempt
    pub const LOGIN_SUCCESS: &str = "login_success";

    /// Failed login attempt (invalid password, user not found, account locked)
    pub const LOGIN_FAILED: &str = "login_failed";

    /// User initiated logout
    pub const LOGOUT: &str = "logout";

    /// User successfully logged out
    pub const LOGOUT_SUCCESS: &str = "logout_success";

    // Password Events
    /// User changed their password while authenticated
    pub const PASSWORD_CHANGED: &str = "password_changed";

    /// User requested a password reset email
    pub const PASSWORD_RESET_REQUESTED: &str = "password_reset_requested";

    /// User completed password reset via reset token
    pub const PASSWORD_RESET_COMPLETED: &str = "password_reset_completed";

    // Two-Factor Authentication Events
    /// User enabled 2FA on their account
    pub const TWO_FA_ENABLED: &str = "2fa_enabled";

    /// User disabled 2FA on their account (CRITICAL security degradation)
    pub const TWO_FA_DISABLED: &str = "2fa_disabled";

    /// User successfully verified 2FA code
    pub const TWO_FA_VERIFIED: &str = "2fa_verified";

    /// User failed to verify 2FA code (potential brute force attempt)
    pub const TWO_FA_FAILED: &str = "2fa_failed";

    // OAuth Events
    /// User initiated OAuth authentication (clicked Sign in with Google/GitHub)
    pub const OAUTH_INITIATED: &str = "oauth_initiated";

    /// OAuth callback received successfully with authorization code
    pub const OAUTH_CALLBACK_SUCCESS: &str = "oauth_callback_success";

    /// OAuth callback failed with error
    pub const OAUTH_CALLBACK_FAILED: &str = "oauth_callback_failed";

    /// User successfully logged in via OAuth provider (existing user)
    pub const OAUTH_LOGIN_SUCCESS: &str = "oauth_login_success";

    /// User successfully signed up via OAuth provider (new user)
    pub const OAUTH_SIGNUP_SUCCESS: &str = "oauth_signup_success";

    /// User logged in via OAuth provider (Google, GitHub, etc.)
    pub const OAUTH_LOGIN: &str = "oauth_login";

    /// User linked an OAuth provider to their account
    pub const OAUTH_LINKED: &str = "oauth_linked";

    /// User unlinked an OAuth provider from their account
    pub const OAUTH_UNLINKED: &str = "oauth_unlinked";

    // Session Events
    /// User session expired due to timeout
    pub const SESSION_EXPIRED: &str = "session_expired";

    /// User session established successfully
    pub const SESSION_ESTABLISHED: &str = "session_established";

    /// User's access token was refreshed
    pub const TOKEN_REFRESHED: &str = "token_refreshed";

    /// User session revoked (by user or admin)
    pub const SESSION_REVOKED: &str = "session_revoked";

    /// User account locked due to too many failed login attempts
    pub const ACCOUNT_LOCKED: &str = "account_locked";

    /// User account unlocked by administrator
    pub const ACCOUNT_UNLOCKED: &str = "account_unlocked";
}

/// Admin action types
///
/// Specific administrative actions performed by platform admins.
/// These actions are logged to the admin_audit_log table.
pub mod admin_action {
    // User Management
    /// New user created by admin
    pub const USER_CREATED: &str = "user_created";

    /// User profile or settings updated by admin
    pub const USER_UPDATED: &str = "user_updated";

    /// User permanently deleted by admin (CRITICAL)
    pub const USER_DELETED: &str = "user_deleted";

    /// User account suspended by admin (CRITICAL)
    pub const USER_SUSPENDED: &str = "user_suspended";

    /// User account suspension lifted by admin
    pub const USER_UNSUSPENDED: &str = "user_unsuspended";

    /// User's platform role changed by admin (CRITICAL)
    pub const ROLE_CHANGED: &str = "role_changed";

    /// User sessions revoked by admin (CRITICAL)
    pub const USER_SESSIONS_REVOKED: &str = "revoke_user_sessions";

    /// User forced to reset password by admin (CRITICAL)
    pub const USER_FORCE_PASSWORD_RESET: &str = "force_password_reset";

    /// User's 2FA disabled by admin (CRITICAL - security degradation)
    pub const USER_2FA_DISABLED: &str = "disable_user_2fa";

    // API Key Management
    /// New API key created for user or organization
    pub const API_KEY_CREATED: &str = "api_key_created";

    /// API key revoked by admin (CRITICAL)
    pub const API_KEY_REVOKED: &str = "api_key_revoked";

    // Organization Management
    /// New organization created
    pub const ORGANIZATION_CREATED: &str = "organization_created";

    /// Organization settings updated
    pub const ORGANIZATION_UPDATED: &str = "organization_updated";

    /// Organization deleted (CRITICAL)
    pub const ORGANIZATION_DELETED: &str = "organization_deleted";

    // Subscription Management
    /// Subscription tier changed
    pub const SUBSCRIPTION_CHANGED: &str = "subscription_changed";

    /// Subscription canceled
    pub const SUBSCRIPTION_CANCELED: &str = "subscription_canceled";

    // Billing Events (SOC 2 CC5.2)
    /// Payment failed (card declined, insufficient funds, etc.)
    pub const PAYMENT_FAILED: &str = "payment_failed";

    /// Refund issued to customer
    pub const REFUND_ISSUED: &str = "refund_issued";

    // Usage & Billing Management
    /// Organization usage count manually set by admin
    pub const USAGE_SET: &str = "set_usage";

    /// Organization usage count reset by admin
    pub const USAGE_RESET: &str = "reset_usage";

    /// Usage injected for testing purposes
    pub const USAGE_INJECTED: &str = "inject_usage";

    /// Spend cap override set for organization
    pub const SPEND_CAP_OVERRIDE_SET: &str = "set_spend_cap_override";

    /// Spend cap override cleared for organization
    pub const SPEND_CAP_OVERRIDE_CLEARED: &str = "clear_spend_cap_override";

    /// Test overage charge created
    pub const TEST_OVERAGE_CREATED: &str = "create_test_overage";

    /// Custom organization limits set
    pub const CUSTOM_LIMITS_SET: &str = "set_custom_limits";

    /// Custom organization limits cleared
    pub const CUSTOM_LIMITS_CLEARED: &str = "clear_custom_limits";

    // Email Management (SOC 2 CC7.1)
    /// Admin composed and sent an email
    pub const SEND_EMAIL: &str = "send_email";

    // Support Ticket Management (SOC 2 CC7.1)
    /// Support ticket status changed
    pub const TICKET_STATUS_CHANGED: &str = "ticket_status_changed";

    /// Support ticket assigned to agent
    pub const TICKET_ASSIGNED: &str = "ticket_assigned";

    /// Support ticket reply sent
    pub const TICKET_REPLY_SENT: &str = "ticket_reply_sent";
}

/// Target types for admin audit logs
///
/// Categories of resources that can be the target of administrative actions.
pub mod target_type {
    /// Individual user account
    pub const USER: &str = "user";

    /// Organization (multi-user account)
    pub const ORGANIZATION: &str = "organization";

    /// API key for programmatic access
    pub const API_KEY: &str = "api_key";

    /// Subscription plan/billing
    pub const SUBSCRIPTION: &str = "subscription";

    /// System-wide settings or operations
    pub const SYSTEM: &str = "system";

    /// Email message (admin inbox)
    pub const EMAIL: &str = "email";

    /// Support ticket
    pub const TICKET: &str = "ticket";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constants_are_lowercase() {
        // Ensure all constants follow lowercase naming convention for database consistency
        assert_eq!(event_type::AUTHENTICATION, "authentication");
        assert_eq!(severity::INFO, "info");
        assert_eq!(auth_event::LOGIN_SUCCESS, "login_success");
        assert_eq!(admin_action::USER_CREATED, "user_created");
        assert_eq!(target_type::USER, "user");
    }

    #[test]
    fn test_no_duplicate_constants() {
        // Ensure event types are unique
        let event_types = vec![
            event_type::AUTHENTICATION,
            event_type::USER_MANAGEMENT,
            event_type::DATA_MODIFICATION,
            event_type::SECURITY_SETTING,
            event_type::ADMIN_ACTION,
            event_type::CONFIGURATION,
        ];
        let unique_count = event_types.iter().collect::<std::collections::HashSet<_>>().len();
        assert_eq!(event_types.len(), unique_count, "Event types must be unique");
    }
}
