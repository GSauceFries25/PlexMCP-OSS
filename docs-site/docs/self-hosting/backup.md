---
sidebar_position: 7
---

# Backup & Restore

This guide covers backup and restore procedures for your self-hosted PlexMCP installation.

## What to Backup

| Component | Location | Priority |
|-----------|----------|----------|
| PostgreSQL Database | Contains all data | 🔴 Critical |
| Environment File | `.env` | 🔴 Critical |
| Redis (optional) | Session cache | 🟡 Medium |
| Configuration | `docker-compose.yml` | 🟢 Low |

## Quick Backup

### Using the Backup Script

```bash
# Run the backup script
./scripts/backup.sh

# Or with custom output directory
./scripts/backup.sh /path/to/backups
```

### Manual Quick Backup

```bash
# Create backup directory
mkdir -p backups

# Backup database
docker compose exec postgres pg_dump -U plexmcp plexmcp > backups/plexmcp-$(date +%Y%m%d-%H%M%S).sql

# Backup environment
cp .env backups/.env-$(date +%Y%m%d-%H%M%S)
```

## Database Backup

### Docker Deployment

```bash
# Full backup (recommended)
docker compose exec postgres pg_dump -U plexmcp -Fc plexmcp > backup.dump

# SQL format (readable, larger)
docker compose exec postgres pg_dump -U plexmcp plexmcp > backup.sql

# Compressed SQL
docker compose exec postgres pg_dump -U plexmcp plexmcp | gzip > backup.sql.gz
```

### Manual Deployment

```bash
# Full backup
pg_dump -h localhost -U plexmcp -Fc plexmcp > backup.dump

# SQL format
pg_dump -h localhost -U plexmcp plexmcp > backup.sql

# Compressed
pg_dump -h localhost -U plexmcp plexmcp | gzip > backup.sql.gz
```

### Backup Specific Tables

```bash
# Backup only users and organizations
docker compose exec postgres pg_dump -U plexmcp \
  -t users -t organizations -t organization_members \
  plexmcp > users-backup.sql
```

### Exclude Large Tables

```bash
# Backup without logs/analytics tables
docker compose exec postgres pg_dump -U plexmcp \
  --exclude-table='*_logs' \
  --exclude-table='usage_*' \
  plexmcp > backup-no-logs.sql
```

## Environment Backup

### Secure Backup

```bash
# Encrypt .env file
gpg --symmetric --cipher-algo AES256 .env
# Creates .env.gpg

# Store securely
mv .env.gpg /secure/backup/location/
```

### Version Control (Encrypted Only)

```bash
# Never commit plain .env!
# Use git-crypt or similar for encrypted secrets

# Install git-crypt
brew install git-crypt  # macOS
apt install git-crypt   # Linux

# Initialize
git-crypt init
echo ".env filter=git-crypt diff=git-crypt" >> .gitattributes
```

## Automated Backups

### Cron Job (Docker)

Create `/etc/cron.d/plexmcp-backup`:

```bash
# Daily backup at 2 AM
0 2 * * * root /opt/plexmcp/scripts/backup.sh /backups/daily

# Weekly backup on Sunday at 3 AM
0 3 * * 0 root /opt/plexmcp/scripts/backup.sh /backups/weekly

# Monthly backup on 1st at 4 AM
0 4 1 * * root /opt/plexmcp/scripts/backup.sh /backups/monthly
```

### Backup Script

Create `scripts/backup.sh`:

```bash
#!/bin/bash
set -e

BACKUP_DIR="${1:-/opt/plexmcp/backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="plexmcp-backup-$TIMESTAMP"

mkdir -p "$BACKUP_DIR"

cd /opt/plexmcp

echo "Starting backup: $BACKUP_NAME"

# Database backup
docker compose exec -T postgres pg_dump -U plexmcp -Fc plexmcp > "$BACKUP_DIR/$BACKUP_NAME.dump"

# Environment backup (encrypted)
gpg --batch --yes --symmetric --cipher-algo AES256 \
  --passphrase-file /etc/plexmcp/backup-key \
  -o "$BACKUP_DIR/$BACKUP_NAME.env.gpg" .env

# Create tarball
tar -czvf "$BACKUP_DIR/$BACKUP_NAME.tar.gz" \
  -C "$BACKUP_DIR" \
  "$BACKUP_NAME.dump" \
  "$BACKUP_NAME.env.gpg"

# Cleanup individual files
rm "$BACKUP_DIR/$BACKUP_NAME.dump" "$BACKUP_DIR/$BACKUP_NAME.env.gpg"

# Retention: keep 7 daily, 4 weekly, 12 monthly
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete

echo "Backup complete: $BACKUP_DIR/$BACKUP_NAME.tar.gz"
```

### Systemd Timer

Create `/etc/systemd/system/plexmcp-backup.service`:

```ini
[Unit]
Description=PlexMCP Backup

[Service]
Type=oneshot
ExecStart=/opt/plexmcp/scripts/backup.sh
User=root
```

Create `/etc/systemd/system/plexmcp-backup.timer`:

```ini
[Unit]
Description=Daily PlexMCP Backup

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable the timer:

```bash
sudo systemctl enable plexmcp-backup.timer
sudo systemctl start plexmcp-backup.timer
```

## Remote Backup Storage

### AWS S3

```bash
# Install AWS CLI
pip install awscli

