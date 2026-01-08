# PlexMCP Database Connection Reference

**CRITICAL:** This document defines the ONLY valid Supabase database connections for PlexMCP.

---

## ✅ CORRECT PlexMCP Database

**Project ID:** `yjstfwfdmybeaadauell`
**Password:** `YOUR_DATABASE_PASSWORD`
**Region:** `us-east-2` (AWS)

### Connection Strings (ALL VALID)

#### 1. Direct Connection (Default)
```
postgresql://postgres:YOUR_DATABASE_PASSWORD@db.yjstfwfdmybeaadauell.supabase.co:5432/postgres
```
- **Use for:** Local development, migrations, administrative tasks
- **Port:** 5432 (standard PostgreSQL)
- **Connection limit:** 60 concurrent connections

#### 2. Transaction Pooler (Production - Session Mode)
```
postgresql://postgres.yjstfwfdmybeaadauell:YOUR_DATABASE_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres
```
- **Use for:** Production API (Fly.io deployment)
- **Port:** 5432 (session pooling mode)
- **Connection limit:** 200+ connections
- **Features:** Full PostgreSQL compatibility

#### 3. Transaction Pooler (Production - Transaction Mode)
```
postgresql://postgres.yjstfwfdmybeaadauell:YOUR_DATABASE_PASSWORD@aws-1-us-east-2.pooler.supabase.com:6543/postgres
```
- **Use for:** High-throughput scenarios
- **Port:** 6543 (transaction pooling mode)
- **Connection limit:** 1000+ connections
- **Limitations:** No prepared statements, no session-level features

---

## ❌ WRONG DATABASE - DO NOT USE

**Project ID:** `rbfptjbqqkftndviuqmx` ← **THIS IS WRONG!**
**Project Name:** Axon Hub (old discontinued project)
**Password:** `GKR4fvDpQdXJRhJf` ← **DO NOT USE!**
**Region:** `us-east-1`

### ⛔ NEVER Use These Connections

```
❌ postgresql://postgres:GKR4fvDpQdXJRhJf@db.rbfptjbqqkftndviuqmx.supabase.co:5432/postgres
❌ postgresql://postgres.rbfptjbqqkftndviuqmx:*@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

**Why these are wrong:**
- This is the OLD Axon Hub project database
- It is NOT the PlexMCP database
- Using this database has caused hours of debugging
- The PlexMCP application has runtime protection that will PANIC if this database is detected

**Protection in place:**
- `crates/api/src/main.rs` contains validation code that will crash the application at startup if the wrong database URL is detected
- This prevents accidental deployment to the wrong database

---

## Runtime Validation

The PlexMCP API server validates the database URL at startup:

```rust
// From crates/api/src/main.rs
const REQUIRED_DB_HOST: &str = "yjstfwfdmybeaadauell";
const WRONG_DB_HOST: &str = "rbfptjbqqkftndviuqmx";

if config.database_url.contains(WRONG_DB_HOST) {
    panic!(
        "❌ WRONG DATABASE DETECTED! Attempting to use db.{}.supabase.co - THIS IS THE WRONG DATABASE!",
        WRONG_DB_HOST
    );
}
```

If you see this panic message, **immediately check your `.env` file and Fly.io secrets**.

---

## Environment Configuration

### Local Development (.env)

```bash
# PlexMCP Production Database (CORRECT)
DATABASE_URL=postgresql://postgres:YOUR_DATABASE_PASSWORD@db.yjstfwfdmybeaadauell.supabase.co:5432/postgres

# Supabase API Configuration
SUPABASE_URL=https://yjstfwfdmybeaadauell.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
```

### Fly.io Production Secrets

```bash
# Set the correct database URL on Fly.io
fly secrets set DATABASE_URL="postgresql://postgres.yjstfwfdmybeaadauell:YOUR_DATABASE_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

# Verify it's set correctly
fly secrets list | grep DATABASE_URL
```

---

## Quick Verification

### Check Database Connection

```bash
# Verify you're connecting to the CORRECT database
PGPASSWORD="YOUR_DATABASE_PASSWORD" psql -h db.yjstfwfdmybeaadauell.supabase.co -U postgres -d postgres -c "SELECT current_database(), current_user, inet_server_addr();"
```

**Expected output should show:**
- `current_database`: `postgres`
- `current_user`: `postgres`
- `inet_server_addr`: An IP address in the `us-east-2` region

### Check Fly.io Configuration

```bash
# List all secrets (values are redacted)
fly secrets list

# Check DATABASE_URL specifically (shows partial value)
fly secrets list | grep DATABASE_URL
```

**Expected:** Should show `yjstfwfdmybeaadauell` in the URL

---

## Common Mistakes to Avoid

1. **Copying old database URLs from documentation**
   - Always use the URLs from this file
   - Old documentation may contain the wrong URL

2. **Using direct connection in production**
   - Fly.io should use the transaction pooler (port 5432 or 6543)
   - Direct connection (db.yjstfwfdmybeaadauell.supabase.co) is for local dev only

3. **Mixing up passwords**
   - PlexMCP password: `YOUR_DATABASE_PASSWORD` ✅
   - Axon Hub password: `GKR4fvDpQdXJRhJf` ❌

4. **Using the wrong region**
   - PlexMCP region: `us-east-2` (aws-1-us-east-2.pooler) ✅
   - Axon Hub region: `us-east-1` (aws-0-us-east-1.pooler) ❌

---

## Troubleshooting

### "Wrong database detected" panic on startup

**Cause:** Your DATABASE_URL contains `rbfptjbqqkftndviuqmx`

**Fix:**
1. Check `.env` file and replace with correct URL
2. Check Fly.io secrets: `fly secrets list`
3. Update Fly.io secret if wrong:
   ```bash
   fly secrets set DATABASE_URL="postgresql://postgres.yjstfwfdmybeaadauell:YOUR_DATABASE_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
   ```

### Tables/data not found

**Cause:** You might be connected to the wrong database

**Verify:**
```bash
# Check which database you're connected to
PGPASSWORD="YOUR_DATABASE_PASSWORD" psql -h db.yjstfwfdmybeaadauell.supabase.co -U postgres -d postgres -c "SELECT current_database();"
```

**Should return:** `postgres`

### Migration applied to wrong database

**Prevention:** Always verify database connection before running migrations:
```bash
# Step 1: Verify connection
PGPASSWORD="YOUR_DATABASE_PASSWORD" psql -h db.yjstfwfdmybeaadauell.supabase.co -U postgres -d postgres -c "\conninfo"

# Step 2: Check project ID in output
# Should show: "host=db.yjstfwfdmybeaadauell.supabase.co"

# Step 3: Run migration only if correct
sqlx migrate run --database-url "postgresql://postgres:YOUR_DATABASE_PASSWORD@db.yjstfwfdmybeaadauell.supabase.co:5432/postgres"
```

---

## Related Documentation

- [Supabase Dashboard](https://supabase.com/dashboard/project/yjstfwfdmybeaadauell)
- [Testing Guide](../TESTING_GUIDE.md) - Database testing procedures
- [Known Issues](../KNOWN_ISSUES.md) - Database-related known issues
- [Deployment Guide](../DEPLOYMENT.md) - Production deployment with correct database

---

**Last Updated:** 2025-12-31
**Maintained By:** PlexMCP Team

**⚠️ CRITICAL REMINDER:**
- ONLY use `yjstfwfdmybeaadauell` for PlexMCP
- NEVER use `rbfptjbqqkftndviuqmx` (Axon Hub - wrong project)
- When in doubt, check this document
