# SQL Injection Prevention

## Overview

This document describes PlexMCP's defense-in-depth approach to preventing SQL injection vulnerabilities.

## Current Security Posture

**Status**: ✅ **SECURE** - No SQL injection vulnerabilities found in production code
**Last Audit**: January 1, 2026
**Auditor**: Security Team (3 parallel exploration agents)

## Defense Layers

### Layer 1: Parameterized Queries (Primary Defense)

All database queries use **sqlx** with parameterized queries:

```rust
// ✅ SECURE: Uses parameterized query with placeholders
let users = sqlx::query!(
    "SELECT * FROM users WHERE email = $1 AND active = $2",
    email,
    true
)
.fetch_all(&pool)
.await?;

// ✅ SECURE: Dynamic WHERE clause with numbered placeholders
let query = format!(
    "SELECT * FROM logs WHERE {} ORDER BY created_at DESC LIMIT ${}",
    where_clauses.join(" AND "),  // Contains "$1", "$2", etc.
    param_count
);
let mut query_builder = sqlx::query_as(&query);
query_builder = query_builder.bind(log_type);
query_builder = query_builder.bind(actor_id);
```

**Never** directly interpolate user input into SQL:

```rust
// ❌ VULNERABLE: Direct string interpolation
let query = format!("SELECT * FROM users WHERE email = '{}'", user_email);

// ❌ VULNERABLE: User input in WHERE clause
let query = format!("SELECT * FROM logs WHERE org_id = '{}'", params.org_id);
```

### Layer 2: Input Validation (Defense in Depth)

Even though queries use parameterization, we validate inputs to provide defense-in-depth:

**File:** `crates/api/src/routes/superadmin.rs:118-142`

```rust
/// Validate log_type parameter against whitelist
fn validate_log_type(log_type: &str) -> ApiResult<()> {
    const VALID_LOG_TYPES: &[&str] = &["auth", "admin", "mcp"];
    if VALID_LOG_TYPES.contains(&log_type) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid log_type '{}'. Must be one of: auth, admin, mcp",
            log_type
        )))
    }
}

/// Validate severity parameter against whitelist
fn validate_severity(severity: &str) -> ApiResult<()> {
    const VALID_SEVERITIES: &[&str] = &["info", "warning", "critical"];
    if VALID_SEVERITIES.contains(&severity) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid severity '{}'. Must be one of: info, warning, critical",
            severity
        )))
    }
}
```

### Layer 3: Type Safety

Rust's type system and sqlx provide compile-time SQL validation:

- **UUID validation**: `Path(user_id): Path<Uuid>` - automatically validated
- **Enum types**: Database enums validated by sqlx at compile time
- **Compile-time SQL checking**: `cargo sqlx prepare` validates all queries

### Layer 4: Automated Testing

Comprehensive security tests verify SQL injection payloads are blocked:

**File:** `crates/api/src/routes/superadmin.rs:867-895`

```rust
#[test]
fn test_sql_injection_payloads_blocked() {
    let sql_injection_payloads = vec![
        "admin' OR '1'='1",
        "admin'; DROP TABLE users; --",
        "' UNION SELECT NULL, NULL, NULL --",
        "' OR 1=1 --",
        "admin' /*",
        "' OR 'x'='x",
        "'; EXEC xp_cmdshell('dir'); --",
        "1' AND 1=1 --",
        "' OR EXISTS(SELECT * FROM users) --",
    ];

    for payload in sql_injection_payloads {
        assert!(validate_log_type(payload).is_err());
        assert!(validate_severity(payload).is_err());
    }
}
```

## Secure Patterns

### Pattern 1: Static Queries (Preferred)

Use sqlx macros with compile-time validation:

```rust
sqlx::query!(
    "SELECT id, email FROM users WHERE id = $1",
    user_id
)
.fetch_one(&pool)
.await?
```

### Pattern 2: Dynamic WHERE Clauses

When building dynamic queries, use numbered placeholders:

