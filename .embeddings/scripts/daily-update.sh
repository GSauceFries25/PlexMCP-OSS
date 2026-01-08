#!/bin/bash
#
# Daily Embeddings Update
# Reindexes files modified in the last 24 hours
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EMBEDDINGS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$EMBEDDINGS_DIR/.." && pwd)"

echo "🔄 PlexMCP Daily Embeddings Update"
echo "$(date)"
echo

cd "$PROJECT_ROOT"

# Find files modified in last 24 hours
echo "📁 Finding files modified in last 24 hours..."

MODIFIED_FILES=$(find . \
  -type f \
  \( -name "*.rs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.md" -o -name "*.sql" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/target/*" \
  -not -path "*/.git/*" \
  -not -path "*/.embeddings/*" \
  -mtime -1 \
  2>/dev/null || true)

if [ -z "$MODIFIED_FILES" ]; then
  echo "✓ No files modified in last 24 hours"
  exit 0
fi

FILE_COUNT=$(echo "$MODIFIED_FILES" | wc -l | tr -d ' ')
echo "📝 Found $FILE_COUNT modified file(s)"
echo

# Update embeddings
cd "$EMBEDDINGS_DIR"

# Ensure built
if [ ! -f "dist/update-from-commit.js" ]; then
  echo "📦 Building embeddings..."
  npm run build
  echo
fi

# Process each file
echo "🔄 Updating embeddings..."
for file in $MODIFIED_FILES; do
  # Remove leading ./
  file_clean="${file#./}"
  echo "  Processing: $file_clean"
done

# Use the update script
echo "$MODIFIED_FILES" | sed 's|^\./||' | node dist/update-from-commit.js "$(cat)"

echo
echo "✅ Daily update complete!"
echo "$(date)"
