#!/bin/bash
#
# Install Git Hooks for PlexMCP Embeddings
# Sets up post-commit hook to automatically update embeddings
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EMBEDDINGS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$EMBEDDINGS_DIR/.." && pwd)"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

echo "📦 Installing PlexMCP Embeddings Git Hooks"
echo

# Check if .git directory exists
if [ ! -d "$PROJECT_ROOT/.git" ]; then
  echo "❌ Error: Not a git repository ($PROJECT_ROOT)"
  echo "   Make sure you're running this from within the PlexMCP project"
  exit 1
fi

# Ensure hooks directory exists
mkdir -p "$HOOKS_DIR"

# Install post-commit hook
HOOK_SOURCE="$SCRIPT_DIR/post-commit"
HOOK_DEST="$HOOKS_DIR/post-commit"

if [ -f "$HOOK_DEST" ]; then
  echo "⚠️  Post-commit hook already exists"
  echo "   Backing up to post-commit.backup"
  cp "$HOOK_DEST" "$HOOK_DEST.backup"
fi

cp "$HOOK_SOURCE" "$HOOK_DEST"
chmod +x "$HOOK_DEST"

echo "✅ Installed post-commit hook"
echo

# Build embeddings if not already built
if [ ! -f "$EMBEDDINGS_DIR/dist/update-from-commit.js" ]; then
  echo "📦 Building embeddings for first-time setup..."
  cd "$EMBEDDINGS_DIR"
  npm run build
  echo
fi

echo "🎉 Git hooks installed successfully!"
echo
echo "The post-commit hook will now automatically update embeddings"
echo "whenever you make a commit to the PlexMCP repository."
echo
echo "To uninstall: rm $HOOK_DEST"
echo
