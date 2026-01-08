# Production Code TODO Analysis
**Date:** January 2, 2026
**Phase:** 3.5 - Complete TODO Items
**Status:** Comprehensive audit complete

---

## Executive Summary

**Total TODO Items in Production Code:** 10
**CRITICAL Priority:** 3 (blocking launch)
**HIGH Priority:** 1 (should fix before launch)
**MEDIUM Priority:** 2 (defer to v1.1)
**LOW Priority:** 4 (defer to v1.1+)

**Note:** The embeddings tool reported 634 items, but 624 were in DEBUG_*.md documentation files, not production code.

---

## CRITICAL Priority (Must Fix Before Launch) ⚠️

### 1. Session Tracking Implementation (Phase 1.3 Dependency)
**File:** `crates/api/src/auth/middleware.rs:339`
**Code:**
```rust
session_id: None, // TODO: Extract from Supabase JWT when session tracking implemented
```

**Impact:** BLOCKING - This is required for Phase 1.3 (Missing Session Invalidation for JWTs)
**CVSS:** 7.5 (High) - Cannot revoke compromised tokens
**Effort:** 8 hours (part of Phase 1.3)
**Action Required:**
1. Implement `user_sessions` table (migration exists in plan)
2. Add `session_id` to JWT claims
3. Extract session_id from JWT in middleware
4. Validate session on every request

**Status:** 🔴 BLOCKING LAUNCH - Part of Phase 1.3 security fixes

---

### 2. Email Verification System
**File:** `crates/api/src/routes/auth.rs:446`
**Code:**
```rust
// TODO: Send verification email
```

**Impact:** CRITICAL - Users can register without email verification
**Security Risk:** Email enumeration, fake accounts, spam
**Effort:** 6 hours
**Action Required:**
1. Create email verification token system
2. Send verification email on registration (using Resend)
3. Implement verification endpoint
4. Add unverified user restrictions
5. Add resend verification endpoint

**Status:** 🔴 BLOCKING LAUNCH - Core authentication feature

---

### 3. Password Reset Email System
**File:** `crates/api/src/routes/auth.rs:1317`
**Code:**
```rust
// TODO: Send password reset email
```

**Impact:** CRITICAL - Password reset functionality broken
**Security Risk:** Users cannot recover accounts
**Effort:** 4 hours
**Action Required:**
1. Create password reset token system
2. Send password reset email (using Resend)
3. Implement reset token validation
4. Add token expiry (24 hours)
5. Add rate limiting to prevent abuse

**Status:** 🔴 BLOCKING LAUNCH - Core authentication feature

---

## HIGH Priority (Should Fix Before Launch) ⚠️

### 4. Service Suspension Notification Emails
**File:** `crates/worker/src/main.rs:267`
**Code:**
```rust
// TODO: Send notification email about service suspension
```

**Impact:** HIGH - Users not notified when suspended for overage
**User Experience:** Poor - Users discover suspension unexpectedly
**Effort:** 3 hours
**Action Required:**
1. Create suspension email template
2. Send email when service suspended (using Resend)
3. Include overage details and payment instructions
4. Add link to billing dashboard

**Status:** 🟡 RECOMMENDED FOR LAUNCH - Important UX feature

---

## MEDIUM Priority (Defer to v1.1) 📋

### 5. MCP Session Timestamp Tracking
**File:** `crates/api/src/mcp/client.rs:938`
**Code:**
```rust
// TODO: Add timestamp tracking to remove truly stale sessions
```

**Impact:** MEDIUM - Stale MCP sessions not cleaned up efficiently
**Performance:** Minor - Session map grows slowly over time
**Effort:** 2 hours
**Action Required:**
1. Add `last_activity` timestamp to session struct
2. Update timestamp on each MCP request
3. Add periodic cleanup task (remove sessions idle > 24h)
4. Add session metrics logging

**Status:** 🟢 DEFER TO v1.1 - Performance optimization

---

### 6. MCP Handlers Test Fixtures
**Files:**
- `crates/api/src/mcp/handlers.rs:1114`
- `crates/api/src/mcp/handlers.rs:1118`

**Code:**
```rust
#[ignore = "requires database pool mocking - TODO: implement with sqlx test fixtures"]
// TODO: Implement proper unit test with sqlx test fixtures or mock pool
```

**Impact:** MEDIUM - Integration test coverage gap
**Testing:** Tests exist but are ignored/stubbed
**Effort:** 4 hours
**Action Required:**
1. Create `#[sqlx::test]` fixtures for MCP handlers
2. Mock database pool with test data
3. Implement `test_parse_auth_bearer()` test
4. Remove `#[ignore]` attributes

**Status:** 🟢 DEFER TO v1.1 - Test coverage improvement (Phase 3.3 scope)

---

## LOW Priority (Defer to v1.1+) 📝

### 7. Frontend Settings - Website & Timezone
**File:** `web/src/app/(dashboard)/settings/page.tsx:462`
**Code:**
```tsx
{/* TODO: Website and timezone settings - requires API support */}
```

