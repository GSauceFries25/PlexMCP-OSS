# Code Quality & Review System

## Overview

PlexMCP uses a **multi-layered code quality system** powered by CodeRabbit CLI to maintain zero technical debt and enforce consistent standards across the codebase.

### Four-Layer Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                   LAYER 1: Interactive                  │
│              Claude Code + CodeRabbit CLI               │
│  Claude runs: coderabbit --prompt-only (background)     │
│  Reads results, creates fix tasks, iterates             │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                LAYER 2: Automated Checks                │
│  Pre-commit: Staged files review (30s timeout)          │
│  File Watcher: Real-time on save (1-min rate limit)     │
│  Post-commit: Store review in memory bank               │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                 LAYER 3: Memory Bank                    │
│  .coderabbit/reviews/*.md indexed in embeddings         │
│  New MCP tool: find_code_quality_issues()               │
│  Claude can search: "past auth security issues"         │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                  LAYER 4: CI/CD                         │
│  GitHub Actions: PR checks, deploy gates, daily scans   │
│  Enforces quality standards team-wide                   │
└─────────────────────────────────────────────────────────┘
```

---

## Prerequisites & Setup

Before using the CodeRabbit code quality system, you must install and authenticate the CodeRabbit CLI.

### 1. Install CodeRabbit CLI

**macOS/Linux:**
```bash
curl -fsSL https://cli.coderabbit.ai/install.sh | sh
```

**Verify installation:**
```bash
coderabbit --version
```

**Documentation:** https://docs.coderabbit.ai/cli

### 2. Authenticate

```bash
coderabbit auth login
```

This will open your browser for authentication. Follow the prompts to authenticate with your CodeRabbit account.

**Check authentication status:**
```bash
coderabbit auth status
```

You should see your account details confirming successful authentication.

### 3. Test the Setup

Once authenticated, verify everything works:

```bash
cd .embeddings
npm run cr              # Review current changes
```

**Required:**
- CodeRabbit account (https://coderabbit.ai)
- Git repository initialized
- Node.js 18+ (for npm scripts)

**Common issues:**
- If `coderabbit: command not found`, ensure the install script added it to your PATH and restart your terminal
- If authentication fails, try `coderabbit auth logout` then `coderabbit auth login` again
- Check installation: `which coderabbit`

---

## Interactive Workflow (Primary - Layer 1)

### Pattern 1: Implement + Review

**Recommended for new features and significant changes.**

```text
User: "Implement user authentication with JWT tokens,
       then run coderabbit --prompt-only in the background"

Claude:
  1. ✅ Implements authentication system
  2. 🐰 Runs: coderabbit --prompt-only --type uncommitted
  3. ⏳ Waits for review completion (7-30 minutes)
  4. 📖 Reads token-efficient output
  5. 📋 Creates task list from issues found
  6. 🔧 Fixes critical/high issues iteratively
  7. ✅ Re-reviews until clean
```

**Example output from CodeRabbit:**

```markdown
## CodeRabbit Review - Uncommitted Changes

**Files Reviewed:** 8
**Issues Found:** 12

### Critical Issues (2)

1. **SQL Injection Vulnerability** (crates/api/src/auth.rs:45)
   - Using string interpolation in SQL query
   - Suggested fix: Use parameterized query with sqlx::query!

2. **Unhandled Error** (crates/api/src/auth.rs:78)
   - Result unwrapped without error handling
   - Suggested fix: Use proper error propagation with ?

### High Severity (3)
...
```

### Pattern 2: Review Before Commit

**Quick check before committing.**

```bash
cd .embeddings
npm run cr:uncommitted
```

**Claude workflow:**
```text
User: "Review my changes before I commit"

Claude:
  1. Runs: npm run cr:uncommitted
  2. Analyzes output
  3. Reports findings to user
  4. Offers to fix issues or proceed with commit
```

### Pattern 3: Review After Implementation

**Post-implementation audit.**

```text
User: "I just finished implementing the billing system.
       Can you review it with CodeRabbit?"

Claude:
  1. Runs: npm run cr:full
  2. Comprehensive review against main branch
  3. Creates detailed fix list
  4. Works through issues systematically
```

---

## Automated Checks (Layer 2)

### Pre-commit Hook

**Installed via:** `bash scripts/install-git-hooks.sh`

**Behavior:**

```bash
$ git commit -m "Add user authentication"

🐰 Running CodeRabbit review on staged files...
⏳ Reviewing 8 files...
✓ CodeRabbit review complete
✓ Auto-fixed 3 minor issues
✓ Re-staged fixed files

[main abc1234] Add user authentication
 8 files changed, 234 insertions(+), 12 deletions(-)
```

**Key Features:**

- **30-second timeout** - Never blocks commits
- **Only staged files** - Fast, focused reviews
- **Auto-fix safe issues** - Formatting, simple cleanups
- **Graceful failure** - If timeout/error, allows commit anyway
- **Bypass available** - `git commit --no-verify`

**When it runs:**
- Before every `git commit`
- Skipped if no staged files
- Skipped with `--no-verify` flag

### File Watcher Integration

**Runs automatically** when embeddings watcher is active.

**Behavior:**

```bash
$ npm run dev  # In .embeddings directory

🔍 Watching for file changes...
📝 Modified: crates/api/src/auth.rs
🐰 Running CodeRabbit (background)...
✓ Review queued (results in 7-30 minutes)
```

**Key Features:**

- **1-minute rate limit** - Prevents API spam
- **30-second timeout** - Non-blocking
- **Background execution** - Doesn't interrupt development
- **Silent failures** - Never disrupts workflow

**When it runs:**
- On file save (with 1-minute cooldown)
- Only for Rust/TypeScript files
- Only when watcher is active

### Post-commit Hook

**Runs automatically** after every commit.

**Behavior:**

```bash
$ git commit -m "Implement user auth"

[main abc1234] Implement user auth

📝 Storing CodeRabbit review for commit abc1234...
✓ Review stored: .coderabbit/reviews/2025-12-29-151530-abc1234.md
```

**What it does:**

1. Runs CodeRabbit review on last commit
2. Saves JSON output to `.coderabbit/reviews/`
3. Generates markdown summary
4. Embeddings watcher indexes review
5. Review becomes searchable in memory bank

---

## Memory Bank Integration (Layer 3)

### Review Storage

All CodeRabbit reviews are stored in `.coderabbit/reviews/` with naming pattern:

```text
.coderabbit/reviews/
├── 2025-12-29-143022-abc1234.json  # Raw CodeRabbit output
├── 2025-12-29-143022-abc1234.md    # Human-readable summary
├── 2025-12-29-151530-def5678.json
└── 2025-12-29-151530-def5678.md
```

**Indexed by embeddings system** - Searchable via semantic search.

### Searching Past Reviews

**New MCP tool:** `find_code_quality_issues()`

**Usage from Claude Code:**

```text
User: "Have we had any security issues with authentication in the past?"

Claude: [Uses find_code_quality_issues tool]
  - query: "authentication security issues"
  - severity: "high"
  - max_results: 10

Results:
  1. SQL injection in login endpoint (2025-12-15)
  2. JWT secret hardcoded (2025-12-10)
  3. Password validation bypass (2025-12-05)
  ...
```

**Tool Parameters:**

```typescript
{
  query: string           // Natural language query
  severity?: string       // Filter: critical|high|medium|low
  file_pattern?: string   // Filter by file path
  max_results?: number    // Default: 10
}
```

**Example Queries:**

- "What billing-related bugs have we fixed?"
- "Show me all critical security issues from December"
- "Past issues with database migrations"
- "TypeScript type errors in the frontend"

### Learning from History

The memory bank enables:

- **Pattern recognition** - Identify recurring issues
- **Knowledge preservation** - New team members learn from past mistakes
- **Trend analysis** - Track code quality over time
- **Root cause analysis** - Find systemic problems

---

## CI/CD Pipeline (Layer 4)

### PR Quality Checks

**Workflow:** `.github/workflows/pr-checks.yml`

**Runs on:** Every pull request to `main` or `develop`

**Jobs:**

1. **rust-checks**
   - cargo fmt --check
   - cargo clippy (treats warnings as errors)
   - cargo test --workspace
   - cargo build --release

2. **frontend-checks**
   - npm run lint
   - npx tsc --noEmit (type checking)
   - npm test
   - npm run build

3. **coderabbit-review**
   - Full CodeRabbit review vs base branch
   - Outputs to GitHub Step Summary
   - **Blocks merge if critical issues found**

4. **quality-gate**
   - Requires all jobs to pass
   - Final approval checkpoint

**GitHub UI:**

```text
✅ rust-checks
✅ frontend-checks
✅ coderabbit-review (3 high severity issues found)
✅ quality-gate

⚠️  3 high severity issues detected. Review before merging.
```

### Deployment Workflow

**Workflow:** `.github/workflows/deploy.yml`

**Runs on:** Push to `main` or manual trigger

**Steps:**

1. **quality-checks** - Reuses PR checks workflow
2. **deploy** - Deploys to Fly.io (only if quality passes)
3. **post-deploy** - Health checks and notifications

**Quality gate prevents broken code from reaching production.**

### Daily Quality Scans

**Workflow:** `.github/workflows/daily-quality.yml`

**Runs:** Daily at 2 AM UTC (or manual trigger)

**What it does:**

1. **Full codebase CodeRabbit review** against main
2. **Saves artifacts** (JSON + markdown, 30-day retention)
3. **Security audit** (cargo audit + npm audit)
4. **Creates GitHub issue** if critical issues found

**Example issue created:**

```markdown
🚨 Critical Code Quality Issues Found - 2025-12-29

## Daily Code Quality Scan Results

Scan detected 5 critical issues and 12 high-severity issues.

**Scan Details:**
- Run #42
- Date: 2025-12-29T02:00:00Z
- [View Full Report](link)

## Top Issues

1. SQL injection in billing.rs:234
2. Unhandled error in auth.rs:456
...

## Action Required

Please review and address critical issues before next release.
```

---

## Configuration

### Main Configuration: `.coderabbit.yaml`

```yaml
language: rust,typescript

reviews:
  profile: balanced  # balanced | thorough | chill

  path_filters:
    # Rust backend - strict security
    crates/**/*.rs:
      - security: strict
      - unsafe_code: justify
      - error_handling: comprehensive

    # TypeScript frontend - React + security
    web/src/**/*.{ts,tsx}:
      - react_hooks: enforce_rules
      - xss_prevention: strict
      - accessibility: wcag_aa

    # Database migrations - safety first
    migrations/**/*.sql:
      - reversible_migrations: enforce
      - breaking_changes: warn

  tools:
    rust:
      - clippy
      - rustfmt
    typescript:
      - eslint
      - biome

  auto_review:
    exclude_paths:
      - "**/test/**"
      - "**/*.test.*"
      - "**/node_modules/**"
      - "**/target/**"
