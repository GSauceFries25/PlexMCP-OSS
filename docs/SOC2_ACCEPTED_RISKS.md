# SOC 2 Accepted Risks Documentation
**Date:** January 3, 2026
**Reviewer:** Claude Code
**Status:** ACCEPTED

---

## Overview

This document records security vulnerabilities identified during the SOC 2 audit that cannot be fixed through code changes. Each risk has been evaluated for exploitability and impact.

---

## Rust Dependencies

### 1. rsa 0.9.9 - Marvin Attack (RUSTSEC-2023-0071)

**Severity:** MEDIUM (5.9)
**Status:** NO FIX AVAILABLE

**Vulnerability:**
Timing sidechannel attack that could allow private key recovery in RSA PKCS#1 v1.5 decryption.

**Dependency Chain:**
```
rsa 0.9.9
└── sqlx-mysql 0.8.6
    └── sqlx-macros-core 0.8.6
        └── sqlx-macros 0.8.6
            └── sqlx 0.8.6 (our direct dependency)
```

**Why We Cannot Fix:**
- The rsa crate maintainers acknowledge the issue but have not released a fix
- sqlx-macros pulls in sqlx-mysql even when only postgres is configured
- We cannot remove this transitive dependency without forking sqlx

**Risk Assessment:**
| Factor | Assessment |
|--------|------------|
| Attack Complexity | HIGH - Requires network proximity and statistical analysis of many requests |
| Privilege Required | LOW - Attacker needs to be on same network segment |
| User Interaction | NONE |
| Scope | Changed - May affect other components |
| Confidentiality | HIGH - Private key compromise |
| Integrity | HIGH |
| Availability | NONE |

**Mitigations:**
1. **We use PostgreSQL, not MySQL** - The vulnerable code path (MySQL authentication) is never executed
2. **TLS everywhere** - All connections are encrypted, making timing analysis harder
3. **Cloud infrastructure** - Fly.io network isolation limits attacker proximity
4. **No RSA for application crypto** - Our JWT signing uses Ed25519, not RSA

**Decision:** ACCEPTED
- The vulnerable code is never executed in our application
- Practical exploitation requires conditions we don't have
- Will upgrade when sqlx releases a fix

---

### 2. idna 0.4.0 - Punycode Validation (RUSTSEC-2024-0421)

**Severity:** LOW
**Status:** FIXABLE (but requires library migration)

**Vulnerability:**
Accepts Punycode labels that don't produce any non-ASCII characters when decoded. This could potentially be used in domain spoofing attacks.

**Dependency Chain:**
```
idna 0.4.0
└── trust-dns-proto 0.23.2
    └── trust-dns-resolver 0.23.2
        └── plexmcp-api 0.1.0
```

**Why We Cannot Fix Now:**
- Requires upgrading from trust-dns-resolver to hickory-resolver
- This is a breaking change requiring code updates
- Scheduled for future maintenance sprint

**Risk Assessment:**
| Factor | Assessment |
|--------|------------|
| Attack Vector | Network - requires crafted DNS lookups |
| Exploitability | LOW - Requires specific Punycode input |
| Impact | LOW - Domain confusion in logs/display |

**Mitigations:**
1. DNS resolution is internal only - not user-facing
2. All external URLs are validated and sanitized before use
3. Our domain validation uses separate code path

**Decision:** ACCEPTED
- Low impact and exploitability
- Will migrate to hickory-resolver in future sprint

---

### 3. instant 0.1.13 - Unmaintained (RUSTSEC-2024-0384)

**Severity:** INFO (Warning only)
**Status:** TRANSITIVE DEPENDENCY

**Issue:**
The `instant` crate is unmaintained but has no security vulnerabilities.

**Dependency Chain:**
```
instant 0.1.13
└── fastrand 1.9.0
    └── futures-lite 1.13.0
        └── http-types 2.12.0
            └── async-stripe 0.39.1
```

**Decision:** ACCEPTED
- No security vulnerability, just maintenance warning
- Will be resolved when async-stripe updates dependencies

---

### 4. trust-dns-proto 0.23.2 - Rebranded (RUSTSEC-2025-0017)

**Severity:** INFO (Warning only)
**Status:** TRANSITIVE DEPENDENCY

**Issue:**
The trust-dns project has been renamed to hickory-dns. This is a maintenance warning, not a security issue.

**Decision:** ACCEPTED
- Will migrate to hickory-resolver in future sprint
- No security impact

---

## npm Dependencies

### RESOLVED: d3-color ReDoS (GHSA-36jr-mh4h-2g58)

**Status:** FIXED via npm overrides

**Resolution:**
Added to `package.json`:
```json
"overrides": {
  "d3-color": "^3.1.0"
}
```

**Verification:**
```bash
$ npm audit
found 0 vulnerabilities
```

---

## Summary

| Vulnerability | Severity | Status | Action |
|--------------|----------|--------|--------|
| rsa Marvin Attack | MEDIUM | ACCEPTED | Monitor for upstream fix |
| idna Punycode | LOW | ACCEPTED | Migrate to hickory in future |
| instant unmaintained | INFO | ACCEPTED | No action needed |
| trust-dns rebranded | INFO | ACCEPTED | Migrate with idna fix |
| d3-color ReDoS | HIGH | FIXED | npm overrides applied |

---

## Review Schedule

These accepted risks should be reviewed:
- Quarterly for upstream fixes
- Before any major release
- If threat landscape changes

**Next Review Date:** April 3, 2026
