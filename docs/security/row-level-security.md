# Row-Level Security (RLS) Architecture

**Document Version:** 1.0
**Last Updated:** January 2, 2026
**SOC 2 Control:** CC6.1 - Logical Access Security

---

## Overview

PlexMCP uses PostgreSQL Row-Level Security (RLS) to enforce multi-tenant data isolation at the database layer. This provides defense-in-depth security by ensuring that even if application logic is compromised, users cannot access data from other organizations.

### Key Principle: FORCE ROW LEVEL SECURITY

**All tables with RLS enabled MUST use FORCE RLS** to prevent privilege escalation bypass.

```sql
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_name FORCE ROW LEVEL SECURITY;  -- CRITICAL!
```

---

## Why FORCE RLS is Critical

### The Security Vulnerability

Without `FORCE ROW LEVEL SECURITY`, users with the `bypassrls` privilege (superadmins) can bypass all RLS policies:

```sql
-- WITHOUT FORCE RLS (VULNERABLE):
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Superadmin can access ALL organizations' data:
SELECT * FROM users;  -- Returns data from ALL orgs (SECURITY BREACH!)
```

### The Fix

With `FORCE ROW LEVEL SECURITY`, **even superadmins** must follow RLS policies:

```sql
-- WITH FORCE RLS (SECURE):
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Superadmin can ONLY access their own organization:
SELECT * FROM users;  -- Returns ONLY current org's data (SECURE!)
```

**CVSS Score:** 7.2 (High) - Bypassing multi-tenant isolation is a critical security issue

---

## RLS Policy Patterns

### 1. Organization-Based Isolation (Most Common)

Used for tables that belong to a specific organization:

```sql
CREATE POLICY org_isolation ON table_name
    FOR ALL
    TO PUBLIC
    USING (org_id = current_setting('app.current_org_id')::uuid);
```

**Tables using this pattern:**
- `users`, `mcp_instances`, `api_keys`, `invoices`, `support_tickets`, etc.

### 2. User-Based Isolation

Used for user-specific data (2FA secrets, sessions, security settings):

```sql
CREATE POLICY user_isolation ON user_2fa
    FOR ALL
    TO PUBLIC
    USING (user_id = current_setting('app.current_user_id')::uuid);
```

**Tables using this pattern:**
- `user_2fa`, `user_sessions`, `user_security_settings`, `user_presence`

### 3. Superadmin Access

Superadmins can access data from all organizations using a special policy:

```sql
CREATE POLICY superadmin_access ON table_name
    FOR ALL
    TO PUBLIC
    USING (
        current_setting('app.current_org_id')::uuid = org_id
        OR
        current_setting('app.is_superadmin', true)::boolean = true
    );
```

**Critical:** This policy is **only effective** with `FORCE ROW LEVEL SECURITY` enabled!

---

## Setting RLS Context Variables

Before executing queries, the application sets PostgreSQL session variables:

```rust
// Set before each query
sqlx::query("SELECT set_config('app.current_user_id', $1, false)")
    .bind(user_id.to_string())
    .execute(&pool).await?;

sqlx::query("SELECT set_config('app.current_org_id', $1, false)")
    .bind(org_id.to_string())
    .execute(&pool).await?;

sqlx::query("SELECT set_config('app.is_superadmin', $1, false)")
    .bind(is_superadmin.to_string())
    .execute(&pool).await?;
```

These variables are used by RLS policies to determine access.

---

## Table Categories

### Critical Security Tables (MUST have FORCE RLS)

| Table | Purpose | RLS Policy |
|-------|---------|------------|
| `admin_audit_log` | Tamper-proof audit trail | Org + Superadmin |
| `auth_audit_log` | Authentication events | Org + Superadmin |
| `user_2fa` | 2FA secrets | User-only |
| `user_2fa_backup_codes` | Backup codes | User-only |
| `user_security_settings` | Security preferences | User-only |
| `payment_attempts` | Payment security | Org + Superadmin |
| `user_sessions` | JWT session tracking | User-only |

### Organizational Data (MUST have FORCE RLS)

| Table | Purpose | RLS Policy |
|-------|---------|------------|
| `users` | User accounts | Org + Superadmin |
| `organizations` | Organization profiles | Org-only |
| `organization_members` | Membership records | Org + Superadmin |
| `api_keys` | API authentication | Org + Superadmin |
| `mcp_instances` | MCP server instances | Org + Superadmin |
| `invoices` | Billing invoices | Org + Superadmin |
| `subscriptions` | Subscription records | Org + Superadmin |

### Analytics & Tracking (MUST have FORCE RLS)

All analytics tables (`analytics_events`, `analytics_page_views`, etc.) enforce org-based isolation.

### Support & Ticketing (MUST have FORCE RLS)

All support ticket tables (`support_tickets`, `ticket_messages`, etc.) enforce org-based isolation.

---

## Verification & Testing