```

### Rust Formatting: `rustfmt.toml`

```toml
edition = "2021"
max_width = 100
imports_granularity = "Crate"
group_imports = "StdExternalCrate"
```

### Rust Linting: `clippy.toml`

```toml
cognitive-complexity-threshold = 25
disallowed-methods = [
    { path = "std::option::Option::unwrap", reason = "use proper error handling" },
    { path = "std::result::Result::unwrap", reason = "use proper error handling" },
    { path = "std::option::Option::expect", reason = "use proper error handling" },
    { path = "std::result::Result::expect", reason = "use proper error handling" },
]
```

**Enforces:**
- No `unwrap()` or `expect()` in production code
- Complexity limits to maintain readability
- Use `?` for error handling

---

## Troubleshooting

### CodeRabbit CLI Issues

#### "coderabbit: command not found" or "Authentication required"

**Solution:** See the [Prerequisites & Setup](#prerequisites--setup) section above for detailed installation and authentication instructions.

**Quick checks:**
```bash
# Verify installation
which coderabbit
coderabbit --version

# Check authentication status
coderabbit auth status
```

#### "Review timed out"

**Cause:** Large changeset or slow network

**Solutions:**
- Review smaller changesets
- Use `--type uncommitted` instead of `--base main`
- Increase timeout in scripts (currently 30s)

### Git Hook Issues

#### "Pre-commit hook not running"

**Cause:** Hooks not installed or not executable

**Fix:**
```bash
bash scripts/install-git-hooks.sh
chmod +x .git/hooks/pre-commit
chmod +x .git/hooks/post-commit
```

**Verify:**
```bash
ls -la .git/hooks/
# Should show -rwxr-xr-x for pre-commit and post-commit
```

#### "Hook is blocking my commit"

**Temporary bypass:**
```bash
git commit --no-verify -m "Emergency fix"
```

**Permanent fix:**
- Review why CodeRabbit is blocking
- Fix the critical issues
- Commit normally

### CI/CD Issues

#### "CODERABBIT_API_KEY not set"

**Cause:** GitHub secret not configured

**Fix:** See [GitHub Secrets Setup](GITHUB_SECRETS.md)

#### "Workflow failing on CodeRabbit step"

**Check:**
1. GitHub Actions logs for error details
2. Verify API key is valid
3. Check CodeRabbit service status

**Temporary bypass:**
```yaml
# In .github/workflows/pr-checks.yml
- name: Run CodeRabbit Review
  continue-on-error: true  # Already set
