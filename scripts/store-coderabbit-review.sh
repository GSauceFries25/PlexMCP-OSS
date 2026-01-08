#!/usr/bin/env bash
# Stores CodeRabbit review results in memory bank

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
REVIEWS_DIR="$REPO_ROOT/.coderabbit/reviews"
mkdir -p "$REVIEWS_DIR"

# Get latest commit hash
COMMIT_HASH=$(git rev-parse --short HEAD)
TIMESTAMP=$(date +"%Y-%m-%d-%H%M%S")
FILENAME="$TIMESTAMP-$COMMIT_HASH"

# Run CodeRabbit and capture output
echo "📝 Storing CodeRabbit review for commit $COMMIT_HASH..."

# Run review and save output (CodeRabbit CLI outputs text in plain mode)
# Compare current HEAD against previous commit (HEAD~1)
# Use gtimeout to prevent hanging (2 minutes max)
gtimeout 120s coderabbit review --base-commit HEAD~1 --plain > "$REVIEWS_DIR/$FILENAME.txt" 2>&1 || {
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "⚠️  CodeRabbit review timed out. Skipping storage."
  else
    echo "⚠️  CodeRabbit review failed. Skipping storage."
  fi
  exit 0
}

# Create markdown from text output for memory bank indexing
{
  echo "# CodeRabbit Review - $COMMIT_HASH"
  echo ""
  echo "**Date:** $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo ""
  echo "## Review Output"
  echo ""
  cat "$REVIEWS_DIR/$FILENAME.txt"
} > "$REVIEWS_DIR/$FILENAME.md"

echo "✓ Review stored: .coderabbit/reviews/$FILENAME.md"
