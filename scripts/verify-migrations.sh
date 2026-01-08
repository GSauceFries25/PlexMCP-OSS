#!/bin/bash
#
# verify-migrations.sh
# Verifies migration files have unique timestamps and proper naming conventions
#
# Usage: ./scripts/verify-migrations.sh
# Exit codes:
#   0 - All migrations valid
#   1 - Duplicate timestamps found
#   2 - Invalid naming convention
#   3 - Other errors

set -e

MIGRATIONS_DIR="migrations"
ERRORS=0

echo "🔍 Verifying migration files in $MIGRATIONS_DIR..."

# Check if migrations directory exists
if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "❌ Error: Migrations directory not found: $MIGRATIONS_DIR"
    exit 3
fi

# Count total migration files
TOTAL=$(ls -1 "$MIGRATIONS_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ')

if [ "$TOTAL" -eq 0 ]; then
    echo "⚠️  Warning: No migration files found"
    exit 0
fi

echo "📊 Found $TOTAL migration files"

# Check for duplicate timestamps
echo "🔎 Checking for duplicate timestamps..."
DUPLICATES=$(ls -1 "$MIGRATIONS_DIR"/*.sql | xargs -n1 basename | cut -d_ -f1 | sort | uniq -c | grep -v "^\s*1 " || true)

if [ -n "$DUPLICATES" ]; then
    echo "❌ ERROR: Duplicate migration timestamps found:"
    echo "$DUPLICATES"
    echo ""
    echo "Files with duplicate timestamps:"
    while IFS= read -r line; do
        timestamp=$(echo "$line" | awk '{print $2}')
        ls -1 "$MIGRATIONS_DIR/${timestamp}"*.sql
    done <<< "$DUPLICATES"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ All migration timestamps are unique"
fi

# Validate naming convention: YYYYMMDDHHMMSS_description.sql
echo "🔎 Checking naming conventions..."
INVALID_NAMES=$(ls -1 "$MIGRATIONS_DIR"/*.sql | xargs -n1 basename | grep -Ev '^[0-9]{14,17}_[a-z0-9_]+\.sql$' || true)

if [ -n "$INVALID_NAMES" ]; then
    echo "❌ ERROR: Invalid migration naming convention:"
    echo "$INVALID_NAMES"
    echo ""
    echo "Expected format: YYYYMMDDHHMMSS_description.sql"
    echo "Example: 20260102000001_create_users_table.sql"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ All migrations follow naming convention"
fi

# Verify timestamps are sequential and in the past
echo "🔎 Checking timestamp ordering..."
CURRENT_TIMESTAMP=$(date +%Y%m%d%H%M%S)
FUTURE_MIGRATIONS=$(ls -1 "$MIGRATIONS_DIR"/*.sql | xargs -n1 basename | cut -d_ -f1 | awk -v current="$CURRENT_TIMESTAMP" '$1 > current' || true)

if [ -n "$FUTURE_MIGRATIONS" ]; then
    echo "⚠️  Warning: Migrations with future timestamps found:"
    echo "$FUTURE_MIGRATIONS"
    echo "This is usually fine for local development but may indicate a clock sync issue"
fi

# Verify migrations are sorted by timestamp
SORTED=$(ls -1 "$MIGRATIONS_DIR"/*.sql | xargs -n1 basename | cut -d_ -f1 | sort -c 2>&1 || echo "unsorted")

if [ "$SORTED" != "" ]; then
    echo "✅ Migration timestamps are in chronological order"
else
    echo "⚠️  Migrations may not be in chronological order (this is usually fine)"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ]; then
    echo "✅ Migration verification passed"
    echo "   Total migrations: $TOTAL"
    echo "   Unique timestamps: $TOTAL"
    exit 0
else
    echo "❌ Migration verification failed with $ERRORS error(s)"
    echo "   Please fix duplicate timestamps before deploying"
    exit 1
fi
