#!/bin/bash
#
# PlexMCP Database Backup Script
#
# Description: Creates a compressed PostgreSQL backup and uploads to S3
# Usage: ./scripts/backup-database.sh [custom-filename]
# Author: PlexMCP Infrastructure Team
# Last Updated: 2026-01-01

set -euo pipefail

# ==============================================================================
# Configuration
# ==============================================================================

# Backup directory (relative to project root)
BACKUP_DIR="${BACKUP_DIR:-./backups}"

# S3 bucket for backup storage (optional - set via environment variable)
S3_BUCKET="${S3_BUCKET:-plexmcp-backups}"

# Slack webhook for notifications (optional)
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"

# Database connection (defaults to environment variable)
DATABASE_URL="${DATABASE_URL:-}"

# Retention period (days)
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# ==============================================================================
# Helper Functions
# ==============================================================================

# Print colored output
log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1" >&2
}

log_warning() {
    echo -e "\033[0;33m[WARNING]\033[0m $1"
}

# Send Slack notification
send_slack_notification() {
    local message="$1"
    local status="${2:-info}"

    if [ -z "$SLACK_WEBHOOK_URL" ]; then
        log_warning "Slack webhook not configured, skipping notification"
        return 0
    fi

    local color="good"
    local emoji=":white_check_mark:"

    case "$status" in
        success)
            color="good"
            emoji=":white_check_mark:"
            ;;
        error)
            color="danger"
            emoji=":x:"
            ;;
        warning)
            color="warning"
            emoji=":warning:"
            ;;
        *)
            color="#36a64f"
            emoji=":information_source:"
            ;;
    esac

    curl -s -X POST "$SLACK_WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"attachments\": [{
                \"color\": \"$color\",
                \"title\": \"$emoji Database Backup\",
                \"text\": \"$message\",
                \"footer\": \"PlexMCP Infrastructure\",
                \"ts\": $(date +%s)
            }]
        }" > /dev/null || log_warning "Failed to send Slack notification"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Calculate file checksum
calculate_checksum() {
    local file="$1"

    if command_exists sha256sum; then
        sha256sum "$file" | awk '{print $1}'
    elif command_exists shasum; then
        shasum -a 256 "$file" | awk '{print $1}'
    else
        md5 -q "$file" 2>/dev/null || md5sum "$file" | awk '{print $1}'
    fi
}

# ==============================================================================
# Pre-flight Checks
# ==============================================================================

log_info "Starting PlexMCP database backup..."

# Check required commands
if ! command_exists pg_dump; then
    log_error "pg_dump not found. Please install PostgreSQL client tools."
    log_error "  macOS: brew install postgresql@14"
    log_error "  Ubuntu: sudo apt install postgresql-client-14"
    exit 1
fi

if ! command_exists gzip; then
    log_error "gzip not found. Please install gzip."
    exit 1
fi

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    log_error "DATABASE_URL environment variable not set"
    log_error "Usage: DATABASE_URL='postgresql://...' $0"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# ==============================================================================
# Backup Execution
# ==============================================================================

# Generate backup filename
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
CUSTOM_FILENAME="${1:-}"

if [ -n "$CUSTOM_FILENAME" ]; then
    BACKUP_FILE="$BACKUP_DIR/$CUSTOM_FILENAME"
else
    BACKUP_FILE="$BACKUP_DIR/backup-$TIMESTAMP.sql.gz"
fi

UNCOMPRESSED_FILE="${BACKUP_FILE%.gz}"

log_info "Backup file: $BACKUP_FILE"

# Start backup timer
START_TIME=$(date +%s)

# Create database dump
log_info "Creating database dump..."

if pg_dump "$DATABASE_URL" \
    --format=plain \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    --verbose \
    2>&1 | gzip > "$BACKUP_FILE"; then

    log_success "Database dump created successfully"
else
    log_error "Database dump failed"
    send_slack_notification "Database backup FAILED for PlexMCP production database" "error"
    exit 1
fi

# Calculate backup metrics
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
CHECKSUM=$(calculate_checksum "$BACKUP_FILE")

log_info "Backup completed in ${DURATION}s"
log_info "Compressed size: $FILE_SIZE"
log_info "Checksum (SHA256): $CHECKSUM"

# Verify backup can be decompressed
log_info "Verifying backup integrity..."

if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
    log_success "Backup file integrity verified"
else
    log_error "Backup file is corrupted (failed decompression test)"
    send_slack_notification "Database backup CORRUPTED - file cannot be decompressed" "error"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# ==============================================================================
# Upload to S3 (Optional)
# ==============================================================================