### Migration Verification

Every RLS migration includes automatic verification:

```sql
DO $$
DECLARE
    missing_tables TEXT;
BEGIN
    SELECT string_agg(t.tablename, ', ')
    INTO missing_tables
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    WHERE c.relrowsecurity = true
      AND c.relforcerowsecurity = false;

    IF missing_tables IS NOT NULL THEN
        RAISE EXCEPTION 'Tables missing FORCE RLS: %', missing_tables;
    END IF;
END $$;
```

### Automated Tests

Located in `crates/api/src/security/rls_tests.rs`:

1. **test_critical_tables_have_force_rls** - Verifies critical security tables
2. **test_all_rls_tables_have_force_rls** - Ensures no table is vulnerable
3. **test_rls_policies_exist** - Confirms policies are defined
4. **test_rls_configuration_summary** - Provides RLS status overview

Run tests:
```bash
cargo test --lib test_rls
```

### Manual Verification

Check RLS status for a specific table:

```sql
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS force_rls,
    COUNT(p.polname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname = 'users'
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity;
```

Expected output:
```
 table_name | rls_enabled | force_rls | policy_count
------------+-------------+-----------+--------------
 users      | t           | t         | 2
```

---

## Common Mistakes & How to Avoid Them

### ❌ Mistake 1: Forgetting FORCE RLS

```sql
-- WRONG (Vulnerable to bypass):
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
```

```sql
-- CORRECT:
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
```

### ❌ Mistake 2: Using USING clause for INSERT

```sql
-- WRONG (Prevents all INSERTs):
CREATE POLICY org_policy ON users
    FOR ALL
    USING (org_id = current_setting('app.current_org_id')::uuid);
```

```sql
-- CORRECT (Allows INSERTs for current org):
CREATE POLICY org_policy ON users
    FOR ALL
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
```

### ❌ Mistake 3: Not Setting Session Variables

```sql
-- WRONG (RLS policies will fail):
SELECT * FROM users;  -- Error: app.current_org_id not set
```

```rust
// CORRECT (Set variables first):
sqlx::query("SELECT set_config('app.current_org_id', $1, false)")
    .bind(org_id.to_string())
    .execute(&pool).await?;

sqlx::query("SELECT * FROM users").fetch_all(&pool).await?;
```

---

## SOC 2 Compliance Mapping

### CC6.1 - Logical Access Security

**Control:** The entity restricts logical access through the use of access control software and rule sets.

**Evidence:**
- ✅ All 65+ tables have FORCE RLS enabled
- ✅ Automated tests verify RLS configuration
- ✅ Migration verification prevents misconfigurations
- ✅ Documentation of RLS architecture and policies

### CC6.6 - Logical Access - Segregation of Duties

**Control:** The entity segregates incompatible functions and duties.

**Evidence:**
- ✅ Superadmin access explicitly controlled via RLS policies
- ✅ Org-level isolation prevents cross-organization access
- ✅ User-level isolation for sensitive data (2FA, sessions)

---

## Incident Response

### If RLS Bypass is Suspected

1. **Immediate Actions:**
   ```sql
   -- Check which tables are vulnerable:
   SELECT tablename
   FROM pg_tables t
   JOIN pg_class c ON c.relname = t.tablename
   WHERE c.relrowsecurity = true
     AND c.relforcerowsecurity = false;
   ```

2. **Apply Emergency Fix:**
   ```sql
   ALTER TABLE vulnerable_table FORCE ROW LEVEL SECURITY;
   ```

3. **Audit Access:**
   ```sql
   SELECT * FROM admin_audit_log
   WHERE created_at > NOW() - INTERVAL '24 hours'
   ORDER BY created_at DESC;
   ```

4. **Notify Security Team** and document the incident.

---

## Maintenance

### Adding a New Table

When creating a new table, **always** include RLS:

```sql
CREATE TABLE new_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    -- ... other columns
);

-- CRITICAL: Always add both!
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_table FORCE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY org_isolation ON new_table
    FOR ALL
    TO PUBLIC
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
```

### Checklist for New Tables

- [ ] `ENABLE ROW LEVEL SECURITY` added
- [ ] `FORCE ROW LEVEL SECURITY` added ← **CRITICAL**
- [ ] RLS policy created
- [ ] Policy tested with superadmin user
- [ ] Added to RLS tests if critical
- [ ] Migration includes verification block

---

## References

- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [OWASP: Multi-Tenancy Security](https://cheatsheetseries.owasp.org/cheatsheets/Multitenant_Architecture_Cheat_Sheet.html)
- SOC 2 Trust Services Criteria: CC6.1, CC6.6
- Migration: `20260103000001_apply_force_rls_all_tables.sql`
- Tests: `crates/api/src/security/rls_tests.rs`

---

**Document Owner:** Security Team
**Review Frequency:** Quarterly
**Next Review:** April 2, 2026
