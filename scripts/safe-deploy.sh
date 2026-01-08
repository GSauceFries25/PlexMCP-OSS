#!/bin/bash
# Safe deployment script with coordination for multiple agents
set -e

APP_NAME="plexmcp-api"
LOCK_FILE="/tmp/plexmcp-deploy.lock"
MAX_WAIT=300

echo "🚀 Safe Deployment - Checking for concurrent deployments..."

# Check for lock
if [ -f "$LOCK_FILE" ]; then
    lock_age=$(($(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || stat -c %Y "$LOCK_FILE")))
    if [ $lock_age -gt $MAX_WAIT ]; then
        echo "⚠️  Removing stale lock"
        rm -f "$LOCK_FILE"
    else
        echo "❌ Another deployment in progress. Wait or remove $LOCK_FILE"
        exit 1
    fi
fi

# Check Fly.io status
if fly status --app "$APP_NAME" 2>&1 | grep -q "starting\|replacing"; then
    echo "❌ Deployment already in progress on Fly.io"
    exit 1
fi

# Create lock
echo "$$" > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

# Deploy
echo "🚢 Deploying..."
fly deploy --remote-only --strategy rolling
