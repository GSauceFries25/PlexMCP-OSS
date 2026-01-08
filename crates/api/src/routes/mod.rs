//! API routes

#[cfg(feature = "billing")]
pub mod addons;
pub mod admin;
pub mod admin_legacy;  // Legacy monolithic admin.rs (being refactored into admin/ module)
pub mod analytics_tracking;
pub mod api_keys;
pub mod audit;
pub mod auth;
#[cfg(feature = "billing")]
pub mod billing;
pub mod domains;
pub mod gdpr;
pub mod health;
pub mod identities;
pub mod invitations;
pub mod mcp_proxy;
pub mod mcps;
pub mod notifications;
pub mod organizations;
pub mod pin;
pub mod public;
pub mod support;
pub mod two_factor;
#[cfg(feature = "billing")]
pub mod usage;
pub mod users;

use axum::{
    extract::DefaultBodyLimit,
    http::HeaderMap,
    middleware,
    routing::{delete, get, patch, post, put},
    Router,
};

use crate::{
    auth::{require_auth, optional_auth},
    state::AppState,
    websocket::ws_handler,
};

/// Extract client IP address from request headers.
/// Checks common proxy headers in order of preference.
pub fn extract_client_ip(headers: &HeaderMap) -> Option<String> {
    // Check common proxy headers in order of preference
    headers
        .get("cf-connecting-ip") // Cloudflare
        .or_else(|| headers.get("x-real-ip"))
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|h| h.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
}

