# API Routes Refactoring Guide

## Overview

This document outlines the refactoring strategy for large route files (>1,500 lines) into modular structures.

## Phase 3.4 Status

### Completed ✅
- **admin.rs refactoring structure established**
  - Created `routes/admin/` module directory
  - Renamed `admin.rs` → `admin_legacy.rs` (temporary)
  - Created `admin/mod.rs` with module structure
  - Created `admin/shared.rs` with common helpers
  - Updated `routes/mod.rs` to use new structure
  - **Compilation verified: PASSING ✅**

### In Progress 🔄
- Incremental extraction of admin functionality into sub-modules

## Refactoring Strategy

### 1. Admin Routes (3,899 lines) - 🟡 IN PROGRESS

**Current Structure:**
```
routes/
├── admin_legacy.rs (3,899 lines - original file)
└── admin/
    ├── mod.rs (module definition with migration plan)
    └── shared.rs (common types and helpers)
```

**Target Structure:**
```
routes/admin/
├── mod.rs              # Module definition and re-exports
├── shared.rs           # Shared types, helpers, utilities
├── users.rs            # User listing, retrieval, updates
├── user_actions.rs     # Security actions (suspend, 2FA, sessions)
├── billing.rs          # Billing testing endpoints
├── limits.rs           # Enterprise custom limits
├── mcp_logs.rs         # MCP proxy request logs
├── staff_emails.rs     # Staff email assignment
└── organizations.rs    # Organization management
```

**Migration Plan:**
1. ✅ Create module structure
2. ✅ Extract `log_db_err` helper to `shared.rs`
3. ⏳ Extract request/response types to `shared.rs`
4. ⏳ Extract user management routes to `users.rs`
5. ⏳ Extract user action routes to `user_actions.rs`
6. ⏳ Extract billing routes to `billing.rs`
7. ⏳ Extract limits routes to `limits.rs`
8. ⏳ Extract MCP logs routes to `mcp_logs.rs`
9. ⏳ Extract staff email routes to `staff_emails.rs`
10. ⏳ Extract organization routes to `organizations.rs`
11. ⏳ Delete `admin_legacy.rs`

**Functions to Extract:**

**Users Module (~1,200 lines):**
- `list_users` - GET /admin/users
- `get_user` - GET /admin/users/:user_id
- `update_user` - PATCH /admin/users/:user_id
- `set_usage` - POST /admin/usage/set
- `reset_usage` - POST /admin/usage/:org_id/reset
- `get_stats` - GET /admin/stats
- `list_organizations` - GET /admin/organizations

**User Actions Module (~700 lines):**
- `revoke_user_sessions` - POST /admin/users/:user_id/revoke-sessions
- `force_password_reset` - POST /admin/users/:user_id/force-password-reset
- `disable_user_2fa` - POST /admin/users/:user_id/disable-2fa
- `suspend_user` - POST /admin/users/:user_id/suspend
- `unsuspend_user` - POST /admin/users/:user_id/unsuspend
- `delete_user` - DELETE /admin/users/:user_id
- `revoke_user_api_key` - DELETE /admin/users/:user_id/api-keys/:key_id

**Billing Module (~500 lines):**
- `inject_usage` - POST /admin/billing/inject-usage
- `set_spend_cap_override` - POST /admin/billing/spend-cap-override
- `clear_spend_cap_override` - POST /admin/billing/spend-cap-override/clear
- `create_test_overage` - POST /admin/billing/test-overage

**Limits Module (~600 lines):**
- `get_org_limits` - GET /admin/orgs/:org_id/limits
- `set_org_limits` - PUT /admin/orgs/:org_id/limits
- `clear_org_limits` - DELETE /admin/orgs/:org_id/limits
- `get_limit_history` - GET /admin/orgs/:org_id/limits/history

**MCP Logs Module (~400 lines):**
- `get_mcp_logs` - GET /admin/mcp/logs

**Staff Emails Module (~400 lines):**
- `admin_list_staff_emails` - GET /admin/support/staff/emails
- `admin_assign_staff_email` - POST /admin/support/staff/emails
- `admin_auto_generate_staff_email` - POST /admin/support/staff/emails/auto-generate
- `admin_remove_staff_email` - DELETE /admin/support/staff/emails/:assignment_id

---

### 2. Superadmin Routes (1,567 lines) - ⏳ PENDING

**Target Structure:**
```
routes/superadmin/
├── mod.rs
├── shared.rs
├── users.rs         # User role management
├── audit_logs.rs    # Audit log viewing and export
└── system.rs        # System stats and queries
```

---

### 3. Billing Webhooks (1,892 lines) - ⏳ PENDING

**Target Structure:**
```
billing/webhooks/
├── mod.rs
├── shared.rs
├── subscriptions.rs   # Subscription events
├── invoices.rs        # Invoice events
├── payments.rs        # Payment method events
└── signature.rs       # Webhook signature verification
```

---

### 4. Auth Routes (1,654 lines) - ⏳ PENDING

**Target Structure:**
```
routes/auth/
├── mod.rs
├── shared.rs
├── registration.rs    # Register, email verification
├── login.rs           # Login, 2FA login, refresh
├── password.rs        # Password reset, change
└── oauth.rs           # OAuth flows
```

---

### 5. MCP Handlers (1,543 lines) - ⏳ PENDING

**Target Structure:**
```
mcp/handlers/
├── mod.rs
├── shared.rs
├── tools.rs           # Tool execution
├── resources.rs       # Resource operations
├── prompts.rs         # Prompt operations
└── completion.rs      # Completion requests
```

---

## Refactoring Guidelines

### DO ✅
- Extract functions with their related types
- Maintain all existing imports
- Preserve function signatures exactly
- Keep comprehensive documentation
- Test after each extraction
- Verify compilation at each step
- Use `pub use` to re-export from submodules

### DON'T ❌
- Change function behavior
- Modify return types
- Remove error handling
- Skip compilation verification
- Extract partially (complete whole modules)

## Testing Strategy

After each module extraction:

1. **Compilation Check:**
   ```bash
   cargo check -p plexmcp-api --lib
   ```

2. **Test Execution:**
   ```bash
   cargo test -p plexmcp-api
   ```

3. **Integration Verification:**
   - Verify all route registrations in `routes/mod.rs`
   - Check all imports resolve correctly
   - Ensure no breaking API changes

## Benefits

- **Maintainability:** Easier to navigate and understand code
- **Modularity:** Clear separation of concerns
- **Testability:** Isolated modules easier to test
- **Scalability:** Easier to add new features
- **Team Collaboration:** Reduced merge conflicts

## Timeline

- **Phase 1** (Completed): Module structure creation
- **Phase 2** (Est. 4 hours): Extract shared types
- **Phase 3** (Est. 8 hours): Extract route handlers
- **Phase 4** (Est. 2 hours): Testing and verification
- **Phase 5** (Est. 2 hours): Documentation updates

**Total Estimated Time per File:** 16 hours
**Total for 5 Files:** 80 hours (2 weeks with 2 engineers)

## Current Status

- ✅ admin.rs structure created (Phase 1 complete)
- ⏳ admin.rs extraction in progress (Phase 2)
- ⏳ Other files pending

---

**Last Updated:** January 2, 2026
**Status:** Phase 3.4 in progress - Zero technical debt maintained
