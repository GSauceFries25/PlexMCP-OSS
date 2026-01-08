# PlexMCP Backup Scripts

This directory contains scripts for database backup, restoration, and disaster recovery operations.

## Quick Start

### Create a Backup

```bash
# Set database connection
export DATABASE_URL="postgresql://user:pass@host:5432/database"

# Run backup
./scripts/backup-database.sh

# Backup with custom filename
./scripts/backup-database.sh my-backup-$(date +%Y%m%d).sql.gz
```

### Restore from Backup

```bash
# Restore database (DESTRUCTIVE - will drop existing data!)
DATABASE_URL="postgresql://..." ./scripts/restore-database.sh backups/backup-20260101-120000.sql.gz
```

### Validate Backup Integrity

```bash
# Verify backup without restoring
./scripts/validate-backup.sh backups/backup-20260101-120000.sql.gz
```

## Scripts

### `backup-database.sh`

Creates a compressed PostgreSQL backup with integrity verification.

**Features:**
- Compressed pg_dump export (gzip)
- SHA256 checksum calculation
- Optional S3 upload with encryption
- Slack notifications
- Automatic cleanup of old backups (30-day retention)
- Lifecycle policy for S3 (auto-delete after 30 days, archive to Glacier after 90 days)

**Environment Variables:**
- `DATABASE_URL` (required): PostgreSQL connection string
- `BACKUP_DIR` (optional): Backup directory (default: `./backups`)
- `S3_BUCKET` (optional): S3 bucket for backup storage (default: `plexmcp-backups`)
- `SLACK_WEBHOOK_URL` (optional): Slack webhook for notifications
- `RETENTION_DAYS` (optional): Backup retention in days (default: `30`)

**Example:**
```bash
# Full backup with S3 upload and Slack notification
DATABASE_URL="postgresql://..." \
S3_BUCKET="my-backups" \
SLACK_WEBHOOK_URL="https://hooks.slack.com/..." \
./scripts/backup-database.sh
```

**Output:**
```
Backup file: backups/backup-20260101-143000.sql.gz
Size: 523MB
Checksum: d8e8fca2dc0f896fd7cb4cb0031ba249...
Duration: 287s
```

### `restore-database.sh`

Restores a PostgreSQL database from a compressed backup file.

**Features:**
- Decompression and restoration in one step
- Safety confirmation prompt (type "YES" to confirm)
- Post-restore validation checks
- Critical table verification
- RLS policy verification
- Index verification
- Slack notifications

**Environment Variables:**
- `DATABASE_URL` (required): PostgreSQL connection string for target database
- `SLACK_WEBHOOK_URL` (optional): Slack webhook for notifications
- `REQUIRE_CONFIRMATION` (optional): Require "YES" confirmation (default: `yes`)

**Example:**
```bash
# Restore to production (with confirmation)
DATABASE_URL="postgresql://..." ./scripts/restore-database.sh backups/backup-20260101-120000.sql.gz

# Restore to staging (skip confirmation)
REQUIRE_CONFIRMATION=no \
DATABASE_URL="postgresql://staging..." \
./scripts/restore-database.sh backups/backup-20260101-120000.sql.gz
```

**Safety Features:**
- Displays target database and backup details before proceeding
- Requires typing "YES" to confirm (prevents accidental execution)
- Verifies backup integrity before restoration
- Validates critical tables after restoration

### `validate-backup.sh`

Validates backup file integrity without restoring it to a database.

**Features:**
- File existence and size checks
- Checksum verification (if .sha256 file exists)
- Decompression test
- SQL syntax validation
- Expected table presence checks
- Row count estimation
- Backup age assessment

**Example:**
```bash
# Validate backup file
./scripts/validate-backup.sh backups/backup-20260101-120000.sql.gz

# Output:
# ✓ File exists
# ✓ File size is reasonable: 523MB
# ✓ Checksum matches expected value
# ✓ File decompresses successfully
# ✓ SQL syntax appears valid
# ✓ All expected tables present (6/6)
# ✓ Found 15,432 INSERT statements
# ✓ Backup age: 2 days (within retention policy)
#
# All validation checks PASSED
```

## Automated Backups

### Cron Setup