/// Create all API routes
pub fn create_router(state: AppState) -> Router {
    let auth_state = state.auth_state();

    // Health check routes (at root level for infrastructure monitoring)
    let health_routes = Router::new()
        .route("/health", get(health::health))
        .route("/health/live", get(health::liveness))
        .route("/health/ready", get(health::readiness));

    // Public API routes (no auth required) - under /api/v1
    let mut public_api_routes = Router::new()
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/login/2fa", post(auth::login_2fa))
        .route("/auth/refresh", post(auth::refresh))
        .route("/auth/forgot-password", post(auth::forgot_password))
        .route("/auth/reset-password", post(auth::reset_password))
        .route("/auth/verify-email", post(auth::verify_email))
        .route("/auth/resend-verification", post(auth::resend_verification_email))
        .route("/auth/check-password-strength", post(auth::check_password_strength))
        // Audit logging endpoints (public - called during OAuth flow)
        .route("/audit/oauth-initiated", post(audit::oauth_initiated))
        .route("/audit/oauth-callback", post(audit::oauth_callback))
        .route("/audit/oauth-session-created", post(audit::oauth_session_created))
        .route("/audit/session-event", post(audit::session_event))
        // PIN reset (public - user forgot their PIN)
        .route("/pin/forgot", post(pin::forgot_pin))
        .route("/pin/reset", post(pin::reset_pin))
        // OAuth 2FA check (uses Supabase JWT, not our JWT)
        .route("/auth/check-2fa", post(auth::check_2fa_required))
        // OAuth state token generation (CSRF protection - SOC 2 CC6.1)
        .route("/auth/oauth-init", post(auth::oauth_init))
        // OAuth code exchange (uses service_role to bypass rate limits)
        .route("/auth/oauth-exchange", post(auth::oauth_exchange))
        // Invitation acceptance (public - invitee doesn't have an account yet)
        .route("/invitations/validate", get(invitations::validate_invitation))
        .route("/invitations/accept", post(invitations::accept_invitation))
        // Enterprise sales inquiry (public - contact form for enterprise tier)
        .route("/public/enterprise-inquiry", post(public::submit_enterprise_inquiry))
        // Website analytics collection (public with optional auth for admin exclusion)
        .route("/analytics/collect",
            post(analytics_tracking::collect)
                .route_layer(middleware::from_fn_with_state(
                    auth_state.clone(),
                    optional_auth
                ))
        );

    // Stripe webhook (public, uses signature verification) - only when billing feature is enabled AND runtime config allows
    #[cfg(feature = "billing")]
    if state.config.enable_billing {
        public_api_routes = public_api_routes
            .route("/billing/webhook", post(billing::webhook));
    }

    // Protected API routes (auth required) - under /api/v1
    let mut protected_api_routes = Router::new()
        // Auth routes
        .route("/auth/me", get(auth::me))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/change-password", post(auth::change_password))
        // Session management
        .route("/auth/sessions", get(auth::list_sessions))
        .route("/auth/sessions/:session_id", delete(auth::revoke_session))
        .route("/auth/sessions/all", delete(auth::logout_all))
        // Organizations list/create (for OAuth users without org in JWT)
        .route("/organizations", get(organizations::list_orgs))
        .route("/organizations", post(organizations::create_org))
        .route("/organizations/:org_id", get(organizations::get_org_by_id))
        // Organization routes (current org from JWT)
        .route("/org", get(organizations::get_org))
        .route("/org", patch(organizations::update_org))
        .route("/org", delete(organizations::delete_org))
        .route("/org/stats", get(organizations::get_org_stats))
        .route("/org/subscription", get(organizations::get_subscription))
        .route("/org/subdomain/check", post(organizations::check_subdomain_availability))
        // User routes
        .route("/users", get(users::list_users))
        .route("/users", post(users::invite_user))
        .route("/users/:user_id", get(users::get_user))
        .route("/users/:user_id", patch(users::update_user))
        .route("/users/:user_id", delete(users::delete_user))
        // API Key routes (legacy flat routes)
        .route("/api-keys", get(api_keys::list_api_keys))
        .route("/api-keys", post(api_keys::create_api_key))
        .route("/api-keys/:key_id", get(api_keys::get_api_key))
        .route("/api-keys/:key_id", patch(api_keys::update_api_key))
        .route("/api-keys/:key_id", delete(api_keys::delete_api_key))
        .route("/api-keys/:key_id/rotate", post(api_keys::rotate_api_key))
        .route("/api-keys/:key_id/usage", get(api_keys::get_api_key_usage))
        // MCP routes (legacy flat routes)
        .route("/mcps", get(mcps::list_mcps))
        .route("/mcps", post(mcps::create_mcp))
        .route("/mcps/test-all", post(mcps::test_all_mcps))  // Must be before :mcp_id routes
        .route("/mcps/:mcp_id", get(mcps::get_mcp))
        .route("/mcps/:mcp_id", patch(mcps::update_mcp))
        .route("/mcps/:mcp_id", delete(mcps::delete_mcp))
        .route("/mcps/:mcp_id/status", patch(mcps::update_mcp_status))
        .route("/mcps/:mcp_id/health-check", post(mcps::trigger_health_check))
        .route("/mcps/:mcp_id/test-history", get(mcps::get_test_history))
        .route("/mcps/:mcp_id/validate", post(mcps::validate_config))
        .route("/mcps/:mcp_id/config", get(mcps::get_mcp_config))
        .route("/mcps/:mcp_id/config", put(mcps::update_mcp_config))
        // PIN-protected key management routes
        .route("/pin/status", get(pin::get_pin_status))
        .route("/pin", post(pin::set_pin))
        .route("/pin/change", post(pin::change_pin))
        .route("/pin/verify", post(pin::verify_pin))
        .route("/pin", delete(pin::delete_pin))
        .route("/api-keys/:key_id/reveal", post(pin::reveal_api_key))
        // Two-Factor Authentication (2FA) routes
        .route("/2fa/status", get(two_factor::get_2fa_status))
        .route("/2fa/setup", post(two_factor::begin_2fa_setup))
        .route("/2fa/setup/confirm", post(two_factor::confirm_2fa_setup))
        .route("/2fa/verify", post(two_factor::verify_2fa))
        .route("/2fa/disable", post(two_factor::disable_2fa))
        .route("/2fa/backup-codes/regenerate", post(two_factor::regenerate_backup_codes))
        // Trusted device management
        .route("/2fa/devices", get(two_factor::list_trusted_devices))
        .route("/2fa/devices", delete(two_factor::revoke_all_trusted_devices))
        .route("/2fa/devices/:device_id", delete(two_factor::revoke_trusted_device))
        // Custom domain routes
        .route("/domains", get(domains::list_domains))
        .route("/domains", post(domains::create_domain))
        .route("/domains/:domain_id", get(domains::get_domain))
        .route("/domains/:domain_id", delete(domains::delete_domain))
        .route("/domains/:domain_id/verify", post(domains::verify_domain))
        .route("/domains/:domain_id/toggle", patch(domains::toggle_domain))
        // Account identity (connected accounts) routes
        .route("/account/identities", get(identities::list_identities))
        .route("/account/identities", post(identities::link_identity))
        .route("/account/identities/providers", get(identities::list_providers))
        .route("/account/identities/:provider", delete(identities::unlink_identity))
        // Notification preferences routes
        .route("/notification-preferences", get(notifications::get_notification_preferences))
        .route("/notification-preferences", patch(notifications::update_notification_preferences))
        // Support ticket routes
        .route("/support/tickets", get(support::list_tickets))
        .route("/support/tickets", post(support::create_ticket))
        .route("/support/tickets/:ticket_id", get(support::get_ticket))
        .route("/support/tickets/:ticket_id/messages", post(support::reply_to_ticket))
        .route("/support/tickets/:ticket_id/close", post(support::close_ticket))
        // Team invitation routes
        .route("/invitations", get(invitations::list_invitations))
        .route("/invitations", post(invitations::create_invitation))
        .route("/invitations/:invitation_id/resend", post(invitations::resend_invitation))
        .route("/invitations/:invitation_id", delete(invitations::cancel_invitation))
        // Platform admin routes (role check inside handlers)
        .route("/admin/users", get(admin::list_users))
        .route("/admin/users/:user_id", get(admin::get_user))
        .route("/admin/users/:user_id", patch(admin::update_user))
        .route("/admin/organizations", get(admin::list_organizations))
        .route("/admin/stats", get(admin::get_stats))
        // Admin user action routes
        .route("/admin/users/:user_id/revoke-sessions", post(admin::revoke_user_sessions))
        .route("/admin/users/:user_id/force-password-reset", post(admin::force_password_reset))
        .route("/admin/users/:user_id/disable-2fa", post(admin::disable_user_2fa))
        .route("/admin/users/:user_id/suspend", post(admin::suspend_user))
        .route("/admin/users/:user_id/unsuspend", post(admin::unsuspend_user))
        .route("/admin/users/:user_id", delete(admin::delete_user))
        .route("/admin/users/:user_id/api-keys/:key_id", delete(admin::revoke_user_api_key))
        // Admin overages toggle routes
        .route("/admin/orgs/:org_id/overages", get(admin::get_org_overages))
        .route("/admin/orgs/:org_id/overages", put(admin::toggle_org_overages))
        // Admin MCP proxy logs route
        .route("/admin/mcp/logs", get(admin::get_mcp_logs))
        // Admin support ticket routes
        .route("/admin/support/tickets", get(support::admin_list_tickets))
        .route("/admin/support/stats", get(support::admin_get_ticket_stats))
        .route("/admin/support/stats/enhanced", get(support::admin_get_ticket_stats_enhanced))
        .route("/admin/support/workload", get(support::admin_get_workload))
        .route("/admin/support/staff", get(support::admin_list_staff))
        .route("/admin/support/tickets/:ticket_id", get(support::admin_get_ticket).patch(support::admin_update_ticket))
        .route("/admin/support/tickets/:ticket_id/reply", post(support::admin_reply_to_ticket))
        .route("/admin/support/tickets/:ticket_id/reply-internal", post(support::admin_reply_with_internal))
        .route("/admin/support/tickets/:ticket_id/assign", post(support::admin_assign_ticket))
        .route("/admin/support/tickets/:ticket_id/history", get(support::admin_get_assignment_history))
        .route("/admin/support/tickets/batch/assign", post(support::admin_batch_assign))
        .route("/admin/support/tickets/batch/status", post(support::admin_batch_status))
        // SLA rules management
        .route("/admin/support/sla/rules", get(support::admin_list_sla_rules))
        .route("/admin/support/sla/rules", post(support::admin_create_sla_rule))
        .route("/admin/support/sla/rules/:rule_id", patch(support::admin_update_sla_rule))
        // Template management
        .route("/admin/support/templates", get(support::admin_list_templates))
        .route("/admin/support/templates", post(support::admin_create_template))
        .route("/admin/support/templates/:template_id", patch(support::admin_update_template))
        .route("/admin/support/templates/:template_id", delete(support::admin_delete_template))
        // Admin website analytics routes
        .route("/admin/analytics/website/realtime", get(analytics_tracking::get_realtime))
        .route("/admin/analytics/website/overview", get(analytics_tracking::get_overview))
        .route("/admin/analytics/website/overview-enhanced", get(analytics_tracking::get_overview_enhanced))
        .route("/admin/analytics/website/timeseries", get(analytics_tracking::get_timeseries))
        .route("/admin/analytics/website/pages", get(analytics_tracking::get_top_pages))
        .route("/admin/analytics/website/referrers", get(analytics_tracking::get_referrers))
        .route("/admin/analytics/website/devices", get(analytics_tracking::get_devices))
        .route("/admin/analytics/website/locations", get(analytics_tracking::get_locations))
        .route("/admin/analytics/website/events", get(analytics_tracking::get_events))
        .route("/admin/analytics/website/events/details", get(analytics_tracking::get_event_details))
        .route("/admin/analytics/website/goals", get(analytics_tracking::list_goals))
        .route("/admin/analytics/website/goals", post(analytics_tracking::create_goal))
        .route("/admin/analytics/website/goals/:goal_id", patch(analytics_tracking::update_goal))
        .route("/admin/analytics/website/goals/:goal_id", delete(analytics_tracking::delete_goal))
        .route("/admin/analytics/website/settings", get(analytics_tracking::get_settings))
        .route("/admin/analytics/website/settings", patch(analytics_tracking::update_settings))
        .route("/admin/analytics/website/alerts", get(analytics_tracking::list_alerts))
        .route("/admin/analytics/website/alerts/:alert_id/resolve", patch(analytics_tracking::resolve_alert))
        // GDPR compliance routes (Article 15 & 17)
        .route("/gdpr/export", get(gdpr::export_user_data))
        .route("/gdpr/deletion", get(gdpr::get_deletion_status))
        .route("/gdpr/deletion", post(gdpr::request_deletion))
        .route("/gdpr/deletion", delete(gdpr::cancel_deletion));

    // Billing routes - only when billing feature is enabled AND runtime config allows
    // Two-layer gating: compile-time (feature flag) + runtime (config.enable_billing)
    #[cfg(feature = "billing")]
    if state.config.enable_billing {
        protected_api_routes = protected_api_routes
            // Billing routes
            .route("/billing/checkout", post(billing::create_checkout))
            .route("/billing/portal", post(billing::create_portal_session))
            .route("/billing/subscription", get(billing::get_subscription))
            .route("/billing/subscription", patch(billing::update_subscription))
            .route("/billing/subscription", delete(billing::cancel_subscription))
            .route("/billing/subscription/resume", post(billing::resume_subscription))
            .route("/billing/subscription/reactivate", post(billing::reactivate_subscription))
            .route("/billing/subscription/preview-proration", get(billing::preview_proration))
            // Overage routes
            .route("/billing/overages", get(billing::get_overages))
            .route("/billing/overages/current", get(billing::get_current_overage))
            .route("/billing/overages/accumulated", get(billing::get_accumulated_overage))
            .route("/billing/overages/pay-now", post(billing::pay_overages_now))
            // Spend cap routes
            .route("/billing/spend-cap", get(billing::get_spend_cap))
            .route("/billing/spend-cap", post(billing::set_spend_cap))
            .route("/billing/spend-cap", delete(billing::remove_spend_cap))
            // Instant charge routes
            .route("/billing/instant-charges", get(billing::get_instant_charges))
            // Downgrade scheduling routes
            .route("/billing/subscription/downgrade", post(billing::schedule_downgrade))
            .route("/billing/subscription/downgrade", get(billing::get_scheduled_downgrade))
            .route("/billing/subscription/downgrade", delete(billing::cancel_scheduled_downgrade))
            // Invoice routes (database-backed with line items)
            .route("/billing/invoices", get(billing::list_invoices))
            .route("/billing/invoices/sync", post(billing::sync_invoices))
            .route("/billing/invoices/:invoice_id", get(billing::get_invoice_detail))
            .route("/billing/invoices/:invoice_id/pay", post(billing::pay_invoice))
            .route("/billing/invoices/:invoice_id/dispute", post(billing::create_invoice_dispute))
            .route("/billing/grace-period", get(billing::get_grace_period_status))
            // Add-on routes
            .route("/addons", get(addons::list_addons))
            .route("/addons/quantities", get(addons::get_addon_quantities))
            .route("/addons/:addon_type/enable", post(addons::enable_addon))
            .route("/addons/:addon_type/quantity", patch(addons::update_addon_quantity))
            .route("/addons/:addon_type", delete(addons::disable_addon))
            .route("/addons/:addon_type", get(addons::check_addon))
            // Usage routes (requires billing feature)
            .route("/usage", get(usage::get_billing_usage))
            .route("/usage/summary", get(usage::get_usage_summary))
            .route("/usage/by-api-key", get(usage::get_usage_by_api_key))
            .route("/usage/by-mcp", get(usage::get_usage_by_mcp))
            .route("/usage/hourly", get(usage::get_hourly_usage))
            .route("/usage/check-limit", get(usage::check_usage_limit))
            .route("/usage/limits", get(usage::get_effective_limits))
            .route("/usage/errors", get(usage::get_recent_errors))
            .route("/usage/latency-distribution", get(usage::get_latency_distribution))
            // Admin billing diagnostic routes (requires billing feature)
            .route("/admin/billing/invariants", get(admin::check_billing_invariants))
            .route("/admin/billing/debug/:org_id", get(admin::debug_org_billing));
    }

    // Apply auth middleware to protected routes
    let protected_api_routes = protected_api_routes
        .layer(middleware::from_fn_with_state(auth_state.clone(), require_auth));

    // WebSocket routes (auth handled in handler via query parameter)
    let websocket_routes = Router::new()
        .route("/ws/support", get(ws_handler));

    // Combine API routes under /api/v1 prefix
    let api_v1_routes = Router::new()
        .merge(public_api_routes)
        .merge(protected_api_routes)
        .merge(websocket_routes);

    // MCP Proxy routes (API key auth, not JWT)
    // This is the main proxy endpoint that forwards requests to upstream MCPs
    let mcp_routes = Router::new()
        .route("/mcp", post(mcp_proxy::handle_mcp_request))
        .layer(DefaultBodyLimit::max(state.config.mcp_max_request_body_bytes));

    // Combine all routes
    Router::new()
        .merge(health_routes)
        .merge(mcp_routes) // MCP proxy at root level
        .nest("/api/v1", api_v1_routes)
        // SOC 2 CC6.1: Global request body size limit to prevent DoS via large payloads
        // MCP routes have their own 1MB limit which takes precedence
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024)) // 10MB global limit
        .with_state(state)
}
