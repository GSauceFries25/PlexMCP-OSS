# TOTP Encryption Key Rotation Procedure

## Overview

The TOTP encryption key (`TOTP_ENCRYPTION_KEY`) is used to encrypt 2FA secrets stored in the database. This document describes the secure key rotation procedure.

## Security Requirements

- **Key Length**: Must be exactly 64 hexadecimal characters (32 bytes)
- **Key Generation**: Use cryptographically secure random generation
- **Key Storage**: Store in environment variables, never commit to source control
- **Key Validation**: Application validates key on startup and rejects known insecure values

## Generating a New Key

Generate a new secure key using OpenSSL:

```bash
openssl rand -hex 32
```

This produces a 64-character hexadecimal string suitable for use as `TOTP_ENCRYPTION_KEY`.

## Key Rotation Procedure

### Step 1: Prepare New Key

1. Generate a new encryption key:
   ```bash
   NEW_KEY=$(openssl rand -hex 32)
   echo "New TOTP encryption key: $NEW_KEY"
   ```

2. Store the new key securely (e.g., password manager, secrets vault)

### Step 2: Database Migration

Since TOTP secrets are encrypted with the old key, you must re-encrypt existing secrets:

1. Create a database backup:
   ```bash
   pg_dump $DATABASE_URL > backup_before_totp_rotation_$(date +%Y%m%d_%H%M%S).sql
   ```

2. Deploy a one-time migration script that:
   - Decrypts all `user_2fa.totp_secret` values using the **old key**
   - Re-encrypts them using the **new key**
   - Updates the database atomically in a transaction

Example migration script (`crates/api/src/bin/rotate-totp-key.rs`):

```rust
use plexmcp_api::auth::totp;
use sqlx::PgPool;
use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let old_key = env::var("OLD_TOTP_KEY")?;
    let new_key = env::var("NEW_TOTP_KEY")?;
    let database_url = env::var("DATABASE_URL")?;

    let pool = PgPool::connect(&database_url).await?;

    // Begin transaction
    let mut tx = pool.begin().await?;

    // Fetch all users with 2FA enabled
    let users = sqlx::query!(
        "SELECT user_id, totp_secret FROM user_2fa WHERE totp_secret IS NOT NULL FOR UPDATE"
    )
    .fetch_all(&mut *tx)
    .await?;

    println!("Rotating TOTP keys for {} users", users.len());

    for user in users {
        // Decrypt with old key
        let decrypted = totp::decrypt_totp_secret(&user.totp_secret, &old_key)?;

        // Re-encrypt with new key
        let re_encrypted = totp::encrypt_totp_secret(&decrypted, &new_key)?;

        // Update database
        sqlx::query!(
            "UPDATE user_2fa SET totp_secret = $1 WHERE user_id = $2",
            re_encrypted,
            user.user_id
        )
        .execute(&mut *tx)
        .await?;
    }

    // Commit transaction
    tx.commit().await?;

    println!("Successfully rotated TOTP encryption keys for {} users", users.len());
    Ok(())
}
```

### Step 3: Deploy New Key

1. Update environment variables in production:
   ```bash
   # Fly.io example
   fly secrets set TOTP_ENCRYPTION_KEY="<new-key-here>"

   # Or update .env file for other deployments
   ```

2. Restart the application to load the new key

3. Verify startup logs show successful key validation

### Step 4: Validation

1. Test 2FA login with an existing user
2. Test enrolling new 2FA device
3. Verify all TOTP codes validate correctly

### Step 5: Cleanup

1. Securely delete the old key from all locations
2. Document the rotation in your security audit log
3. Update any backup/disaster recovery documentation with the new key's existence (not the value)

## Emergency Key Recovery

If the TOTP encryption key is lost:

1. **No Recovery Possible**: Encrypted TOTP secrets cannot be decrypted
2. **User Impact**: All users will need to re-enroll their 2FA devices
3. **Procedure**:
   - Generate a new key
   - Deploy with the new key
   - Delete all rows from `user_2fa` table
   - Notify users they must re-enable 2FA
   - Optionally force re-authentication

## Key Validation Rules

The application enforces these rules on startup:

1. **Required**: `TOTP_ENCRYPTION_KEY` environment variable must be set
2. **Length**: Must be exactly 64 hexadecimal characters
3. **Format**: Must contain only valid hex characters (0-9, a-f, A-F)
4. **Security**: Known insecure values are rejected:
   - `0000...0000` (all zeros)
   - `1111...1111` (all ones)
   - `ffff...ffff` (all F's)

## Compliance Notes

- **SOC 2**: Key rotation should be performed annually or when an employee with key access leaves
- **Audit Trail**: Document all key rotations in the `admin_audit_log` table
- **Access Control**: Only superadmins should have access to the encryption key

## References

- File: `crates/api/src/config.rs` (key validation logic)
- File: `crates/api/src/auth/totp.rs` (encryption/decryption functions)
- Standard: TOTP defined in RFC 6238
- Encryption: AES-256-GCM with authenticated encryption
