#!/bin/bash
#
# create-admin.sh
# Creates a PlexMCP superadmin user via direct database access
#
# WARNING: This script should only be used for initial setup or emergency admin creation
# Normal user creation should go through the signup API
#
# Usage:
#   ./scripts/create-admin.sh
#   DATABASE_URL="..." ./scripts/create-admin.sh
#
# Environment variables:
#   DATABASE_URL - PostgreSQL connection string (required)
#
# Security:
#   - Passwords are hashed with Argon2id before storage
#   - Email is validated for basic format
#   - Creates both user and organization records
#   - Sets platform_role to 'superadmin'

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   PlexMCP Superadmin Creation Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}ERROR: DATABASE_URL environment variable not set${NC}"
    echo ""
    echo "Usage:"
    echo "  DATABASE_URL='postgres://user:pass@host/db' ./scripts/create-admin.sh"
    exit 1
fi

# Prompt for admin details
echo "Enter superadmin details:"
echo ""

read -p "Email: " ADMIN_EMAIL
if [ -z "$ADMIN_EMAIL" ]; then
    echo -e "${RED}ERROR: Email cannot be empty${NC}"
    exit 1
fi

# Basic email validation
if ! echo "$ADMIN_EMAIL" | grep -qE "^[^@]+@[^@]+\.[^@]+$"; then
    echo -e "${RED}ERROR: Invalid email format${NC}"
    exit 1
fi

read -p "Full Name: " ADMIN_NAME
if [ -z "$ADMIN_NAME" ]; then
    echo -e "${RED}ERROR: Name cannot be empty${NC}"
    exit 1
fi

read -sp "Password (min 12 chars): " ADMIN_PASSWORD
echo ""

if [ ${#ADMIN_PASSWORD} -lt 12 ]; then
    echo -e "${RED}ERROR: Password must be at least 12 characters${NC}"
    exit 1
fi

read -sp "Confirm Password: " ADMIN_PASSWORD_CONFIRM
echo ""

if [ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]; then
    echo -e "${RED}ERROR: Passwords do not match${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}⚠️  WARNING: Creating superadmin account${NC}"
echo "  Email: $ADMIN_EMAIL"
echo "  Name: $ADMIN_NAME"
echo "  Role: superadmin"
echo ""
read -p "Continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted"
    exit 0
fi

# Hash the password using PlexMCP's hash-password utility
echo ""
echo "🔐 Hashing password..."
PASSWORD_HASH=$(echo "$ADMIN_PASSWORD" | cargo run --quiet --bin hash-password 2>/dev/null | grep '^\$argon2' | head -1)

if [ -z "$PASSWORD_HASH" ]; then
    echo -e "${RED}ERROR: Failed to hash password${NC}"
    echo "Make sure cargo and the hash-password binary are available"
    exit 1
fi

# Create SQL script
SQL_SCRIPT=$(cat <<EOF
-- Create superadmin user and organization
DO \$\$
DECLARE
    v_org_id UUID;
    v_user_id UUID;
    v_email TEXT := '$ADMIN_EMAIL';
    v_name TEXT := '$ADMIN_NAME';
    v_password_hash TEXT := '$PASSWORD_HASH';
BEGIN
    -- Check if user already exists
    IF EXISTS (SELECT 1 FROM users WHERE email = v_email) THEN
        RAISE EXCEPTION 'User with email % already exists', v_email;
    END IF;

    -- Generate UUIDs
    v_org_id := gen_random_uuid();
    v_user_id := gen_random_uuid();

    -- Create organization
    INSERT INTO organizations (id, name, created_at, updated_at)
    VALUES (v_org_id, v_name || '''s Organization', NOW(), NOW());

    -- Create superadmin user
    INSERT INTO users (
        id,
        email,
        password_hash,
        name,
        org_id,
        role,
        platform_role,
        email_verified,
        created_at,
        updated_at,
        last_login_at
    ) VALUES (
        v_user_id,
        v_email,
        v_password_hash,
        v_name,
        v_org_id,
        'owner',
        'superadmin',
        TRUE,  -- Email verified by default for superadmin
        NOW(),
        NOW(),
        NOW()
    );

    RAISE NOTICE 'Successfully created superadmin: % (ID: %)', v_email, v_user_id;
    RAISE NOTICE 'Organization: % (ID: %)', v_name || '''s Organization', v_org_id;
END \$\$;
EOF
)

# Execute SQL
echo ""
echo "🔨 Creating superadmin in database..."
echo "$SQL_SCRIPT" | psql "$DATABASE_URL" 2>&1 | grep -E "NOTICE|ERROR" || true

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Superadmin created successfully!${NC}"
    echo ""
    echo "Login credentials:"
    echo "  Email: $ADMIN_EMAIL"
    echo "  Password: (the password you entered)"
    echo ""
    echo "⚠️  SECURITY REMINDERS:"
    echo "  1. Change this password immediately after first login"
    echo "  2. Enable 2FA for this account"
    echo "  3. Do not share these credentials"
    echo "  4. This account has full system access"
else
    echo ""
    echo -e "${RED}❌ Failed to create superadmin${NC}"
    echo "Check the error messages above"
    exit 1
fi