if command_exists aws && [ -n "$S3_BUCKET" ]; then
    log_info "Uploading backup to S3: s3://$S3_BUCKET/"

    S3_KEY="backups/$(date +%Y/%m)/backup-$TIMESTAMP.sql.gz"

    if aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/$S3_KEY" \
        --storage-class STANDARD_IA \
        --server-side-encryption AES256 \
        --metadata "checksum=$CHECKSUM,duration=$DURATION"; then

        log_success "Backup uploaded to S3: s3://$S3_BUCKET/$S3_KEY"

        # Save checksum file
        echo "$CHECKSUM  backup-$TIMESTAMP.sql.gz" > "$BACKUP_DIR/backup-$TIMESTAMP.sha256"
        aws s3 cp "$BACKUP_DIR/backup-$TIMESTAMP.sha256" "s3://$S3_BUCKET/$S3_KEY.sha256"
    else
        log_warning "Failed to upload backup to S3 (local backup still available)"
    fi
else
    if [ -z "$S3_BUCKET" ]; then
        log_warning "S3_BUCKET not configured, skipping upload"
    else
        log_warning "AWS CLI not installed, skipping S3 upload"
        log_warning "Install with: brew install awscli (macOS) or apt install awscli (Ubuntu)"
    fi
fi

# ==============================================================================
# Cleanup Old Backups
# ==============================================================================

log_info "Cleaning up backups older than $RETENTION_DAYS days..."

# Find and remove old local backups
OLD_BACKUPS=$(find "$BACKUP_DIR" -name "backup-*.sql.gz" -mtime +$RETENTION_DAYS 2>/dev/null || true)

if [ -n "$OLD_BACKUPS" ]; then
    DELETED_COUNT=0
    while IFS= read -r old_backup; do
        if [ -f "$old_backup" ]; then
            log_info "Deleting old backup: $(basename "$old_backup")"
            rm -f "$old_backup"
            rm -f "${old_backup%.gz}.sha256"
            DELETED_COUNT=$((DELETED_COUNT + 1))
        fi
    done <<< "$OLD_BACKUPS"

    log_success "Deleted $DELETED_COUNT old backup(s)"
else
    log_info "No old backups to clean up"
fi

# Cleanup old S3 backups (if AWS CLI available)
if command_exists aws && [ -n "$S3_BUCKET" ]; then
    log_info "Setting S3 lifecycle policy for automatic cleanup..."

    # Create lifecycle policy if it doesn't exist
    cat > /tmp/s3-lifecycle-policy.json <<EOF
{
    "Rules": [{
        "Id": "DeleteOldBackups",
        "Status": "Enabled",
        "Prefix": "backups/",
        "Expiration": {
            "Days": $RETENTION_DAYS
        },
        "NoncurrentVersionExpiration": {
            "NoncurrentDays": 7
        }
    }, {
        "Id": "TransitionToGlacier",
        "Status": "Enabled",
        "Prefix": "backups/",
        "Transitions": [{
            "Days": 90,
            "StorageClass": "GLACIER"
        }]
    }]
}
EOF

    if aws s3api put-bucket-lifecycle-configuration \
        --bucket "$S3_BUCKET" \
        --lifecycle-configuration file:///tmp/s3-lifecycle-policy.json 2>/dev/null; then
        log_success "S3 lifecycle policy updated"
    else
        log_warning "Failed to update S3 lifecycle policy (may already be configured)"
    fi

    rm -f /tmp/s3-lifecycle-policy.json
fi

# ==============================================================================
# Final Report
# ==============================================================================

log_success "==================================================================="
log_success "Backup completed successfully!"
log_success "==================================================================="
log_success "Backup file: $BACKUP_FILE"
log_success "Size: $FILE_SIZE"
log_success "Checksum: $CHECKSUM"
log_success "Duration: ${DURATION}s"
log_success "==================================================================="

# Send success notification
NOTIFICATION_MESSAGE="Database backup completed successfully\n\n"
NOTIFICATION_MESSAGE+="• File: backup-$TIMESTAMP.sql.gz\n"
NOTIFICATION_MESSAGE+="• Size: $FILE_SIZE\n"
NOTIFICATION_MESSAGE+="• Duration: ${DURATION}s\n"
NOTIFICATION_MESSAGE+="• Checksum: ${CHECKSUM:0:16}..."

if command_exists aws && [ -n "$S3_BUCKET" ]; then
    NOTIFICATION_MESSAGE+="\n• S3: s3://$S3_BUCKET/$S3_KEY"
fi

send_slack_notification "$NOTIFICATION_MESSAGE" "success"

# Output checksum for verification
echo ""
echo "To verify backup integrity, run:"
echo "  gunzip -t $BACKUP_FILE"
echo ""
echo "To restore this backup, run:"
echo "  ./scripts/restore-database.sh $BACKUP_FILE"
echo ""

exit 0
