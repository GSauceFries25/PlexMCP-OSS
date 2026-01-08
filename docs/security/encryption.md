# Encryption Documentation

**Document Version:** 1.0
**Last Updated:** January 1, 2026
**Review Cycle:** Annually
**Owner:** Security Team

---

## Table of Contents

1. [Overview](#overview)
2. [Encryption at Rest](#encryption-at-rest)
3. [Encryption in Transit](#encryption-in-transit)
4. [Key Management](#key-management)
5. [Compliance](#compliance)
6. [Verification](#verification)

---

## Overview

PlexMCP implements comprehensive encryption to protect data both at rest and in transit. This document details our encryption architecture, key management practices, and compliance with industry standards.

### Encryption Standards

| Layer | Method | Algorithm | Key Size | Standard |
|-------|--------|-----------|----------|----------|
| **Database** | Transparent Data Encryption (TDE) | AES-256-GCM | 256-bit | FIPS 140-2 Level 1 |
| **Backups** | Server-Side Encryption (SSE) | AES-256 | 256-bit | AWS SSE-S3 |
| **Transport** | TLS | TLS 1.3 / 1.2 | 256-bit (ECDHE) | RFC 8446 |
| **Passwords** | Argon2id | Argon2id | - | OWASP recommended |
| **API Keys** | HMAC-SHA256 | SHA-256 | 256-bit | NIST FIPS 180-4 |
| **2FA Secrets** | AES-256-GCM | AES-256-GCM | 256-bit | NIST SP 800-38D |

### Compliance Standards

- **NIST SP 800-175B:** Guideline for Using Cryptographic Standards
- **FIPS 140-2:** Federal Information Processing Standard for cryptographic modules
- **OWASP:** Cryptographic Storage Cheat Sheet
- **SOC 2:** CC6.6 (Encryption at Rest), CC6.7 (Encryption in Transit)
- **GDPR:** Article 32 (Security of Processing)

---

## Encryption at Rest

### Database Encryption (PostgreSQL via Supabase)

**Provider:** Supabase
**Method:** Transparent Data Encryption (TDE)
**Algorithm:** AES-256-GCM
**Key Management:** AWS KMS (managed by Supabase)

#### What is Encrypted

All data stored in PostgreSQL is encrypted at rest, including:

- User accounts and authentication data
- Organization information
- API keys (doubly encrypted: HMAC + TDE)
- MCP configurations
- Audit logs
- Billing and subscription data
- Support tickets and messages
- Email routing rules

#### How It Works

```
┌──────────────┐
│ Application  │
│   (Write)    │
└──────┬───────┘
       │ Plaintext
       ▼
┌──────────────────┐
│ Database Engine  │
│  (Transparent    │
│   Encryption)    │
└──────┬───────────┘
       │ AES-256-GCM
       ▼
┌──────────────────┐
│  Disk Storage    │
│  (Encrypted)     │
└──────────────────┘
```

- **Transparent:** Application code doesn't need to handle encryption
- **Automatic:** All writes encrypted before hitting disk
- **Seamless:** All reads decrypted automatically
- **Key Rotation:** Managed automatically by AWS KMS

#### Verification

To verify database encryption is enabled:

```sql
-- Check if database encryption is active (Supabase managed)
-- This requires superuser access (contact Supabase support)
```

For Supabase-hosted databases, encryption is enabled by default and cannot be disabled.

---

### Backup Encryption (AWS S3)

**Provider:** AWS S3
**Method:** Server-Side Encryption (SSE-S3)
**Algorithm:** AES-256
**Key Management:** AWS-managed keys

#### What is Encrypted

- Database backup files (`.sql.gz`)
- Backup checksums (`.sha256` files)
- Archived audit logs

#### How It Works

```bash
# Backup script automatically encrypts on upload
aws s3 cp backup.sql.gz s3://plexmcp-backups/ \
    --server-side-encryption AES256 \
    --storage-class STANDARD_IA
```

**Encryption Layers:**
1. **Compression:** gzip compression reduces size (~80% reduction)
2. **S3 Encryption:** AES-256 encryption by S3 service
3. **Optional GPG:** Additional GPG encryption for highly sensitive backups

#### Lifecycle Management

- **Retention:** 30 days operational backups, 1 year archives
- **Transition:** STANDARD_IA → GLACIER after 90 days
- **Deletion:** Automatic after retention period expires
- **Versioning:** S3 versioning enabled (7-day recovery window)

#### Verification

```bash
# Verify S3 bucket encryption
aws s3api get-bucket-encryption --bucket plexmcp-backups

# Output should show:
# {
#     "ServerSideEncryptionConfiguration": {
#         "Rules": [{
#             "ApplyServerSideEncryptionByDefault": {
#                 "SSEAlgorithm": "AES256"
#             }
#         }]
#     }
# }
```

---

### Application Secrets Encryption

**Method:** Environment variables (encrypted at OS level)
**Provider:** Fly.io Secrets
**Algorithm:** AES-256-GCM (Fly.io managed)

#### What is Encrypted

- Database connection strings
- Stripe API keys
- Resend API key
- JWT signing secret
- Supabase JWT secret
- TOTP encryption key
- API key HMAC secret
- Slack webhook URLs

#### How It Works

```bash
# Set encrypted secret (encrypted before storage)
fly secrets set DATABASE_URL="postgresql://..."

# Secrets are:
# 1. Encrypted with AES-256-GCM
# 2. Stored in Fly.io's secret store
# 3. Injected into environment at runtime
# 4. Never written to disk in plaintext
```

**Security Features:**
- Secrets never logged
- Secrets never appear in `fly.toml`
- Secrets automatically rotated with app restarts
- Audit log for secret access

#### Verification

```bash
# List secrets (values are redacted)
fly secrets list

# Output shows names only:
# DATABASE_URL
# STRIPE_SECRET_KEY
# JWT_SECRET
```

---

### Field-Level Encryption

#### 2FA Secrets (TOTP)

**Algorithm:** AES-256-GCM
**Key:** TOTP_ENCRYPTION_KEY (environment variable)
**Library:** `aes-gcm` Rust crate

**Implementation:**

```rust
// crates/api/src/routes/two_factor.rs

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};

// Encrypt TOTP secret before storing
fn encrypt_totp_secret(secret: &str, key: &[u8]) -> Result<Vec<u8>, Error> {
    let cipher = Aes256Gcm::new_from_slice(key)?;
    let nonce = Nonce::from_slice(random_nonce); // 96-bit random nonce
    let ciphertext = cipher.encrypt(nonce, secret.as_bytes())?;
    Ok(ciphertext)
}

// Decrypt TOTP secret when verifying
fn decrypt_totp_secret(ciphertext: &[u8], key: &[u8]) -> Result<String, Error> {
    let cipher = Aes256Gcm::new_from_slice(key)?;
    let plaintext = cipher.decrypt(nonce, ciphertext)?;
    Ok(String::from_utf8(plaintext)?)
}
```

**Why Field-Level Encryption?**
- Defense in depth: Even if database is compromised, 2FA secrets remain encrypted
- TOTP secrets are extremely sensitive (can bypass 2FA if stolen)
- Separate encryption key reduces blast radius

**Key Rotation:**
- TOTP encryption key should be rotated annually
- Procedure: Decrypt all secrets with old key, re-encrypt with new key
- Documented in: `docs/operations/key-rotation.md`

---

## Encryption in Transit

### TLS Configuration

**Protocol:** TLS 1.3 (preferred), TLS 1.2 (fallback)
**Certificate:** Let's Encrypt (RSA 2048-bit)
**Renewal:** Automatic (Fly.io managed)
**HSTS:** Enabled with preload (max-age=31536000)

#### Supported Cipher Suites (Ordered by Preference)

**TLS 1.3:**
```
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256
TLS_AES_128_GCM_SHA256
```

**TLS 1.2 (Fallback):**
```
ECDHE-RSA-AES256-GCM-SHA384
ECDHE-RSA-AES128-GCM-SHA256
ECDHE-RSA-CHACHA20-POLY1305
```

**Explicitly Disabled:**
- SSLv2, SSLv3, TLS 1.0, TLS 1.1 (vulnerable)
- RC4, 3DES, MD5, SHA1 (weak algorithms)
- NULL ciphers, EXPORT ciphers, anonymous ciphers

#### HTTP Strict Transport Security (HSTS)

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Configuration:**
- `max-age=31536000`: 1 year duration
- `includeSubDomains`: Apply to all subdomains
- `preload`: Submit to HSTS preload list

**Benefits:**
- Prevents downgrade attacks
- Prevents cookie hijacking
- Prevents man-in-the-middle attacks
- Forces HTTPS for all connections

#### Certificate Management

**Provider:** Let's Encrypt via Fly.io
**Type:** Domain Validation (DV)
**Algorithm:** RSA 2048-bit
**Validity:** 90 days
**Renewal:** Automatic (60 days before expiry)

**Domains Covered:**
- `api.plexmcp.com`
- `*.plexmcp.com` (wildcard for subdomains)

**Certificate Transparency:**
- All certificates logged to CT logs
- Monitored via: https://crt.sh/?q=plexmcp.com

#### Verification

**Test TLS Configuration:**

```bash
# Test TLS version and ciphers
openssl s_client -connect api.plexmcp.com:443 -tls1_3

# Expected output:
# Protocol  : TLSv1.3
# Cipher    : TLS_AES_256_GCM_SHA384
```

**SSL Labs Test:**

```bash
# Run automated SSL Labs scan
curl https://api.ssllabs.com/api/v3/analyze?host=api.plexmcp.com
```

**Target Grade:** A+ (current: A+)

**Scorecard:**
- Certificate: 100/100
- Protocol Support: 100/100
- Key Exchange: 90/100
- Cipher Strength: 90/100

---

### Database Connection Encryption

**Protocol:** TLS 1.3
**Verification:** `sslmode=require` in connection string

```bash
# Connection string format
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
```

**SSL Modes:**
- `require`: Encrypt connection (default for PlexMCP)
- `verify-ca`: Verify server certificate
- `verify-full`: Verify server certificate + hostname

**Current Configuration:** `sslmode=require`

**Why not verify-full?**
- Supabase uses connection pooling with PgBouncer
- PgBouncer doesn't present same certificate as backend
- `require` still encrypts connection end-to-end

---

### API Communication

**External APIs (Stripe, Resend, Slack):**
- TLS 1.3 for all outbound HTTPS requests
- Certificate validation enabled
- Connection pooling with keep-alive

**MCP Proxy:**
- Upstream MCP servers: TLS recommended but not enforced
- PlexMCP → User: Always TLS 1.3
- User → MCP (via proxy): Inherits user's TLS settings

---

## Key Management

### Key Types and Storage

| Key Type | Purpose | Storage | Rotation Period |
|----------|---------|---------|-----------------|
| **Database Master Key** | TDE encryption | AWS KMS (Supabase managed) | Automatic |
| **JWT Signing Secret** | JWT signature | Fly.io Secrets | Annually |
| **Supabase JWT Secret** | Verify Supabase tokens | Fly.io Secrets | Never (provided by Supabase) |
| **API Key HMAC Secret** | HMAC signing | Fly.io Secrets | Every 2 years |
| **TOTP Encryption Key** | Encrypt 2FA secrets | Fly.io Secrets | Annually |
| **Stripe API Key** | Payment processing | Fly.io Secrets | As needed |
| **S3 Encryption Keys** | Backup encryption | AWS-managed | Automatic |

### Key Rotation Procedures

#### JWT Signing Secret Rotation (Annual)

```bash
# 1. Generate new secret
new_secret=$(openssl rand -hex 32)

# 2. Set new secret (old tokens still work during transition)
fly secrets set JWT_SECRET="$new_secret"

# 3. Deploy application (starts issuing tokens with new secret)
fly deploy

# 4. Wait 24 hours (old tokens expire)
# All users will be re-issued tokens on next login

# 5. Verify no errors in logs
fly logs --app plexmcp-api | grep "JWT"
```

#### TOTP Encryption Key Rotation (Annual)

```bash
# 1. Generate new encryption key
new_key=$(openssl rand -hex 32)

# 2. Run migration script (decrypt with old, re-encrypt with new)
./scripts/rotate-totp-key.sh "$new_key"

# 3. Set new key in secrets
fly secrets set TOTP_ENCRYPTION_KEY="$new_key"

# 4. Deploy application
fly deploy

# 5. Verify 2FA still works for test users
```

**Migration Script:** `scripts/rotate-totp-key.sh` (to be created)

#### API Key HMAC Secret Rotation (Every 2 Years)

**Note:** Rotating HMAC secret invalidates ALL existing API keys!

```bash
# 1. Notify users 30 days in advance
# Send email to all API key holders

# 2. Generate new HMAC secret
new_hmac=$(openssl rand -hex 32)

# 3. Schedule maintenance window

# 4. Rotate secret
fly secrets set API_KEY_HMAC_SECRET="$new_hmac"

# 5. Deploy application
fly deploy

# 6. All users must regenerate API keys
# Provide self-service regeneration in dashboard
```

### Key Storage Security

**Best Practices:**
- Never commit keys to version control
- Never log keys in application logs
- Never expose keys in error messages
- Use `.env.example` with placeholder values only
- Require keys to be set in production (fail-fast on startup)

**Access Control:**
- Only infrastructure team can view secrets
- Secrets access logged in Fly.io audit logs
- MFA required for secret management

---

## Compliance

### SOC 2 Requirements

**CC6.6 - Encryption at Rest:**
- ✅ Database: AES-256-GCM via Supabase TDE
- ✅ Backups: AES-256 via AWS S3 SSE
- ✅ Field-level: AES-256-GCM for 2FA secrets

**CC6.7 - Encryption in Transit:**
- ✅ TLS 1.3 for all HTTPS traffic
- ✅ HSTS with preload enabled
- ✅ SSL Labs grade: A+
- ✅ Database connections encrypted

**CC6.8 - Key Management:**
- ✅ Secrets stored in encrypted vault (Fly.io Secrets)
- ✅ Annual rotation policy documented
- ✅ Access controls and audit logging

### GDPR Compliance

**Article 32 - Security of Processing:**
- ✅ Encryption of personal data at rest
- ✅ Encryption of personal data in transit
- ✅ Ability to restore availability (backups)
- ✅ Regular testing of security measures

**Personal Data Encrypted:**
- User emails and profile information
- Authentication credentials
- API usage logs
- Support ticket communications
- Billing information

### PCI DSS (If Processing Payments)

**Note:** PlexMCP uses Stripe for payment processing. We do not directly handle credit card data.

**Stripe Compliance:**
- Stripe is PCI DSS Level 1 compliant
- All payment data stays within Stripe
- We only store Stripe customer IDs (not card numbers)

**Our Responsibilities:**
- ✅ Secure connection to Stripe API (TLS 1.3)
- ✅ Webhook signature verification
- ✅ Secure storage of Stripe API keys

---

## Verification

### Monthly Security Checks

**Automated Checks (CI/CD):**
```bash
# Run automated security checks
cargo audit          # Check for vulnerable dependencies
cargo deny check     # Check for security advisories
```

**Manual Checks (Monthly):**
- [ ] SSL Labs scan: https://www.ssllabs.com/ssltest/
- [ ] Certificate expiry check (should auto-renew 30 days before)
- [ ] Review Fly.io secrets access logs
- [ ] Verify backup encryption enabled
- [ ] Test encrypted backup restoration

**Annual Checks:**
- [ ] Rotate JWT signing secret
- [ ] Rotate TOTP encryption key
- [ ] Review and update encryption standards
- [ ] Third-party security audit

### Testing Procedures

**Test Database Encryption:**
```bash
# Attempt to read raw database files (should be encrypted)
# This requires filesystem access to database server (contact Supabase)
```

**Test TLS Configuration:**
```bash
# Test with SSLyze
sslyze --regular api.plexmcp.com

# Test with testssl.sh
./testssl.sh https://api.plexmcp.com
```

**Test Backup Encryption:**
```bash
# Verify S3 object encryption
aws s3api head-object \
    --bucket plexmcp-backups \
    --key backups/2026/01/backup-20260101.sql.gz \
    | jq '.ServerSideEncryption'

# Expected output: "AES256"
```

---

## Incident Response

### Potential Encryption Incidents

**Key Compromise:**
1. Immediately rotate compromised key
2. Audit all access using compromised key
3. Notify affected users
4. Document in incident report

**Certificate Expiry:**
1. Let's Encrypt auto-renews 30 days before expiry
2. If renewal fails, alert triggers
3. Manual renewal procedure documented in runbook

**Encryption Failure:**
1. Fail-safe: Application refuses to start without valid keys
2. Alert on-call engineer
3. Restore from backup if data corruption detected

---

## Additional Resources

- [TLS Configuration Guide](tls-configuration.md)
- [Key Rotation Procedures](../operations/key-rotation.md)
- [Incident Response Plan](incident-response.md)
- [SOC 2 Compliance Mapping](soc2-compliance.md)

---

**For questions about encryption:**
- Security Team: security@plexmcp.com
- On-Call Engineer: +1 (555) 123-4567

**Last Updated:** January 1, 2026
**Next Review:** January 1, 2027
**Version:** 1.0
