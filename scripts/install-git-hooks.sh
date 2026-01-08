#!/usr/bin/env bash
# Installs pre-commit and post-commit hooks for CodeRabbit

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOKS_DIR="$REPO_ROOT/.git/hooks"

echo "📦 Installing CodeRabbit git hooks..."

# Create pre-commit hook
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/usr/bin/env bash
# CodeRabbit pre-commit review

echo "🐰 Running CodeRabbit review on staged files..."

# Detect available timeout command (macOS compatibility)
if command -v gtimeout &> /dev/null; then
  TIMEOUT_CMD="gtimeout"
elif command -v timeout &> /dev/null; then
  TIMEOUT_CMD="timeout"
else
  echo "⚠️  WARNING: No timeout command found (timeout/gtimeout)"
  echo "   macOS users: Install GNU coreutils with:"
  echo "   brew install coreutils"
  echo ""
  echo "   Continuing without timeout protection..."
  TIMEOUT_CMD=""
fi

# Run CodeRabbit with timeout (if available)
if [ -n "$TIMEOUT_CMD" ]; then
  $TIMEOUT_CMD 30s coderabbit --prompt-only --type staged 2>&1 || {
    exit_code=$?
    if [ $exit_code -eq 124 ]; then
      echo "⚠️  CodeRabbit timed out (>30s). Allowing commit."
      echo "   Run 'npm run cr:uncommitted' to review manually."
    else
      echo "⚠️  CodeRabbit failed. Allowing commit anyway."
    fi
    exit 0  # Never block commit
  }
else
  # No timeout available - run without timeout
  coderabbit --prompt-only --type staged 2>&1 || {
    echo "⚠️  CodeRabbit failed. Allowing commit anyway."
    exit 0
  }
fi

# Re-stage auto-fixed files (macOS/BSD compatible)
git diff --name-only --staged | while read -r file; do
  [ -f "$file" ] && git add "$file"
done 2>/dev/null || true

echo "✓ CodeRabbit review complete"
EOF

# Update post-commit hook (idempotent - check before appending)
MARKER="# Store CodeRabbit review in memory bank"

if [ -f "$HOOKS_DIR/post-commit" ]; then
  # Only append if marker not found
  if ! grep -q "$MARKER" "$HOOKS_DIR/post-commit"; then
    cat >> "$HOOKS_DIR/post-commit" << 'EOF'

# Store CodeRabbit review in memory bank
REPO_ROOT=$(git rev-parse --show-toplevel)
bash "$REPO_ROOT/scripts/store-coderabbit-review.sh" 2>&1 || true
EOF
  else
    echo "Post-commit hook already contains CodeRabbit block, skipping..."
  fi
else
  # Create new post-commit hook
  cat > "$HOOKS_DIR/post-commit" << 'EOF'
#!/usr/bin/env bash
# PlexMCP Post-Commit Hook

# Store CodeRabbit review in memory bank
REPO_ROOT=$(git rev-parse --show-toplevel)
bash "$REPO_ROOT/scripts/store-coderabbit-review.sh" 2>&1 || true
EOF
fi

chmod +x "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/post-commit"

echo "✓ Git hooks installed successfully!"
echo ""
echo "Pre-commit hook: Reviews staged files (30s timeout)"
echo "Post-commit hook: Stores reviews in memory bank"
echo ""
echo "To bypass: git commit --no-verify"