**Impact:** LOW - Nice-to-have settings features
**Effort:** 3 hours (backend + frontend)
**Action Required:**
1. Add `website` and `timezone` fields to user/org settings
2. Create API endpoints for updating settings
3. Implement frontend UI
4. Add timezone support to date/time displays

**Status:** 🟢 DEFER TO v1.1+ - Feature enhancement

---

### 8. Admin Support Settings
**File:** `web/src/app/(dashboard)/admin/support/page.tsx:1460`
**Code:**
```tsx
// TODO: Implement API call to save setting
```

**Impact:** LOW - Admin UI incomplete
**Effort:** 2 hours
**Action Required:**
1. Create API endpoint for admin support settings
2. Implement frontend mutation
3. Add error handling and success toast

**Status:** 🟢 DEFER TO v1.1+ - Admin feature

---

### 9. Team Member Unsuspend Feature
**File:** `web/src/app/(dashboard)/team/page.tsx:222`
**Code:**
```tsx
// TODO: Implement unsuspend member mutation when backend endpoint is ready
```

**Impact:** LOW - Feature parity with suspend
**Effort:** 2 hours
**Action Required:**
1. Create `/api/team/:member_id/unsuspend` endpoint
2. Implement frontend mutation
3. Add UI button for unsuspending members
4. Add audit logging

**Status:** 🟢 DEFER TO v1.1+ - Feature enhancement

---

## Resolution Plan

### Immediate Action (Before Launch) - 21 hours

**Week 1 (Critical Security & Auth):**
1. ✅ Phase 1.3: Session tracking (8 hours) - **Already planned in security audit**
2. 🔴 Email verification system (6 hours)
3. 🔴 Password reset emails (4 hours)
4. 🟡 Service suspension emails (3 hours)

**Total:** 21 hours (3 days with 1 engineer)

### Deferred Work (v1.1) - 8 hours

**Future Sprint:**
1. MCP session timestamp tracking (2 hours)
2. MCP handlers test fixtures (4 hours)
3. Admin support settings (2 hours)

### Deferred Work (v1.1+) - 7 hours

**Low Priority Backlog:**
1. Website & timezone settings (3 hours)
2. Team member unsuspend (2 hours)
3. General settings API improvements (2 hours)

---

## Action Items

### Immediate (This Week)

- [ ] **Implement email verification system** (auth.rs:446)
  - Create verification token system
  - Send verification emails via Resend
  - Add verification endpoint
  - Restrict unverified users

- [ ] **Implement password reset emails** (auth.rs:1317)
  - Create reset token system
  - Send reset emails via Resend
  - Add token validation endpoint
  - Add rate limiting

- [ ] **Implement suspension notification emails** (worker/main.rs:267)
  - Create suspension email template
  - Send email on service suspension
  - Include overage details and payment link

### Deferred (Create GitHub Issues)

- [ ] **Issue #1:** MCP session timestamp tracking and cleanup
- [ ] **Issue #2:** MCP handlers test fixtures implementation
- [ ] **Issue #3:** Frontend settings enhancements (website, timezone)
- [ ] **Issue #4:** Admin support settings API
- [ ] **Issue #5:** Team member unsuspend feature

---

## Testing Strategy

**Email Verification Testing:**
1. Register new account → verify email sent
2. Click verification link → account verified
3. Login before verification → restricted access
4. Resend verification → new email sent

**Password Reset Testing:**
1. Request password reset → email sent
2. Use reset link → password changed successfully
3. Reset token expires after 24h
4. Rate limiting prevents abuse (5 requests per 15 min)

**Suspension Email Testing:**
1. Trigger overage → service suspended
2. Suspension email sent immediately
3. Email includes correct overage amount
4. Payment link redirects to billing dashboard

---

## Risk Assessment

**Launch Blockers:**
- 🔴 Email verification missing → Users can create fake accounts
- 🔴 Password reset broken → Users cannot recover accounts
- 🟡 Suspension emails missing → Poor user experience

**Acceptable Risks:**
- 🟢 MCP session cleanup → Minor performance impact
- 🟢 Settings features → Nice-to-have, not core functionality
- 🟢 Test coverage gaps → Integration tests cover critical paths

---

## Success Criteria

**Launch Readiness (All Must Pass):**
- ✅ Email verification system functional
- ✅ Password reset emails working
- ✅ Suspension notification emails sending
- ✅ All critical authentication flows tested
- ✅ Rate limiting configured
- ✅ Email templates reviewed and approved

**Post-Launch Goals:**
- Complete deferred TODOs in v1.1 sprint
- Increase test coverage to 85%+
- Add remaining settings features

---

**Status:** ✅ ANALYSIS COMPLETE
**Next Steps:**
1. Review and approve resolution plan
2. Begin email verification implementation
3. Implement password reset emails
4. Add suspension notifications

**Estimated Completion:** January 5, 2026 (3 days)

---

*This analysis was generated during Phase 3.5 of the PlexMCP pre-launch security audit and code cleanup plan.*
