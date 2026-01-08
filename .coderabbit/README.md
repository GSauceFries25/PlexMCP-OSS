# CodeRabbit Review Storage

This directory stores all CodeRabbit code review results for searchable historical analysis via the PlexMCP memory bank.

## Directory Structure

```
.coderabbit/
├── README.md                          # This file
└── reviews/                           # Review storage
    ├── 2025-12-29-143022-abc1234.json # Raw CodeRabbit output
    ├── 2025-12-29-143022-abc1234.md   # Human-readable summary
    ├── 2025-12-29-151530-def5678.json
    └── 2025-12-29-151530-def5678.md
```

## File Naming Convention

All review files follow this pattern:

```
{YYYY-MM-DD}-{HHMMSS}-{commit-hash}.{extension}
```

**Example:** `2025-12-29-143022-abc1234.json`

- **Date:** 2025-12-29 (December 29, 2025)
- **Time:** 14:30:22 (2:30:22 PM UTC)
- **Commit:** abc1234 (short commit hash)
- **Extension:** .json or .md

## File Formats

### JSON Files (`.json`)

Raw CodeRabbit API response containing structured review data.

**Schema:**
```json
{
  "commit_hash": "abc1234",
  "timestamp": "2025-12-29T14:30:22Z",
  "files_count": 8,
  "issues": [
    {
      "id": "issue-001",
      "severity": "high",
      "category": "security",
      "title": "SQL Injection Vulnerability",
      "description": "User input not sanitized in database query",
      "file": "crates/api/src/auth.rs",
      "line": 45,
      "column": 12,
      "suggestion": "Use parameterized queries with sqlx::query!",
      "code_snippet": "...",
      "impact": "Critical - allows arbitrary SQL execution"
    }
  ],
  "summary": {
    "critical": 2,
    "high": 5,
    "medium": 12,
    "low": 8
  }
}
```

### Markdown Files (`.md`)

Human-readable summary generated from JSON for embedding indexing.

**Format:**
```markdown
# CodeRabbit Review - abc1234

**Date:** 2025-12-29T14:30:22Z
**Files Reviewed:** 8
**Issues Found:** 27

## Summary

- Critical: 2
- High: 5
- Medium: 12
- Low: 8

## Issues

### 1. SQL Injection Vulnerability (critical)

**File:** `crates/api/src/auth.rs:45`
**Category:** security

**Description:** User input not sanitized in database query

**Suggested Fix:**
Use parameterized queries with sqlx::query!
```

## How Reviews Are Created

Reviews are automatically stored after each commit via the **post-commit hook**:

```bash
# .git/hooks/post-commit
COMMIT_HASH=$(git rev-parse --short HEAD)
TIMESTAMP=$(date +"%Y-%m-%d-%H%M%S")

# Generate review
coderabbit --prompt-only --type committed --output json \
  > .coderabbit/reviews/$TIMESTAMP-$COMMIT_HASH.json

# Generate markdown summary
node scripts/generate-review-summary.js \
  .coderabbit/reviews/$TIMESTAMP-$COMMIT_HASH.json \
  > .coderabbit/reviews/$TIMESTAMP-$COMMIT_HASH.md
```

**Trigger:** Every `git commit` (bypassed with `--no-verify`)

## Memory Bank Integration

### Automatic Indexing

The PlexMCP embeddings watcher automatically indexes markdown review files:

1. **File Watcher** detects new `.md` files in `.coderabbit/reviews/`
2. **Chunker** splits review into semantic sections
3. **Embeddings** generated using Ollama (nomic-embed-text)
4. **FAISS Store** indexes vectors for similarity search
5. **SQLite FTS5** indexes text for keyword search

**Domain:** `coderabbit-reviews`

### Searchable via MCP Tool

Claude Code can search review history using the `find_code_quality_issues()` MCP tool:

```typescript
// Example tool call
find_code_quality_issues({
  query: "authentication security issues",
  severity: "high",
  file_pattern: "auth.rs",
  max_results: 10
})
```

**Returns:**
- Relevant past code reviews
- Issue descriptions and solutions
- File locations and line numbers
- Temporal patterns (recurring issues)

## Use Cases

### 1. Learning from Past Mistakes

**Query:** "What SQL injection vulnerabilities have we had?"

**Result:** All past reviews mentioning SQL injection, showing:
- Where they occurred
- How they were fixed
- Prevention strategies

### 2. Tracking Recurring Issues

**Query:** "Show me all unwrap() issues in the last month"

**Result:** Pattern analysis of `.unwrap()` usage over time, helping identify:
- Files with repeated issues
- Developers needing training
- Areas needing refactoring

### 3. Security Audit Trail

**Query:** "Critical security issues in authentication code"

**Result:** Complete history of security findings in auth-related files:
- What was found
- When it was fixed
- Who committed the fix

### 4. Onboarding New Developers

**Query:** "Common code quality issues in this codebase"

**Result:** Aggregated patterns showing:
- Project-specific coding standards
- Common pitfalls to avoid
- Best practices examples

### 5. Release Quality Checks

**Query:** "Issues found since last release tag"

**Result:** All quality issues introduced in current release cycle:
- Severity distribution
- File impact analysis
- Regression detection

## Maintenance

### Storage Size

**Growth rate:** ~10-50 KB per commit (varies by changeset size)

**Estimated annual storage:** ~10-50 MB (assuming 1,000 commits/year)

**Recommendation:** Retain indefinitely (low cost, high value)

### Cleanup (if needed)

