# TLS/HTTPS Configuration - PlexMCP
**Last Updated:** January 3, 2026

## Overview

PlexMCP enforces **TLS 1.3** for all HTTPS connections to ensure encryption in transit.

### Supported TLS Versions

- TLS 1.3: ✅ Enabled (preferred)
- TLS 1.2: ✅ Enabled (fallback)
- TLS 1.1: ❌ Disabled
- TLS 1.0: ❌ Disabled

### Certificate Management

- **Provider:** Let's Encrypt (via Fly.io)
- **Renewal:** Automatic (90-day certificates)
- **Domain:** api.plexmcp.com
- **Algorithm:** RSA 2048-bit

### SSL Labs Grade Target

**A+** - Verified monthly

**Test URL:** https://www.ssllabs.com/ssltest/analyze.html?d=api.plexmcp.com

### HSTS Configuration

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### Cipher Suites (TLS 1.3)

1. TLS_AES_128_GCM_SHA256 (preferred)
2. TLS_AES_256_GCM_SHA384  
3. TLS_CHACHA20_POLY1305_SHA256

All provide forward secrecy and authenticated encryption.

### Verification

**Test TLS 1.3:**
```bash
openssl s_client -connect api.plexmcp.com:443 -tls1_3 < /dev/null
```

**Check HSTS:**
```bash
curl -I https://api.plexmcp.com | grep Strict-Transport-Security
```

### Monitoring

- Certificate expiration: Monitored by Fly.io
- Renewal: Automatic 30 days before expiry
- Alert: Email on renewal failure

### SOC 2 Compliance

**CC6.7 - Encryption in Transit:**
- ✅ TLS 1.3 enforced
- ✅ Strong ciphers only
- ✅ Valid certificates
- ✅ Regular testing

**Evidence:**
- SSL Labs test results (monthly)
- Certificate renewal logs
- TLS version usage statistics

