# SOC 2 Type II Compliance Documentation

**Organization:** PlexMCP
**Report Period:** January 1, 2026 - December 31, 2026
**Framework:** AICPA TSC (Trust Services Criteria)
**Status:** In Progress (Target Certification: Q2 2026)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Trust Services Criteria Overview](#trust-services-criteria-overview)
3. [Security Control Matrix](#security-control-matrix)
4. [Common Criteria (CC)](#common-criteria-cc)
5. [Availability (A)](#availability-a)
6. [Confidentiality (C)](#confidentiality-c)
7. [Processing Integrity (PI)](#processing-integrity-pi)
8. [Privacy (P)](#privacy-p)
9. [Audit Evidence](#audit-evidence)
10. [Gaps and Remediation](#gaps-and-remediation)

---

## Executive Summary

This document maps PlexMCP's security controls to SOC 2 Type II Trust Services Criteria. SOC 2 compliance demonstrates our commitment to:

- **Security:** Protection of system resources against unauthorized access
- **Availability:** System availability for operation and use as committed
- **Processing Integrity:** System processing is complete, valid, accurate, timely, and authorized
- **Confidentiality:** Information designated as confidential is protected
- **Privacy:** Personal information is collected, used, retained, disclosed, and disposed per commitments

### Current Compliance Status

| Category | Status | Controls Implemented | Controls Tested | Readiness |
|----------|--------|---------------------|-----------------|-----------|
| **Common Criteria (CC)** | 🟡 In Progress | 14/17 | 10/17 | 82% |
| **Availability (A)** | 🟢 Ready | 3/3 | 3/3 | 100% |
| **Confidentiality (C)** | 🟡 In Progress | 2/3 | 2/3 | 67% |
| **Processing Integrity (PI)** | 🟢 Ready | 4/4 | 4/4 | 100% |
| **Privacy (P)** | 🟢 Ready | 5/5 | 5/5 | 100% |
| **Overall** | 🟡 **In Progress** | **28/32** | **24/32** | **88%** |

**Target Certification Date:** June 30, 2026

---

## Trust Services Criteria Overview

### What is SOC 2?

SOC 2 (Service Organization Control 2) is an auditing framework developed by the American Institute of CPAs (AICPA) to ensure service providers securely manage customer data. It evaluates controls across five Trust Services Criteria.

### Type I vs Type II

- **Type I:** Controls are properly designed at a specific point in time
- **Type II:** Controls operate effectively over a period of time (we're pursuing this)

### Why SOC 2 Matters

- **Customer Trust:** Demonstrates commitment to security and privacy
- **Enterprise Sales:** Required by many enterprise customers
- **Risk Management:** Validates our security posture
- **Regulatory Compliance:** Aligns with GDPR, CCPA, HIPAA requirements
- **Competitive Advantage:** Differentiates us in the marketplace

---

## Security Control Matrix

### How to Read This Matrix

- **Control ID:** AICPA TSC control identifier
- **Control Objective:** What the control aims to achieve
- **PlexMCP Implementation:** How we implement this control
- **Evidence:** Where auditors can find proof
- **Status:** 🟢 Implemented | 🟡 Partial | 🔴 Gap
- **Test Date:** When the control was last tested

---

## Common Criteria (CC)

Common Criteria apply to all five Trust Services Categories.

### CC1: Control Environment

**Objective:** The entity demonstrates a commitment to integrity and ethical values.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC1.1** | Board independence and oversight | Advisory board reviews security quarterly | Meeting minutes, board charter | 🟢 |
| **CC1.2** | Management establishes tone at top | CEO communication, security-first culture | All-hands recordings, policies | 🟢 |
| **CC1.3** | Organizational structure defined | Clear reporting lines, RACI matrix | Org chart, job descriptions | 🟢 |
| **CC1.4** | Commitment to competence | Security training, certifications | Training records, certs | 🟡 |
| **CC1.5** | Accountability established | Code of conduct, disciplinary policy | Employee handbook, HR records | 🟢 |

**Implementation Details:**

- **Security Training:** All employees complete security awareness training within 30 days of hire
- **Background Checks:** Conducted for all employees with system access
- **Code of Conduct:** Signed annually by all team members
- **Disciplinary Policy:** Progressive discipline for security violations

**Evidence Location:**
- `docs/policies/code-of-conduct.md`
- `docs/policies/security-training.md`
- HR system (BambooHR)

---

### CC2: Communication and Information

**Objective:** The entity obtains or generates and uses relevant, quality information.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC2.1** | Information requirements identified | Security policies, data classification | `docs/policies/` | 🟢 |
| **CC2.2** | Internal communication channels | Slack #security, weekly all-hands | Slack archives, meeting notes | 🟢 |
| **CC2.3** | External communication | Security advisories, status page | `SECURITY.md`, status.plexmcp.com | 🟢 |

**Implementation Details:**

- **Internal Communication:**
  - Slack #security channel for security discussions
  - Monthly security newsletter
  - Incident post-mortems shared company-wide

- **External Communication:**
  - Security advisories published within 24 hours of patch
  - Status page updates during incidents (< 15 min)
  - Customer notifications for security-impacting changes

**Evidence Location:**
- Slack workspace
- `SECURITY.md`
- Status page: https://status.plexmcp.com

---

### CC3: Risk Assessment

**Objective:** The entity identifies, analyzes, and manages risks.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC3.1** | Risk identification | Quarterly risk assessments | Risk register spreadsheet | 🟡 |
| **CC3.2** | Risk analysis | CVSS scoring, impact assessment | Vulnerability reports | 🟢 |
| **CC3.3** | Fraud risk assessment | Annual fraud risk workshop | Workshop notes, risk matrix | 🟡 |
| **CC3.4** | Significant changes assessed | Change management process | Change tickets (GitHub PRs) | 🟢 |

**Implementation Details:**

- **Quarterly Risk Assessments:** Infrastructure team reviews top 10 risks
- **Vulnerability Management:** CVSS scoring for all reported vulnerabilities
- **Change Management:** All production changes reviewed before deployment
- **Dependency Scanning:** Automated `cargo-audit` in CI/CD pipeline

**Gaps Identified:**
- 🔴 No formal fraud risk assessment documented (planned Q1 2026)
- 🔴 Risk register needs quarterly review cadence (manual spreadsheet → Jira)

**Evidence Location:**
- `docs/security/risk-register.xlsx`
- GitHub Security Advisories
- CI/CD pipeline logs

---

### CC4: Monitoring Activities

**Objective:** The entity monitors the system and takes action on deficiencies.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC4.1** | Monitoring controls established | Sentry, Fly.io metrics, security alerts | Dashboard screenshots | 🟢 |
| **CC4.2** | Performance evaluation | Weekly uptime reports, SLA tracking | Grafana dashboards | 🟢 |

**Implementation Details:**

- **Application Monitoring:** Sentry for error tracking (real-time alerts)
- **Infrastructure Monitoring:** Fly.io health checks every 10 seconds
- **Security Monitoring:** Automated alerts for Phase 2.3 security events:
  - Brute force attacks (5+ failed logins in 5 min)
  - Privilege escalation (role changes to admin/superadmin)
  - Data exfiltration (unusual export patterns)
  - Configuration changes (MCP modifications, RLS changes)

**Evidence Location:**
- Sentry project: https://sentry.io/plexmcp
- Fly.io dashboard
- Slack #ops-alerts channel

---

### CC5: Control Activities

**Objective:** The entity selects and develops control activities.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC5.1** | Control activities support objectives | Security policies aligned to controls | Policy documentation | 🟢 |
| **CC5.2** | Technology controls implemented | RLS, encryption, MFA, audit logging | Database schema, code | 🟢 |
| **CC5.3** | Policies and procedures deployed | Documented in `/docs/policies/` | Policy docs, wiki | 🟢 |

**Implementation Details:**

- **Database Security:** FORCE RLS on all 48 sensitive tables (Phase 2.1)
- **Encryption:** AES-256 at rest, TLS 1.3 in transit (Phase 2.2)
- **Authentication:** JWT + 2FA with TOTP and backup codes
- **Authorization:** Role-based access control with organization isolation
- **Audit Logging:** Immutable logs for all admin/auth operations

**Evidence Location:**
- `migrations/20260103000001_apply_force_rls_all_tables.sql`
- `docs/security/tls-configuration.md`
- `docs/security/encryption.md`

---

### CC6: Logical and Physical Access Controls

**Objective:** The entity restricts logical and physical access.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC6.1** | Logical access controls | JWT auth, API key HMAC, RLS policies | Auth middleware code | 🟢 |
| **CC6.2** | New user provisioning | Onboarding checklist, access reviews | HR tickets, access logs | 🟢 |
| **CC6.3** | User termination | Offboarding checklist, immediate revocation | HR tickets, deactivation logs | 🟢 |
| **CC6.4** | Segregation of duties | Admin vs user roles, superadmin limited | Role definitions, audit logs | 🟢 |
| **CC6.5** | Access review | Quarterly user access review | Access review spreadsheet | 🟡 |
| **CC6.6** | Encryption at rest | AES-256 for sensitive data | Database configs, code | 🟢 |
| **CC6.7** | Encryption in transit | TLS 1.3, HSTS with preload | SSL Labs scan results | 🟢 |
| **CC6.8** | Key management | Environment variables, rotation policy | Secrets management docs | 🟢 |

**Implementation Details:**

- **User Provisioning:**
  - New employees added to systems within 24 hours
  - Principle of least privilege applied
  - MFA required for all production access

- **User Termination:**
  - Access revoked within 1 hour of termination
  - All credentials rotated
  - Exit interview checklist

- **Access Review:**
  - Quarterly review of all user accounts
  - Inactive accounts disabled after 90 days
  - Superadmin access limited to 2 people

- **Encryption:**
  - Database encryption: AES-256 (Supabase managed)
  - Backup encryption: AES-256 + GPG (S3 SSE)
  - TLS 1.3 with modern cipher suites only
  - HSTS with preload, 1-year duration

**Gaps Identified:**
- 🔴 Access review needs automation (manual spreadsheet → automated reports)

**Evidence Location:**
- `crates/api/src/auth/middleware.rs`
- `docs/security/encryption.md`
- `docs/security/tls-configuration.md`
- SSL Labs: https://www.ssllabs.com/ssltest/analyze.html?d=api.plexmcp.com

---

### CC7: System Operations

**Objective:** The entity manages system operations.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC7.1** | Change management | GitHub PRs, code review required | PR history, branch protection | 🟢 |
| **CC7.2** | System monitoring | Sentry, Fly.io, security alerts | Alert history, dashboards | 🟢 |
| **CC7.3** | Incident response | Incident response plan, runbooks | `docs/security/incident-response.md` | 🟢 |
| **CC7.4** | Capacity management | Auto-scaling, load testing | Fly.io scaling config | 🟢 |
| **CC7.5** | Environmental safeguards | Cloud-hosted (Fly.io, Supabase) | Service agreements | 🟢 |

**Implementation Details:**

- **Change Management:**
  - All production changes via GitHub Pull Requests
  - Minimum 1 reviewer required (2 for security changes)
  - Automated tests must pass before merge
  - Database migrations tested in staging first

- **System Monitoring:**
  - Application errors: Sentry (real-time)
  - Infrastructure health: Fly.io (10-second intervals)
  - Security events: Custom alerting service (Phase 2.3)
  - Uptime monitoring: UptimeRobot (1-minute intervals)

- **Incident Response:**
  - SEV-1: Page on-call engineer immediately
  - SEV-2: Alert ops team within 15 minutes
  - SEV-3: Notify ops team within 1 hour
  - Post-mortem required for SEV-1 and SEV-2

- **Capacity Management:**
  - Auto-scaling: Fly.io scales 1-10 instances based on load
  - Load testing: Monthly with k6 (simulate 10k RPS)
  - Database connections: Connection pooling (max 20 per instance)

**Evidence Location:**
- GitHub repository settings (branch protection)
- `docs/security/incident-response.md`
- Fly.io auto-scaling configuration
- PagerDuty on-call schedule

---

### CC8: Change Management

**Objective:** The entity implements changes in a controlled manner.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC8.1** | Change authorization | PR approval, deployment approval | GitHub approvals, Slack logs | 🟢 |

**Implementation Details:**

- **Development Changes:**
  - Feature branches required
  - Code review mandatory
  - Automated tests in CI/CD
  - Staging deployment before production

- **Infrastructure Changes:**
  - Infrastructure as code (fly.toml)
  - Changes documented in PRs
  - Rollback plan required for major changes

- **Emergency Changes:**
  - Can bypass normal process for SEV-1 incidents
  - Must be documented and reviewed within 24 hours

**Evidence Location:**
- GitHub PR history
- `fly.toml` version history
- Slack #deployments channel

---

### CC9: Risk Mitigation

**Objective:** The entity identifies, selects, and develops risk mitigation activities.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **CC9.1** | Risk mitigation strategies | Backup/DR, redundancy, monitoring | DR plan, redundancy config | 🟢 |
| **CC9.2** | Vendor risk management | Vendor assessment process | Vendor security reviews | 🟡 |

**Implementation Details:**

- **Backup and Disaster Recovery:**
  - RPO: 6 hours (maximum data loss)
  - RTO: 4 hours (maximum downtime)
  - Backups every 6 hours with 30-day retention
  - Monthly backup restoration tests
  - Annual full DR drill

- **Redundancy:**
  - Multi-region database (Supabase replication)
  - Auto-scaling application servers (Fly.io)
  - CDN for static assets (Cloudflare)

- **Vendor Management:**
  - Critical vendors: Stripe, Supabase, Fly.io
  - Annual vendor security reviews
  - SOC 2 reports requested from vendors

**Gaps Identified:**
- 🔴 Vendor security assessment checklist needs formalization

**Evidence Location:**
- `docs/operations/backup-and-disaster-recovery.md`
- Vendor SOC 2 reports (shared drive)
- `docs/security/vendor-management.md` (to be created)

---

## Availability (A)

### A1: Availability Commitments

**Objective:** The entity makes commitments about system availability.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **A1.1** | SLA defined | 99.9% uptime commitment | Service Level Agreement | 🟢 |
| **A1.2** | Backup and recovery | DR plan, tested quarterly | DR documentation, test results | 🟢 |
| **A1.3** | Monitoring and alerting | Real-time uptime monitoring | UptimeRobot, PagerDuty | 🟢 |

**Implementation Details:**

- **SLA Commitment:** 99.9% monthly uptime (43 minutes downtime allowed)
- **Actual Uptime (Dec 2025):** 99.98% (5 minutes downtime)
- **Backup Strategy:** Automated backups every 6 hours + WAL archiving
- **Recovery Testing:** Monthly validation + annual full DR drill
- **Monitoring:** UptimeRobot (1-min checks), Fly.io health checks (10-sec)

**Evidence Location:**
- SLA: https://plexmcp.com/sla
- `docs/operations/backup-and-disaster-recovery.md`
- Uptime reports: UptimeRobot dashboard

---

## Confidentiality (C)

### C1: Confidential Information Protection

**Objective:** The entity protects confidential information.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **C1.1** | Confidentiality commitments | Privacy policy, terms of service | Legal agreements | 🟢 |
| **C1.2** | Data classification | Defined in data classification policy | `docs/security/data-classification.md` | 🟡 |
| **C1.3** | Confidential data disposal | Secure deletion, backup purging | Deletion procedures | 🟢 |

**Implementation Details:**

- **Data Classification:**
  - Public: Marketing materials
  - Internal: Business operations data
  - Confidential: Customer data, API keys
  - Restricted: 2FA secrets, payment info

- **Confidentiality Protection:**
  - RLS policies isolate organization data
  - Encryption at rest (AES-256)
  - Encryption in transit (TLS 1.3)
  - Access logging for audit trail

- **Secure Disposal:**
  - Soft delete with 30-day retention for recovery
  - Hard delete after 30 days (GDPR compliance)
  - Backups purged after retention period

**Gaps Identified:**
- 🔴 Data classification policy needs formal documentation (in progress)

**Evidence Location:**
- Privacy policy: https://plexmcp.com/privacy
- `docs/security/data-classification.md` (to be created)
- `docs/policies/data-retention.md`

---

## Processing Integrity (PI)

### PI1: Processing Integrity Commitments

**Objective:** The entity processes information completely, validly, accurately, and timely.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **PI1.1** | Input validation | Validation middleware, sanitization | Input validation code | 🟢 |
| **PI1.2** | Processing controls | Database constraints, RLS policies | Schema, migrations | 🟢 |
| **PI1.3** | Output validation | Response schema validation | API tests | 🟢 |
| **PI1.4** | Error handling | Comprehensive error handling, logging | Error handling code | 🟢 |

**Implementation Details:**

- **Input Validation:**
  - Request body validation (serde deserialization)
  - SQL injection prevention (parameterized queries)
  - XSS prevention (HTML sanitization)
  - CSRF protection (SameSite cookies)

- **Processing Controls:**
  - Database constraints (foreign keys, NOT NULL)
  - RLS policies enforce data isolation
  - Transaction rollback on errors
  - Idempotency keys for critical operations

- **Error Handling:**
  - All errors logged to Sentry
  - User-friendly error messages (no stack traces to users)
  - Automatic retry for transient failures
  - Circuit breaker for external API calls

**Evidence Location:**
- `crates/api/src/routes/` (input validation)
- Database schema files
- Sentry error tracking

---

## Privacy (P)

### P1: Privacy Commitments

**Objective:** The entity protects personal information per its privacy notice.

| Control ID | Control Description | Implementation | Evidence | Status |
|------------|-------------------|----------------|----------|--------|
| **P1.1** | Privacy notice | Published privacy policy | https://plexmcp.com/privacy | 🟢 |
| **P1.2** | Consent management | Explicit consent for data processing | Consent records | 🟢 |
| **P1.3** | Data subject rights | GDPR data export/deletion | Data subject request process | 🟢 |
| **P1.4** | Data retention | 30-day soft delete, 7-year audit logs | Retention policy | 🟢 |
| **P1.5** | Data breach notification | 72-hour GDPR notification process | Incident response plan | 🟢 |

**Implementation Details:**

- **Privacy Notice:**
  - Clearly explains data collection and use
  - Updated annually (last update: Jan 1, 2026)
  - Accessible from all pages

- **Consent Management:**
  - Explicit opt-in for marketing emails
  - Cookie consent banner
  - Consent logged in database

- **Data Subject Rights:**
  - Data export: API endpoint returns all user data in JSON
  - Data deletion: Soft delete with 30-day recovery
  - Data portability: Export in machine-readable format
  - Right to be forgotten: Hard delete after 30 days

- **Data Breach Notification:**
  - Internal notification: Immediate (PagerDuty)
  - User notification: Within 72 hours (GDPR requirement)
  - Regulator notification: Within 72 hours if required
  - Post-mortem and remediation tracking

**Evidence Location:**
- Privacy policy: https://plexmcp.com/privacy
- `docs/security/incident-response.md`
- Data subject request logs (support tickets)

---

## Audit Evidence

### Document Repository

All SOC 2 audit evidence is maintained in:

- **Primary:** Google Drive (shared with auditor)
- **Secondary:** Internal wiki (Notion)
- **Code Evidence:** GitHub repository

### Evidence Retention

- **Policies and Procedures:** Indefinitely (version controlled)
- **Test Results:** 7 years
- **Audit Logs:** 7 years
- **Incident Reports:** 7 years
- **Meeting Minutes:** 3 years

### Access to Evidence

- **Auditor Access:** Read-only to all evidence folders
- **Management Access:** Full access
- **Team Access:** Role-based access to relevant evidence

---

## Gaps and Remediation

### Current Gaps (4 identified)

| Gap ID | Control | Description | Priority | Target Date | Owner |
|--------|---------|-------------|----------|-------------|-------|
| **GAP-1** | CC3.3 | Formal fraud risk assessment | Medium | Q1 2026 | Security Lead |
| **GAP-2** | CC6.5 | Automated access review | Low | Q2 2026 | Infrastructure |
| **GAP-3** | CC9.2 | Vendor security checklist | Medium | Q1 2026 | Security Lead |
| **GAP-4** | C1.2 | Data classification policy | Medium | Q1 2026 | Compliance |

### Remediation Plan

**Q1 2026:**
- Complete fraud risk assessment workshop
- Formalize vendor security assessment process
- Document data classification policy

**Q2 2026:**
- Implement automated access review reports
- Complete SOC 2 Type II audit
- Achieve certification

---

## Conclusion

PlexMCP has implemented **28 of 32** SOC 2 controls (88% complete) with **24 of 32** controls tested and validated. The remaining 4 gaps are low to medium priority and scheduled for remediation in Q1 2026.

**We are on track for SOC 2 Type II certification by June 30, 2026.**

---

**For questions about SOC 2 compliance:**
- Compliance Team: compliance@plexmcp.com
- Security Lead: security@plexmcp.com

**Last Updated:** January 1, 2026
**Next Review:** April 1, 2026
**Version:** 1.0