```

### Memory Bank Issues

#### "Reviews not appearing in search"

**Cause:** Embeddings not indexed

**Fix:**
```bash
cd .embeddings
npm run reindex
```

**Verify:**
```bash
# Check .coderabbit/reviews/ exists and has .md files
ls -la .coderabbit/reviews/
```

#### "find_code_quality_issues returns nothing"

**Causes:**
1. No reviews stored yet (make some commits)
2. Query too specific (broaden search terms)
3. Embeddings out of sync (run reindex)

**Test query:**
```javascript
// Should return all reviews
find_code_quality_issues({ query: "issues" })
```

---

## Performance Tips

### Optimize Review Speed

**1. Review smaller changesets:**
```bash
# Instead of:
npm run cr:full  # Reviews entire codebase

# Use:
npm run cr:uncommitted  # Only working changes
npm run cr:committed    # Only last commit
```

**2. Use appropriate flags:**
```bash
# Fastest - only staged files
coderabbit --type staged

# Fast - last commit only
coderabbit --type committed

# Medium - working directory
coderabbit --type uncommitted

# Slowest - full diff against main
coderabbit --base main
```

**3. Exclude unnecessary files:**

Edit `.coderabbit.yaml`:
```yaml
auto_review:
  exclude_paths:
    - "**/test/**"
    - "**/target/**"
    - "**/node_modules/**"
    - "**/*.test.*"
    - "**/*.spec.*"
