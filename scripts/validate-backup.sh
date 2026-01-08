#!/bin/bash
#
# PlexMCP Backup Validation Script
#
# Description: Validates backup file integrity without restoring
# Usage: ./scripts/validate-backup.sh <backup-file.sql.gz>
# Author: PlexMCP Infrastructure Team
# Last Updated: 2026-01-01

set -euo pipefail

# ==============================================================================
# Configuration
# ==============================================================================

# Minimum expected file size (in bytes) - 1MB
MIN_FILE_SIZE=1048576

# Expected critical tables
CRITICAL_TABLES=("users" "organizations" "api_keys" "mcp_instances" "admin_audit_log" "auth_audit_log")

# ==============================================================================
# Helper Functions
# ==============================================================================

# Print colored output
log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[0;32m[✓]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[✗]\033[0m $1"
}

log_warning() {
    echo -e "\033[0;33m[!]\033[0m $1"
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

log_info "PlexMCP Backup Validation Script"
echo ""

# Check arguments
if [ $# -lt 1 ]; then
    log_error "Usage: $0 <backup-file.sql.gz>"
    log_error "Example: $0 backups/backup-20260101-120000.sql.gz"
    exit 1
fi

BACKUP_FILE="$1"

# ==============================================================================
# Validation Tests
# ==============================================================================

VALIDATION_PASSED=true

# Test 1: File exists
log_info "Test 1: Checking if file exists..."
if [ -f "$BACKUP_FILE" ]; then
    log_success "File exists: $BACKUP_FILE"
else
    log_error "File not found: $BACKUP_FILE"
    exit 1
fi

# Test 2: File size
log_info "Test 2: Checking file size..."
FILE_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)

if [ "$FILE_SIZE" -ge "$MIN_FILE_SIZE" ]; then
    FILE_SIZE_HUMAN=$(du -h "$BACKUP_FILE" | cut -f1)
    log_success "File size is reasonable: $FILE_SIZE_HUMAN ($FILE_SIZE bytes)"
else
    log_error "File size too small: $FILE_SIZE bytes (expected at least $MIN_FILE_SIZE bytes)"
    VALIDATION_PASSED=false
fi

# Test 3: Checksum calculation
log_info "Test 3: Calculating checksum..."
CHECKSUM=$(calculate_checksum "$BACKUP_FILE")

if [ -n "$CHECKSUM" ]; then
    log_success "Checksum calculated: $CHECKSUM"

    # Check if there's a matching .sha256 file
    CHECKSUM_FILE="${BACKUP_FILE%.gz}.sha256"
    if [ -f "$CHECKSUM_FILE" ]; then
        EXPECTED_CHECKSUM=$(cat "$CHECKSUM_FILE" | awk '{print $1}')

        if [ "$CHECKSUM" = "$EXPECTED_CHECKSUM" ]; then
            log_success "Checksum matches expected value"
        else
            log_error "Checksum mismatch!"
            log_error "  Expected: $EXPECTED_CHECKSUM"
            log_error "  Actual:   $CHECKSUM"
            VALIDATION_PASSED=false
        fi
    else
        log_warning "No checksum file found (expected: $CHECKSUM_FILE)"
    fi
else
    log_error "Failed to calculate checksum"
    VALIDATION_PASSED=false
fi

# Test 4: Decompression
log_info "Test 4: Testing decompression..."

if ! command_exists gunzip; then
    log_error "gunzip not found. Cannot test decompression."
    VALIDATION_PASSED=false
else
    if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
        log_success "File decompresses successfully"
    else
        log_error "File is corrupted (failed decompression test)"
        VALIDATION_PASSED=false
    fi
fi

# Test 5: SQL syntax check (basic)
log_info "Test 5: Checking SQL syntax..."

if command_exists gunzip; then
    # Extract first 1000 lines and check for SQL keywords
    SQL_SAMPLE=$(gunzip -c "$BACKUP_FILE" | head -n 1000)

    # Check for common SQL keywords
    if echo "$SQL_SAMPLE" | grep -qE "(CREATE TABLE|INSERT INTO|ALTER TABLE)"; then
        log_success "SQL syntax appears valid (found SQL keywords)"
    else
        log_warning "No SQL keywords found in first 1000 lines (may be compressed differently)"
    fi

    # Check for errors in SQL
    if echo "$SQL_SAMPLE" | grep -qiE "(ERROR|FATAL|PANIC)"; then
        log_error "Found error messages in SQL dump"
        VALIDATION_PASSED=false
    fi
else
    log_warning "Cannot check SQL syntax (gunzip not available)"
fi

# Test 6: Check for expected tables
log_info "Test 6: Checking for expected tables..."

if command_exists gunzip; then
    SQL_CONTENT=$(gunzip -c "$BACKUP_FILE" 2>/dev/null || echo "")

    FOUND_TABLES=0
    for table in "${CRITICAL_TABLES[@]}"; do
        if echo "$SQL_CONTENT" | grep -q "CREATE TABLE.*$table"; then
            log_success "Found table: $table"
            FOUND_TABLES=$((FOUND_TABLES + 1))
        else
            log_warning "Table not found in backup: $table"
        fi
    done

    if [ "$FOUND_TABLES" -eq "${#CRITICAL_TABLES[@]}" ]; then
        log_success "All expected tables present (${FOUND_TABLES}/${#CRITICAL_TABLES[@]})"
    elif [ "$FOUND_TABLES" -ge 3 ]; then
        log_warning "Some expected tables missing (${FOUND_TABLES}/${#CRITICAL_TABLES[@]} found)"
    else
        log_error "Too many expected tables missing (${FOUND_TABLES}/${#CRITICAL_TABLES[@]} found)"
        VALIDATION_PASSED=false
    fi
else
    log_warning "Cannot check for expected tables (gunzip not available)"
fi

# Test 7: Row count estimation
log_info "Test 7: Estimating row count..."

if command_exists gunzip; then
    INSERT_COUNT=$(gunzip -c "$BACKUP_FILE" 2>/dev/null | grep -c "^INSERT INTO" || echo "0")

    if [ "$INSERT_COUNT" -gt 0 ]; then
        log_success "Found $INSERT_COUNT INSERT statements"
    else
        log_warning "No INSERT statements found (may be a schema-only backup)"
    fi
else
    log_warning "Cannot estimate row count (gunzip not available)"
fi

# Test 8: Backup metadata
log_info "Test 8: Checking backup metadata..."

# Get file creation date
if command -v stat >/dev/null 2>&1; then
    BACKUP_DATE=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$BACKUP_FILE" 2>/dev/null || stat -c "%y" "$BACKUP_FILE" 2>/dev/null | cut -d. -f1)
    log_success "Backup created: $BACKUP_DATE"

    # Check if backup is older than 30 days
    if command -v date >/dev/null 2>&1; then
        BACKUP_AGE_DAYS=$(( ($(date +%s) - $(stat -f%m "$BACKUP_FILE" 2>/dev/null || stat -c%Y "$BACKUP_FILE" 2>/dev/null)) / 86400 ))

        if [ "$BACKUP_AGE_DAYS" -gt 30 ]; then
            log_warning "Backup is $BACKUP_AGE_DAYS days old (older than retention policy)"
        else
            log_success "Backup age: $BACKUP_AGE_DAYS days (within retention policy)"
        fi
    fi
else
    log_warning "Cannot determine backup date (stat not available)"
fi

# ==============================================================================
# Final Report
# ==============================================================================

echo ""
echo "==================================================================="

if [ "$VALIDATION_PASSED" = true ]; then
    log_success "All validation checks PASSED"
    log_success "==================================================================="
    log_success "Backup file: $BACKUP_FILE"
    log_success "Size: $FILE_SIZE_HUMAN"
    log_success "Checksum: $CHECKSUM"

    if [ -n "${BACKUP_DATE:-}" ]; then
        log_success "Created: $BACKUP_DATE"
    fi

    log_success "==================================================================="
    echo ""
    log_info "This backup appears to be valid and can be used for restoration."
    echo ""
    log_info "To restore this backup, run:"
    log_info "  DATABASE_URL='postgresql://...' ./scripts/restore-database.sh $BACKUP_FILE"
    echo ""

    exit 0
else
    log_error "Validation FAILED"
    log_error "==================================================================="
    log_error "One or more validation checks failed."
    log_error "Review the errors above before attempting to restore this backup."
    log_error "==================================================================="
    echo ""

    exit 1
fi