Add to crontab for automated backups every 6 hours:

```bash
# Edit crontab
crontab -e

# Add these lines (replace paths and URLs):
DATABASE_URL="postgresql://..."
S3_BUCKET="plexmcp-backups"
SLACK_WEBHOOK_URL="https://hooks.slack.com/..."

# Run backup every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)
0 */6 * * * cd /path/to/plexmcp && ./scripts/backup-database.sh >> logs/backup.log 2>&1
```

### Weekly Validation Test

Add to crontab for weekly backup validation:

```bash
# Validate latest backup every Monday at 02:00 UTC
0 2 * * 1 cd /path/to/plexmcp && ./scripts/validate-backup.sh $(ls -t backups/*.sql.gz | head -1) >> logs/validation.log 2>&1
```

## S3 Configuration

### Setup S3 Bucket

```bash
# Install AWS CLI
brew install awscli  # macOS
# or
apt install awscli   # Ubuntu

# Configure AWS credentials
aws configure

# Create backup bucket
aws s3 mb s3://plexmcp-backups --region us-east-1

# Enable encryption
aws s3api put-bucket-encryption \
    --bucket plexmcp-backups \
    --server-side-encryption-configuration '{
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            }
        }]
    }'

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket plexmcp-backups \
    --versioning-configuration Status=Enabled
```

### Cross-Region Replication (Optional)

For disaster recovery, set up cross-region replication:

```bash
# Create replication bucket in different region
aws s3 mb s3://plexmcp-backups-replica --region us-west-2

# Configure replication (requires IAM role)
# See AWS documentation for full setup
```

## Troubleshooting

### Backup Fails with "pg_dump: command not found"

Install PostgreSQL client tools:

```bash
# macOS
brew install postgresql@14

# Ubuntu
sudo apt install postgresql-client-14

# Verify installation
pg_dump --version
```

### Restore Fails with "database is being accessed by other users"

Stop all connections to the database before restoring:

```bash
# Terminate all connections (PostgreSQL)
psql $DATABASE_URL -c "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid();
"

# Then run restore
./scripts/restore-database.sh backups/backup-20260101-120000.sql.gz
```

### Backup File is Too Large

Backups are already compressed with gzip. If you need further compression:

```bash
# Recompress with maximum compression
gunzip -c backup.sql.gz | gzip -9 > backup-max-compression.sql.gz

# Or use xz compression (slower but better compression)
gunzip -c backup.sql.gz | xz -9 > backup.sql.xz
```

### S3 Upload Fails

Check AWS credentials and permissions:

```bash
# Verify AWS configuration
aws s3 ls s3://plexmcp-backups

# Check IAM permissions (required actions):
# - s3:PutObject
# - s3:PutObjectAcl
# - s3:GetObject
# - s3:ListBucket
```

## Security Best Practices

1. **Encrypt Backups:** Backups are encrypted at rest in S3 with AES-256
2. **Secure DATABASE_URL:** Never commit DATABASE_URL to version control
3. **Restrict Access:** Limit S3 bucket access to infrastructure team only
4. **Use MFA:** Require MFA for AWS console access
5. **Audit Logs:** Enable S3 access logging and CloudTrail
6. **Test Restores:** Run monthly validation tests to verify backups work
7. **Rotate Credentials:** Rotate database passwords quarterly

## Disaster Recovery SLAs

- **Recovery Point Objective (RPO):** 6 hours (maximum data loss)
- **Recovery Time Objective (RTO):** 4 hours (maximum downtime)
- **Backup Frequency:** Every 6 hours
- **Backup Retention:** 30 days operational, 1 year archives
- **Validation Testing:** Monthly automated, annual full DR drill

## Additional Resources

- [Backup & Disaster Recovery Plan](../docs/operations/backup-and-disaster-recovery.md)
- [PostgreSQL Backup Documentation](https://www.postgresql.org/docs/current/backup.html)
- [AWS S3 Backup Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/backup-for-s3.html)

## Support

For issues or questions:
- Infrastructure Team: ops@plexmcp.com
- On-Call Engineer: +1 (555) 123-4567
- Internal Docs: https://wiki.plexmcp.com/disaster-recovery