```

### Reduce False Positives

**1. Configure severity thresholds:**

```yaml
reviews:
  profile: balanced  # Less noise than "thorough"
```

**2. Suppress known non-issues:**

In code comments:
```rust
// coderabbit:ignore - This unwrap is safe because we validate above
let value = result.unwrap();
```

**3. Use context-specific rules:**

```yaml
path_filters:
  crates/tests/**/*.rs:
    - allow_unwrap: true  # Tests can use unwrap
```

---

## Best Practices

### When to Use Interactive Reviews

✅ **Use interactive (Claude runs CodeRabbit):**
- Implementing new features
- Refactoring existing code
- Before requesting PR review
- After receiving PR feedback

❌ **Skip interactive:**
- Trivial changes (typos, formatting)
- Emergency hotfixes (use --no-verify)
- Generated code (migrations, protobuf)

### When to Bypass Hooks

**Acceptable reasons:**
- Emergency production hotfix
- Reverting a bad commit
- Merge commits (hooks skip automatically)
- Generated/vendored code

**Bypass command:**
```bash
git commit --no-verify -m "message"
```

**⚠️ Warning:** Bypassed commits still reviewed by CI/CD.

### Code Review Workflow

**Recommended flow:**

1. **Develop** - Claude uses CodeRabbit during implementation
2. **Pre-commit hook** - Catches issues automatically
3. **Commit** - Post-commit stores review
4. **Push** - Create PR
5. **CI/CD** - GitHub Actions runs full review
6. **Human review** - Team reviews PR
7. **Merge** - Quality gate ensures standards

**Every commit gets 3 reviews:**
- Pre-commit (staged files)
- Post-commit (full commit)
- CI/CD (vs base branch)

---

## Team Workflow

### For Individual Contributors

**Daily workflow:**

```bash
# Morning: Start watcher
cd .embeddings && npm run dev