```rust
let mut where_clauses = Vec::new();
let mut param_count = 1;

if params.email.is_some() {
    where_clauses.push(format!("email ILIKE ${}", param_count));
    param_count += 1;
}

if params.active.is_some() {
    where_clauses.push(format!("active = ${}", param_count));
    param_count += 1;
}

let where_clause = if where_clauses.is_empty() {
    "TRUE".to_string()
} else {
    where_clauses.join(" AND ")
};

let query = format!("SELECT * FROM users WHERE {}", where_clause);
let mut query_builder = sqlx::query_as(&query);

if let Some(email) = &params.email {
    query_builder = query_builder.bind(format!("%{}%", email));
}
if let Some(active) = params.active {
    query_builder = query_builder.bind(active);
}

let users = query_builder.fetch_all(&pool).await?;
```

### Pattern 3: Whitelist Validation

For enum-like parameters, always validate against a whitelist:

```rust
fn validate_role(role: &str) -> ApiResult<()> {
    const VALID_ROLES: &[&str] = &["user", "admin", "staff"];
    if !VALID_ROLES.contains(&role) {
        return Err(ApiError::BadRequest(format!(
            "Invalid role '{}'. Must be one of: {:?}",
            role, VALID_ROLES
        )));
    }
    Ok(())
}
```

## Common Vulnerabilities to Avoid

### 1. String Interpolation in SQL

```rust
// ❌ NEVER DO THIS
let query = format!("SELECT * FROM users WHERE email = '{}'", email);

// ✅ ALWAYS USE PARAMETERIZATION
let user = sqlx::query!("SELECT * FROM users WHERE email = $1", email)
    .fetch_one(&pool)
    .await?;
```

### 2. Building Dynamic Table/Column Names

```rust
// ❌ VULNERABLE: User controls table name
let query = format!("SELECT * FROM {}", params.table_name);

// ✅ SAFE: Whitelist table names
fn get_audit_table(log_type: &str) -> ApiResult<&'static str> {
    match log_type {
        "auth" => Ok("auth_audit_log"),
        "admin" => Ok("admin_audit_log"),
        "mcp" => Ok("mcp_request_log"),
        _ => Err(ApiError::BadRequest("Invalid log type".into()))
    }
}
```

### 3. LIKE Wildcards with User Input

```rust
// ⚠️ CAREFUL: User input in LIKE can cause performance issues
// Always add wildcards on the application side, not user input
let email_pattern = format!("%{}%", email);
sqlx::query!("SELECT * FROM users WHERE email ILIKE $1", email_pattern)
    .fetch_all(&pool)
    .await?;
```

## Verification Checklist

Before deploying new query code:

- [ ] All queries use `$1`, `$2`, etc. placeholders (not `{}` string interpolation)
- [ ] All user input is bound with `.bind()` methods
- [ ] Enum-like parameters validated against whitelists
- [ ] UUIDs use proper `Uuid` type (not strings)
- [ ] Dynamic queries reviewed for safety
- [ ] Security tests added for new query parameters
- [ ] `cargo sqlx prepare` runs successfully

## Tools

### Static Analysis

```bash
# Check for format! with SQL keywords
rg "format!\(.*SELECT|UPDATE|INSERT|DELETE" --type rust

# Verify all queries use parameterization
rg "sqlx::query" crates/api/src/routes/ -A 3
```

### Testing

```bash
# Run all security tests
cargo test --lib -- security

# Run superadmin SQL injection tests
cargo test --lib superadmin::tests::test_sql_injection
```

## Audit Trail

| Date | Auditor | Findings | Status |
|------|---------|----------|--------|
| 2026-01-01 | Security Team (3 agents) | No SQL injection vulnerabilities found | ✅ PASS |
| 2026-01-01 | Security Team | Added defense-in-depth validation | ✅ PASS |

## References

- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [sqlx Documentation](https://docs.rs/sqlx/)
- File: `crates/api/src/routes/superadmin.rs` (reference implementation)
- File: `crates/api/src/routes/admin.rs` (additional examples)
