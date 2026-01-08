# Access Control Procedures

**Document Version:** 1.0
**Last Updated:** January 1, 2026
**Review Cycle:** Quarterly
**Owner:** Security Team

---

## Table of Contents

1. [Overview](#overview)
2. [Access Control Principles](#access-control-principles)
3. [User Roles and Permissions](#user-roles-and-permissions)
4. [System Access](#system-access)
5. [User Provisioning](#user-provisioning)
6. [User Termination](#user-termination)
7. [Access Reviews](#access-reviews)
8. [Monitoring and Audit](#monitoring-and-audit)

---

## Overview

This document defines PlexMCP's access control procedures for both customer-facing systems and internal infrastructure. Access control is critical for maintaining data security, compliance, and operational integrity.

### Objectives

- **Least Privilege:** Users receive minimum access necessary for their role
- **Separation of Duties:** Critical operations require multiple approvals
- **Defense in Depth:** Multiple layers of access control
- **Auditability:** All access changes logged and reviewable

---

## Access Control Principles

### 1. Principle of Least Privilege

Users and systems are granted the **minimum level of access** required to perform their job functions.

**Examples:**
- Developers: Read-only production access, full staging access
- Support: Can view tickets, cannot access database
- Admins: Organization-scoped access (cannot access other orgs)
- Superadmins: Limited to 2 people, full audit logging

### 2. Separation of Duties

Critical operations require **multiple approvals** or **dual control**.

**Examples:**
- Code deployment: Requires code review + approval before merge
- Database changes: Must be tested in staging before production
- User role changes: Logged in audit trail, alerts on escalation
- Secret rotation: Requires infrastructure team member + validation

### 3. Need-to-Know Basis

Access to sensitive data is restricted to those who **need it for their job**.

**Examples:**
- Customer data: Only accessible within their organization (RLS)
- Payment info: Stored in Stripe, not accessible to PlexMCP staff
- 2FA secrets: Encrypted at rest, decrypted only during verification
- Audit logs: Immutable, restricted to security team

### 4. Defense in Depth

Multiple layers of security controls protect against unauthorized access.

**Layers:**
1. **Network:** Firewall, rate limiting, DDoS protection
2. **Application:** JWT authentication, API key validation
3. **Database:** Row-level security (RLS), FORCE enforcement
4. **Infrastructure:** Fly.io secrets, environment isolation
5. **Monitoring:** Real-time alerts, audit logging

---

## User Roles and Permissions

### Customer Roles

PlexMCP supports role-based access control (RBAC) for customer organizations.

#### 1. Owner

**Permissions:**
- ✅ Full organization access
- ✅ Billing and subscription management
- ✅ User management (invite, remove, change roles)
- ✅ Delete organization
- ✅ API key management
- ✅ MCP instance configuration

**Restrictions:**
- ❌ Cannot access other organizations' data (enforced by RLS)
- ❌ Cannot bypass rate limits
- ❌ Cannot access system-level features

**Assignment:**
- Automatically assigned to organization creator
- Can transfer ownership to another user
- Maximum 1 owner per organization

#### 2. Admin

**Permissions:**
- ✅ User management (invite, remove, change roles except owner)
- ✅ API key management
- ✅ MCP instance configuration
- ✅ View billing information

**Restrictions:**
- ❌ Cannot change subscription tier
- ❌ Cannot delete organization
- ❌ Cannot change owner role
- ❌ Cannot access other organizations' data

**Assignment:**
- Assigned by owner or another admin
- Multiple admins allowed per organization

#### 3. Member

**Permissions:**
- ✅ View API keys (not reveal secret)
- ✅ View MCP instances
- ✅ View usage statistics
- ✅ Create support tickets

**Restrictions:**
- ❌ Cannot create/delete API keys
- ❌ Cannot modify MCP instances
- ❌ Cannot invite/remove users
- ❌ Cannot access billing information

**Assignment:**
- Default role for invited users
- Multiple members allowed per organization

### Platform Roles (Internal Staff)

#### 1. Superadmin

**Count:** Maximum 2 people (CEO + Security Lead)

**Permissions:**
- ✅ All customer permissions across all organizations
- ✅ User role management (can change any user's role)
- ✅ System statistics and analytics
- ✅ Audit log access
- ✅ Database-level operations (via superadmin panel)

**Restrictions:**
- ❌ RLS policies still enforced (FORCE RLS prevents bypass)
- ❌ All actions logged in `admin_audit_log` table
- ❌ Requires MFA (2FA mandatory)
- ❌ Annual background check required

**Assignment:**
- Requires board approval
- Annual access review
- Quarterly audit of actions

**Implementation:**
```sql
-- Superadmin assignment (database-level)
UPDATE users
SET platform_role = 'superadmin'
WHERE email IN ('ceo@plexmcp.com', 'security@plexmcp.com');
```

**Audit Logging:**
All superadmin actions logged to `admin_audit_log`:
```sql
INSERT INTO admin_audit_log (
    user_id, action, target_user_id, org_id,
    ip_address, user_agent, details, created_at
) VALUES (...);
```

#### 2. Admin

**Count:** Limited to engineering team (5-10 people)

**Permissions:**
- ✅ View system statistics
- ✅ View support tickets (all organizations)
- ✅ Assist users (via support panel)
- ✅ Production logs access (read-only)

**Restrictions:**
- ❌ Cannot modify user data
- ❌ Cannot access API keys
- ❌ Cannot bypass RLS policies
- ❌ Cannot delete organizations

**Assignment:**
- Granted during onboarding to engineering team
- Requires security training completion
- Quarterly access review

#### 3. Support

**Count:** Support team members

**Permissions:**
- ✅ View support tickets (assigned to them)
- ✅ Respond to tickets
- ✅ View public user profile info (email, org name)

**Restrictions:**
- ❌ Cannot access API keys
- ❌ Cannot access billing information
- ❌ Cannot modify user data
- ❌ Cannot view audit logs

**Assignment:**
- Granted to support team members only
- Requires customer service training
- Monthly access review

---

## System Access

### Production Infrastructure

Access to production systems is tightly controlled and audited.

#### Fly.io (Application Hosting)

**Who:** Infrastructure team only (3 people)

**Access Method:**
- Fly.io dashboard (web console)
- `fly` CLI (requires authentication)
- MFA required

**Permissions:**
- Deploy applications
- View logs
- Manage secrets
- Scale resources

**Audit:**
- All commands logged in Fly.io audit log
- Reviewed monthly by security team

**Access Grant Procedure:**
1. Request submitted via IT ticket
2. Manager approval required
3. Infrastructure lead grants access
4. Access logged in access control matrix

#### Supabase (Database Hosting)

**Who:** Database administrator (1 person) + backup (1 person)

**Access Method:**
- Supabase dashboard (web console)
- Direct database connection (emergency only)
- MFA required

**Permissions:**
- View database metrics
- Manage backups
- Run migrations
- Emergency read-only queries

**Restrictions:**
- **No direct data modification** (use application APIs)
- Read-only access enforced
- All queries logged

**Audit:**
- Database connection logs reviewed weekly
- Queries audited for suspicious activity

#### AWS (Backup Storage)

**Who:** Infrastructure team (2 people)

**Access Method:**
- AWS IAM user accounts
- MFA required
- Access keys rotated quarterly

**Permissions:**
- Manage S3 backups
- View CloudWatch logs
- Manage lifecycle policies

**Restrictions:**
- Cannot delete backups less than 7 days old (object lock)
- Cannot disable encryption
- All actions logged in CloudTrail

**Audit:**
- CloudTrail logs reviewed weekly
- Suspicious activity alerts via AWS GuardDuty

### Development and Staging

#### Staging Environment

**Who:** All engineers

**Access Method:**
- Same as production (fly CLI, Supabase)
- No MFA required for staging

**Permissions:**
- Full access (deploy, modify, debug)
- Can reset data
- Can test migrations

**Data:**
- Synthetic test data only
- No production data allowed in staging
- Automatically reseeded weekly

#### Local Development

**Who:** All engineers

**Access Method:**
- Local PostgreSQL database
- Local application instance
- Docker Compose for dependencies

**Permissions:**
- Full local access
- Cannot access production/staging databases
- Local data only

**Data Protection:**
- `.env` file with local database URL
- `.env.example` template (no real credentials)
- `.gitignore` prevents credential commits

---

## User Provisioning

### New Employee Onboarding

**Timeline:** Access granted within 24 hours of start date

**Checklist:**

**Day 1 - Account Creation:**
- [ ] Create email account (Google Workspace)
- [ ] Add to Slack workspace
- [ ] Create GitHub account (if needed)
- [ ] Add to GitHub organization
- [ ] Create 1Password account (secrets vault)

**Day 1-3 - System Access:**
- [ ] Grant role-based permissions (developer/support/admin)
- [ ] Set up MFA for all accounts
- [ ] Provide access to documentation (Notion wiki)
- [ ] Complete security training (within 30 days)

**Week 1 - Production Access (If Needed):**
- [ ] Manager approval for production access
- [ ] Background check completed (if not done during hiring)
- [ ] Sign confidentiality agreement
- [ ] Grant read-only production access (if approved)
- [ ] Add to on-call rotation (after 90 days)

**Access Request Process:**

1. **Submit Request:**
   - Fill out IT access request form
   - Specify: System, access level, justification, duration

2. **Manager Approval:**
   - Manager reviews and approves/denies
   - Documented in IT ticketing system

3. **Security Review (For Sensitive Access):**
   - Security team reviews high-privilege requests
   - May require additional background check

4. **Provisioning:**
   - IT/Infrastructure team grants access
   - User receives notification
   - Access logged in access control matrix

5. **Confirmation:**
   - User tests access
   - User acknowledges responsibility

---

## User Termination

### Employee Off-boarding

**Timeline:** Access revoked within 1 hour of termination

**Immediate Actions (Within 1 Hour):**
- [ ] Revoke Fly.io access
- [ ] Revoke Supabase access
- [ ] Revoke AWS access
- [ ] Deactivate GitHub account
- [ ] Deactivate Slack account
- [ ] Revoke email access
- [ ] Invalidate all API keys created by user
- [ ] Remove from on-call rotation

**Within 24 Hours:**
- [ ] Change shared passwords (if any)
- [ ] Rotate secrets accessed by user
- [ ] Review audit logs for suspicious activity
- [ ] Document in termination checklist
- [ ] Notify security team
- [ ] Conduct exit interview (security portion)

**Within 1 Week:**
- [ ] Delete user's local development credentials
- [ ] Remove from all distribution lists
- [ ] Update documentation (remove from runbooks)
- [ ] Archive user's files (Google Drive, Notion)

**Termination Checklist Owner:** HR + IT

**Verification:**
- IT confirms all access revoked
- Security team reviews audit logs
- Manager signs off on completion

---

## Access Reviews

### Quarterly User Access Review

**Schedule:** First Monday of January, April, July, October

**Process:**

1. **Generate Access Report:**
   ```sql
   -- Query all user accounts and their roles
   SELECT
       u.email,
       u.role,
       u.platform_role,
       u.is_admin,
       u.created_at,
       u.last_login_at,
       o.name AS org_name
   FROM users u
   JOIN organizations o ON o.id = u.org_id
   ORDER BY u.platform_role NULLS LAST, u.role;
   ```

2. **Review Each User:**
   - Verify role is appropriate
   - Check last login date (inactive > 90 days?)
   - Confirm employment status
   - Flag anomalies for investigation

3. **Take Action:**
   - Deactivate inactive accounts (no login in 90 days)
   - Downgrade over-privileged accounts
   - Remove terminated employees (if missed)
   - Document changes

4. **Management Sign-off:**
   - Security team reviews results
   - Manager approves changes
   - Document in quarterly review report

### Annual Superadmin Access Review

**Schedule:** First Monday of January

**Process:**

1. **Review Current Superadmins:**
   - Verify only 2 people have superadmin access
   - Confirm both still require access
   - Review audit logs for suspicious activity

2. **Background Check:**
   - Annual background check for superadmins
   - Verify no criminal activity, financial issues

3. **Board Approval:**
   - Board reviews and re-approves superadmin access
   - Documented in board meeting minutes

4. **MFA Verification:**
   - Verify both superadmins have MFA enabled
   - Test MFA is working

### Ad-Hoc Reviews

**Triggered By:**
- Security incident
- Suspicious activity
- Employee transfer/promotion
- Regulatory audit
- Customer request

---

## Monitoring and Audit

### Authentication Monitoring

**What We Monitor:**
- Failed login attempts (brute force detection)
- Password reset requests (account takeover attempts)
- 2FA bypass attempts
- API key usage anomalies
- Session hijacking attempts

**Alerts:**
- **Brute Force:** 5+ failed logins in 5 minutes → Alert ops team
- **Password Reset Spam:** 3+ reset requests in 1 hour → Lock account
- **2FA Failures:** 10+ failed 2FA codes → Lock account, notify user
- **API Key Abuse:** 1000+ requests/minute → Rate limit, alert

**Implementation:** Phase 2.3 Security Alerting Service

### Authorization Monitoring

**What We Monitor:**
- Privilege escalation attempts (user → admin → superadmin)
- Cross-organization data access attempts (RLS violations)
- Unusual export patterns (data exfiltration)
- Admin action frequency (excessive admin operations)

**Alerts:**
- **Privilege Escalation:** Role change to admin/superadmin → Immediate alert
- **RLS Violation:** Blocked by RLS → Log for investigation
- **Data Export:** > 10,000 records exported → Alert security team
- **Admin Abuse:** > 50 admin actions/hour → Alert superadmin

### Audit Logging

**What We Log:**

1. **Authentication Events** (`auth_audit_log` table):
   - Login attempts (success and failure)
   - Password changes
   - 2FA setup/disable
   - Session creation/termination

2. **Admin Actions** (`admin_audit_log` table):
   - User role changes
   - Organization modifications
   - API key creation/deletion
   - MCP instance changes

3. **System Events** (Application logs):
   - Deployments
   - Configuration changes
   - Database migrations
   - Secret rotations

**Retention:**
- Authentication logs: 7 years (compliance requirement)
- Admin logs: 7 years (compliance requirement)
- Application logs: 90 days (operational)

**Immutability:**
- Audit log tables have INSERT-only permissions
- No UPDATE or DELETE allowed (enforced at database level)
- Backups retained separately for 7 years

**Access:**
- Security team: Full access
- Superadmins: Full access
- Auditors: Read-only access (upon request)

---

## Compliance

### SOC 2 Requirements

**CC6.1 - Logical Access Controls:**
- ✅ RBAC implemented (owner, admin, member)
- ✅ Least privilege enforced via RLS
- ✅ Segregation of duties (code review, deployments)

**CC6.2 - User Provisioning:**
- ✅ Onboarding checklist documented
- ✅ Manager approval required
- ✅ Access logged in IT system

**CC6.3 - User Termination:**
- ✅ Off-boarding checklist documented
- ✅ Access revoked within 1 hour
- ✅ Verification by IT team

**CC6.4 - Segregation of Duties:**
- ✅ Role-based permissions
- ✅ Superadmin limited to 2 people
- ✅ Admin actions require approval

**CC6.5 - Access Reviews:**
- ✅ Quarterly user access review
- ✅ Annual superadmin review
- ✅ Documented and signed off

### GDPR Requirements

**Article 32(1)(b) - Access Control:**
- ✅ Ability to ensure confidentiality (RLS, encryption)
- ✅ Integrity (audit logging, immutable logs)
- ✅ Availability (backups, DR plan)
- ✅ Resilience (auto-scaling, monitoring)

---

## Additional Resources

- [SOC 2 Compliance Mapping](soc2-compliance.md)
- [Incident Response Plan](incident-response.md)
- [Audit Logging Guide](audit-logging.md)
- [Employee Security Training](../policies/security-training.md)

---

**For questions about access control:**
- Security Team: security@plexmcp.com
- IT Support: it@plexmcp.com

**Last Updated:** January 1, 2026
**Next Review:** April 1, 2026
**Version:** 1.0