# Development: Claude auto-reviews
# [Code with Claude Code, it runs CodeRabbit as needed]

# Before commit: Manual review
npm run cr:uncommitted

# Commit: Hooks run automatically
git commit -m "Implement feature X"

# Push & PR: CI runs automatically
git push origin feature-x
gh pr create --fill
```

### For Reviewers

**PR review checklist:**

1. **Check CI status** - All checks must pass
2. **Review CodeRabbit findings** - Check GitHub step summary
3. **Address critical issues** - Block merge if found
4. **Human review** - CodeRabbit doesn't replace human judgment
5. **Approve & merge** - Quality gate ensures standards

**CodeRabbit helps reviewers by:**
- Catching common mistakes
- Identifying security issues
- Enforcing consistent style
- Reducing review burden

### For Team Leads

**Weekly quality review:**

1. **Check daily scan issues** - Review GitHub issues created by workflow
2. **Analyze trends** - Use memory bank to identify patterns
3. **Update standards** - Modify `.coderabbit.yaml` as needed
4. **Team training** - Share common issues in team meetings

**Monthly quality metrics:**

```bash
# Count reviews stored
ls -1 .coderabbit/reviews/*.md | wc -l

# Search for critical issues this month
find_code_quality_issues({
  query: "critical issues",
  severity: "critical"
})
```

---

## Advanced Usage

### Custom Review Profiles

Create custom profiles in `.coderabbit.yaml`:

```yaml
reviews:
  profiles:
    security-audit:
      security: strict
      unsafe_code: disallow
      error_handling: comprehensive

    quick-check:
      profile: chill
      auto_fix: true

    pre-release:
      profile: thorough
      require_tests: true
      require_docs: true
```

**Use profile:**
```bash
coderabbit --profile security-audit
```

### Integrating with External Tools

**Example: Auto-fix with rustfmt:**

```bash
# In pre-commit hook
cargo fmt --all
git add -u  # Re-stage formatted files
coderabbit --prompt-only --type staged
```

**Example: Integration with Jira:**

```bash
# In post-commit hook
ISSUE=$(git log -1 --format=%s | grep -oP 'PROJ-\d+')
if [ -n "$ISSUE" ]; then
  # Post CodeRabbit review to Jira comment
  coderabbit --output json > review.json
  # [Send to Jira API]
fi
```

---

## FAQ

### Q: How much does CodeRabbit slow down commits?

**A:** Pre-commit hook has 30-second timeout and runs in background. Average: 5-10 seconds for small changes. If timeout exceeded, commit proceeds anyway.

### Q: Can I disable CodeRabbit temporarily?

**A:** Yes:
```bash
# Disable pre-commit hook
rm .git/hooks/pre-commit

# Restore later
bash scripts/install-git-hooks.sh
```

### Q: Does CodeRabbit replace human code review?

**A:** No. CodeRabbit catches common issues, but human reviewers provide:
- Architectural feedback
- Business logic validation
- UX considerations
- Context-specific judgment

### Q: What happens if CodeRabbit API is down?

**A:** Graceful degradation:
- Pre-commit: Times out, allows commit
- Post-commit: Fails silently
- CI/CD: Marks as warning, doesn't block
- File watcher: Fails silently

### Q: How are reviews stored long-term?

**A:**
- Local: `.coderabbit/reviews/` (committed to git)
- GitHub: Workflow artifacts (30-day retention)
- Memory bank: Embeddings indexed indefinitely

### Q: Can I search reviews from 6 months ago?

**A:** Yes, if:
1. Review files are in `.coderabbit/reviews/`
2. Embeddings are up-to-date
3. Files not deleted/gitignored

---

## Additional Resources

- [CodeRabbit CLI Documentation](https://docs.coderabbit.ai/cli)
- [CodeRabbit Claude Code Integration](https://docs.coderabbit.ai/cli/claude-code-integration)
- [GitHub Secrets Setup](GITHUB_SECRETS.md)
- [Testing Guide](../TESTING_CODERABBIT.md)
- [PlexMCP Memory Bank](../.embeddings/README.md)
