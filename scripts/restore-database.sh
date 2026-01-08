#!/bin/bash
#
# PlexMCP Database Restore Script
#
# Description: Restores a PostgreSQL database from compressed backup
# Usage: ./scripts/restore-database.sh <backup-file.sql.gz>
# Author: PlexMCP Infrastructure Team
# Last Updated: 2026-01-01
#
# WARNING: This script will DROP and RECREATE the target database!
#          Make sure you have a backup before running this script.

set -euo pipefail

# ==============================================================================
# Configuration
# ==============================================================================

# Database connection (defaults to environment variable)
DATABASE_URL="${DATABASE_URL:-}"

# Slack webhook for notifications (optional)
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"

# Safety confirmation required
REQUIRE_CONFIRMATION="${REQUIRE_CONFIRMATION:-yes}"

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
        return 0
    fi

    local color="good"
    local emoji=":recycle:"

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
    esac

    curl -s -X POST "$SLACK_WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"attachments\": [{
                \"color\": \"$color\",
                \"title\": \"$emoji Database Restore\",
                \"text\": \"$message\",
                \"footer\": \"PlexMCP Infrastructure\",
                \"ts\": $(date +%s)
            }]
        }" > /dev/null || true
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# ==============================================================================
# Pre-flight Checks
# ==============================================================================

log_info "PlexMCP Database Restore Script"

# Check arguments
if [ $# -lt 1 ]; then
    log_error "Usage: $0 <backup-file.sql.gz>"
    log_error "Example: $0 backups/backup-20260101-120000.sql.gz"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Check required commands
if ! command_exists psql; then
    log_error "psql not found. Please install PostgreSQL client tools."
    log_error "  macOS: brew install postgresql@14"
    log_error "  Ubuntu: sudo apt install postgresql-client-14"
    exit 1
fi

if ! command_exists gunzip; then
    log_error "gunzip not found. Please install gzip."
    exit 1
fi

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    log_error "DATABASE_URL environment variable not set"
    log_error "Usage: DATABASE_URL='postgresql://...' $0 $BACKUP_FILE"
    exit 1
fi

# Verify backup file integrity
log_info "Verifying backup file integrity..."

if ! gunzip -t "$BACKUP_FILE" 2>/dev/null; then
    log_error "Backup file is corrupted (failed decompression test)"
    log_error "File: $BACKUP_FILE"
    exit 1
fi

log_success "Backup file integrity verified"

# ==============================================================================
# Safety Confirmation
# ==============================================================================

if [ "$REQUIRE_CONFIRMATION" = "yes" ]; then
    log_warning "==================================================================="
    log_warning "WARNING: This will DESTROY all data in the target database!"
    log_warning "==================================================================="
    log_warning "Target database: ${DATABASE_URL%%\?*}"
    log_warning "Backup file: $BACKUP_FILE"
    log_warning "Backup size: $(du -h "$BACKUP_FILE" | cut -f1)"
    log_warning "Backup date: $(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$BACKUP_FILE" 2>/dev/null || stat -c "%y" "$BACKUP_FILE" 2>/dev/null | cut -d. -f1)"
    log_warning ""
    log_warning "This action is IRREVERSIBLE!"
    log_warning ""

    read -p "Are you absolutely sure you want to proceed? Type 'YES' to confirm: " -r
    echo

    if [ "$REPLY" != "YES" ]; then
        log_info "Restore cancelled by user"
        exit 0
    fi

    log_info "Confirmation received. Proceeding with restore..."
fi

# ==============================================================================
# Restore Execution
# ==============================================================================

# Start restore timer
START_TIME=$(date +%s)

log_info "Starting database restore from: $BACKUP_FILE"

# Extract backup and pipe to psql
log_info "Decompressing and restoring backup..."

if gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" --set ON_ERROR_STOP=on 2>&1; then
    log_success "Database restore completed successfully"
else
    log_error "Database restore failed"
    send_slack_notification "Database restore FAILED for PlexMCP" "error"
    exit 1
fi

# Calculate restore metrics
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

log_info "Restore completed in ${DURATION}s"

# ==============================================================================
# Post-Restore Validation
# ==============================================================================

log_info "Running post-restore validation checks..."

# Check critical tables exist
CRITICAL_TABLES=("users" "organizations" "api_keys" "mcp_instances" "admin_audit_log")
VALIDATION_PASSED=true

for table in "${CRITICAL_TABLES[@]}"; do
    log_info "Checking table: $table"

    ROW_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
    ROW_COUNT=$(echo "$ROW_COUNT" | tr -d ' ')

    if [ "$ROW_COUNT" = "0" ] || [ -z "$ROW_COUNT" ]; then
        log_error "Table $table is empty or missing!"
        VALIDATION_PASSED=false
    else
        log_success "Table $table: $ROW_COUNT rows"
    fi
done

# Check RLS policies
log_info "Verifying RLS policies..."

RLS_POLICY_COUNT=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*)
    FROM pg_policies
    WHERE schemaname = 'public';
" 2>/dev/null || echo "0")

RLS_POLICY_COUNT=$(echo "$RLS_POLICY_COUNT" | tr -d ' ')

if [ "$RLS_POLICY_COUNT" -gt 0 ]; then
    log_success "RLS policies intact: $RLS_POLICY_COUNT policies found"
else
    log_warning "No RLS policies found (may be expected for test database)"
fi

# Check indexes
log_info "Verifying database indexes..."

INDEX_COUNT=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*)
    FROM pg_indexes
    WHERE schemaname = 'public';
" 2>/dev/null || echo "0")

INDEX_COUNT=$(echo "$INDEX_COUNT" | tr -d ' ')

if [ "$INDEX_COUNT" -gt 0 ]; then
    log_success "Database indexes intact: $INDEX_COUNT indexes found"
else
    log_warning "No indexes found (may indicate restore issue)"
    VALIDATION_PASSED=false
fi

# Final validation result
if [ "$VALIDATION_PASSED" = true ]; then
    log_success "==================================================================="
    log_success "Database restore completed and validated successfully!"
    log_success "==================================================================="
    log_success "Duration: ${DURATION}s"
    log_success "Critical tables verified: ${#CRITICAL_TABLES[@]}/${#CRITICAL_TABLES[@]}"
    log_success "RLS policies: $RLS_POLICY_COUNT"
    log_success "Indexes: $INDEX_COUNT"
    log_success "==================================================================="

    # Send success notification
    NOTIFICATION_MESSAGE="Database restore completed successfully\n\n"
    NOTIFICATION_MESSAGE+="• Backup: $(basename "$BACKUP_FILE")\n"
    NOTIFICATION_MESSAGE+="• Duration: ${DURATION}s\n"
    NOTIFICATION_MESSAGE+="• Tables validated: ${#CRITICAL_TABLES[@]}\n"
    NOTIFICATION_MESSAGE+="• RLS policies: $RLS_POLICY_COUNT\n"
    NOTIFICATION_MESSAGE+="• Indexes: $INDEX_COUNT"

    send_slack_notification "$NOTIFICATION_MESSAGE" "success"

    exit 0
else
    log_error "==================================================================="
    log_error "Database restore completed but validation FAILED!"
    log_error "==================================================================="
    log_error "Some validation checks failed. Review the logs above."
    log_error "The database may not be in a consistent state."
    log_error "==================================================================="

    send_slack_notification "Database restore completed but validation FAILED" "error"

    exit 1
fi