# Configure credentials
aws configure

# Upload backup
aws s3 cp backup.tar.gz s3://your-bucket/plexmcp-backups/

# Sync backup directory
aws s3 sync /opt/plexmcp/backups s3://your-bucket/plexmcp-backups/
```

### Backblaze B2

```bash
# Install B2 CLI
pip install b2

# Authorize
b2 authorize-account

# Upload
b2 upload-file your-bucket backup.tar.gz plexmcp-backups/backup.tar.gz
```

### Rclone (Any Provider)

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Configure (interactive)
rclone config

# Sync backups
rclone sync /opt/plexmcp/backups remote:plexmcp-backups
```

## Restore Procedures

### Full Restore (Docker)

```bash
# Stop services
docker compose down

# Start only database
docker compose up -d postgres
sleep 10  # Wait for PostgreSQL to be ready

# Drop and recreate database
docker compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS plexmcp"
docker compose exec postgres psql -U postgres -c "CREATE DATABASE plexmcp OWNER plexmcp"

# Restore from dump
docker compose exec -T postgres pg_restore -U plexmcp -d plexmcp < backup.dump

# Or from SQL
cat backup.sql | docker compose exec -T postgres psql -U plexmcp plexmcp

# Restore environment
gpg --decrypt backup.env.gpg > .env

# Start all services
docker compose up -d

# Verify
curl http://localhost:8080/health
```

### Full Restore (Manual)

```bash
# Stop services
sudo systemctl stop plexmcp-api plexmcp-web

# Drop and recreate database
sudo -u postgres psql -c "DROP DATABASE IF EXISTS plexmcp"
sudo -u postgres psql -c "CREATE DATABASE plexmcp OWNER plexmcp"

# Restore
pg_restore -h localhost -U plexmcp -d plexmcp backup.dump

# Restore environment
gpg --decrypt backup.env.gpg > .env

# Start services
sudo systemctl start plexmcp-api plexmcp-web
```

### Partial Restore (Specific Tables)

```bash
# Restore only users table
docker compose exec -T postgres psql -U plexmcp plexmcp < users-backup.sql

# Or use pg_restore with specific table
docker compose exec -T postgres pg_restore -U plexmcp -d plexmcp -t users backup.dump
```

### Point-in-Time Recovery

For point-in-time recovery, enable WAL archiving:

```bash
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'
```

Restore to specific time:

```bash
# Create recovery.conf
recovery_target_time = '2024-01-15 10:00:00'
restore_command = 'cp /var/lib/postgresql/wal_archive/%f %p'
```

## Backup Verification

### Verify Backup Integrity

```bash
# Check dump file
pg_restore --list backup.dump

# Verify SQL syntax (without executing)
psql -U plexmcp -f backup.sql --set ON_ERROR_STOP=on -c "BEGIN; \i backup.sql; ROLLBACK;"
```

### Test Restore

```bash
# Create test database
docker compose exec postgres psql -U postgres -c "CREATE DATABASE plexmcp_test"

# Restore to test database
docker compose exec -T postgres pg_restore -U plexmcp -d plexmcp_test < backup.dump

# Verify data
docker compose exec postgres psql -U plexmcp -d plexmcp_test -c "SELECT COUNT(*) FROM users"

# Cleanup
docker compose exec postgres psql -U postgres -c "DROP DATABASE plexmcp_test"
```

### Automated Verification

Add to backup script:

```bash
# Verify backup
if pg_restore --list "$BACKUP_DIR/$BACKUP_NAME.dump" > /dev/null 2>&1; then
    echo "✅ Backup verified"
else
    echo "❌ Backup verification failed!"
    exit 1
fi
```

## Disaster Recovery

### Recovery Checklist

1. **Assess the situation**
   - Identify what was lost (data, config, or both)
   - Determine the latest good backup

2. **Prepare recovery environment**
   - Fresh server or cleaned existing server
   - Install dependencies (Docker, PostgreSQL, etc.)

3. **Restore configuration**
   - Restore `.env` file
   - Update any environment-specific settings

4. **Restore database**
   - Use latest verified backup
   - Run any pending migrations

5. **Verify recovery**
   - Test authentication
   - Verify data integrity
   - Test MCP connections

6. **Update DNS/networking** (if needed)
   - Point domain to new server
   - Update SSL certificates

### Recovery Time Objectives

| Scenario | Target RTO | Method |
|----------|------------|--------|
| Container crash | 5 minutes | Docker restart |
| Data corruption | 30 minutes | Restore from backup |
| Server failure | 2 hours | New server + restore |
| Region outage | 4 hours | Cross-region restore |

## Best Practices

### Backup Strategy (3-2-1 Rule)

- **3** copies of data
- **2** different storage types
- **1** offsite backup

### Encryption

- Always encrypt backups at rest
- Use strong encryption (AES-256)
- Store encryption keys separately from backups
- Rotate encryption keys periodically

### Testing

- Test restores monthly
- Document restore procedures
- Time your restore process
- Keep restore documentation updated

### Monitoring

```bash
# Alert if backup older than 24 hours
find /opt/plexmcp/backups -name "*.tar.gz" -mtime -1 | grep -q . || \
  echo "WARNING: No recent backup found!"
```

## Next Steps

- [Upgrading →](./upgrading.md)
- [Configuration Reference →](./configuration.md)
- [Docker Deployment →](./docker.md)