**Archive old reviews:**
```bash
# Archive reviews older than 1 year
find .coderabbit/reviews -name "*.json" -mtime +365 -exec gzip {} \;
find .coderabbit/reviews -name "*.md" -mtime +365 -exec gzip {} \;
```

**Delete very old reviews:**
```bash
# Delete reviews older than 2 years (CAUTION)
find .coderabbit/reviews -name "*.json" -mtime +730 -delete
find .coderabbit/reviews -name "*.md" -mtime +730 -delete

# Re-index embeddings after deletion
cd .embeddings && npm run reindex
```

### Corruption Recovery

**If JSON is corrupted:**

1. Review still exists in git history:
```bash
git log --all --full-history -- .coderabbit/reviews/
git show <commit-hash>:.coderabbit/reviews/<filename>
```

2. Re-generate from commit:
```bash
git checkout <commit-hash>
coderabbit --type committed --output json > recovered.json
```

## Git Integration

### Should Reviews Be Committed?

**Yes** - Reviews should be committed to git because:

1. **Version History** - Links reviews to specific commits
2. **Team Sharing** - All team members access same review history
3. **CI/CD Integration** - GitHub Actions can analyze trends
4. **Backup** - Reviews preserved in git history
5. **Auditability** - Complete quality trail

### .gitignore Considerations

**Do NOT ignore** `.coderabbit/reviews/` - these should be committed.

**Current .gitignore:**
```gitignore
# Do NOT ignore CodeRabbit reviews
# !.coderabbit/

# Temporary review files (if any)
.coderabbit/*.tmp
.coderabbit/*.lock
```

### Large Repository Concerns

If review storage becomes too large (unlikely):

**Option 1:** Git LFS for JSON files
```bash
git lfs track ".coderabbit/reviews/*.json"
```

**Option 2:** Separate review repository
```bash
# Create separate repo
git init coderabbit-reviews
git remote add reviews https://github.com/org/plexmcp-reviews

# Store reviews there instead
```

## Troubleshooting

### No reviews being created

**Check:**
```bash
# 1. Post-commit hook exists and is executable
ls -la .git/hooks/post-commit
chmod +x .git/hooks/post-commit

# 2. Scripts exist and are executable
ls -la scripts/store-coderabbit-review.sh
chmod +x scripts/store-coderabbit-review.sh

# 3. CodeRabbit authenticated
coderabbit auth status
```

**Manual trigger:**
```bash
bash scripts/store-coderabbit-review.sh
```

### Reviews not searchable

**Check:**
```bash
# 1. Markdown files exist
ls .coderabbit/reviews/*.md

# 2. Watcher is indexing them
cd .embeddings && npm run stats
# Should show coderabbit-reviews domain

# 3. Re-index if needed
npm run reindex
```

### Reviews are empty

**Cause:** CodeRabbit execution failed (network, auth, timeout)

**Fix:**
```bash
# Check last commit review manually
coderabbit --type committed --output json

# If works, re-generate review
bash scripts/store-coderabbit-review.sh
```

## Best Practices

### 1. Commit Reviews Immediately

Reviews are most valuable when committed alongside the code they review.

**Workflow:**
```bash
git add .
git commit -m "Implement feature X"
# Post-commit hook runs automatically, stores review

git add .coderabbit/reviews/
git commit -m "Add CodeRabbit review for feature X"
git push
```

**Alternative:** Include review in same commit (requires custom hook)

### 2. Review Before Major Releases

Before releases, search for unresolved issues:

```javascript
// Via Claude Code
find_code_quality_issues({
  query: "critical high severity issues",
  severity: "critical"
})
```

### 3. Periodic Quality Audits

Monthly review of patterns:

```bash
# Generate summary report
cd .coderabbit/reviews
grep -h "^### " *.md | sort | uniq -c | sort -rn
```

### 4. Link Reviews to PRs

In PR descriptions, reference review files:

```markdown
## Code Quality

CodeRabbit review: `.coderabbit/reviews/2025-12-29-143022-abc1234.md`

**Issues found:** 5 (3 high, 2 medium)
**All resolved:** ✅
```

## Advanced Usage

### Custom Review Queries

**Complex query combining filters:**
```javascript
find_code_quality_issues({
  query: "database query performance optimization",
  severity: "high",
  file_pattern: "crates/api/src/db",
  max_results: 20
})
```

### Trend Analysis

**Track issue count over time:**
```bash
# Count issues per month
for month in {01..12}; do
  count=$(ls .coderabbit/reviews/2025-$month-*.md 2>/dev/null | wc -l)
  echo "2025-$month: $count reviews"
done
```

### Export for External Analysis

**Convert to CSV for spreadsheet analysis:**
```bash
# Extract all issues to CSV
node scripts/export-reviews-to-csv.js > reviews.csv
```

**Example script:** `scripts/export-reviews-to-csv.js`
```javascript
// Parse all JSON files and output CSV
const fs = require('fs');
const files = fs.readdirSync('.coderabbit/reviews').filter(f => f.endsWith('.json'));

console.log('date,file,line,severity,category,title');
files.forEach(file => {
  const review = JSON.parse(fs.readFileSync(`.coderabbit/reviews/${file}`));
  review.issues?.forEach(issue => {
    console.log(`${review.timestamp},${issue.file},${issue.line},${issue.severity},${issue.category},"${issue.title}"`);
  });
});
```

---

**Last Updated:** 2025-12-29
**Maintained By:** PlexMCP Development Team
