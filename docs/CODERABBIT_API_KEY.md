# CodeRabbit API Key Reference

**Project:** PlexMCP
**Generated:** 2025-12-30
**Purpose:** AI-powered code reviews and quality analysis

## API Key

```text
cr-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Note:** The actual API key is stored securely in:
- Local: `.env` file (gitignored)
- CI/CD: GitHub repository secrets
- CLI: `~/.config/coderabbit/config.json`

## Storage Locations

This API key is stored in the following locations:

### 1. Local Environment (.env)

**File:** `.env` (in project root)
**Variable:** `CODERABBIT_API_KEY`
**Purpose:** Local development, CLI authentication

```bash
# Code Quality - CodeRabbit
CODERABBIT_API_KEY=cr-your-api-key-here
```

### 2. GitHub Repository Secret

**Repository:** PlexMCP/plexmcp
**Secret Name:** `CODERABBIT_API_KEY`
**Set:** 2025-12-30T18:13:19Z
**Purpose:** CI/CD workflows (PR checks, daily scans)

**Access:** GitHub → Settings → Secrets and variables → Actions

### 3. CodeRabbit CLI Config

**File:** `~/.config/coderabbit/config.json`
**Purpose:** Local CLI authentication for manual reviews

```json
{
  "auth": {
    "accessToken": "cr-your-api-key-here",
    "provider": "github"
  }
}
```

## Usage

### Local Development

The API key is automatically loaded from `.env` and available via:

```bash
# Manual CodeRabbit review
cd .embeddings
npm run cr:uncommitted    # Review working changes
npm run cr:committed      # Review last commit
npm run cr:full           # Full codebase review

# Direct CLI usage
coderabbit --prompt-only --type uncommitted
```

### GitHub Actions

The key is automatically injected into workflows via the `CODERABBIT_API_KEY` secret:

```yaml
- name: Authenticate CodeRabbit
  env:
    CODERABBIT_API_KEY: ${{ secrets.CODERABBIT_API_KEY }}
  run: |
    echo "$CODERABBIT_API_KEY" | coderabbit auth login --token-stdin
```

**Workflows using this key:**
- `.github/workflows/pr-checks.yml` - PR quality gate
- `.github/workflows/daily-quality.yml` - Daily code scans

## Verification

### Check Local CLI Authentication

```bash
coderabbit auth status
```

Expected output:
```text
✅ Authentication: Logged in
👤 Name: Your Name
📧 Email: your.email@example.com
🔧 Username: your-username
```

### Check GitHub Secret

```bash
gh secret list | grep CODERABBIT
```

Expected output:
```text
CODERABBIT_API_KEY  2025-12-30T18:13:19Z
```

### Test Review Functionality

```bash
# Quick test
echo "// Test" >> test.rs
git add test.rs
coderabbit --prompt-only --type staged
```

## Security Notes

- ⚠️ **Never commit this key to git** (already in `.gitignore`)
- ⚠️ **Never share publicly** - revoke and regenerate if exposed
- ✅ Stored in `.env` which is gitignored
- ✅ GitHub secrets are encrypted at rest
- ✅ CLI config in `~/.config/` with restricted permissions

## Rotation

If this key needs to be rotated:

1. **Generate new key** at [CodeRabbit Settings](https://app.coderabbit.ai/settings)
2. **Update `.env`:**
   ```bash
   # Update CODERABBIT_API_KEY value
   ```
3. **Update GitHub secret:**
   ```bash
   echo "new-key-here" | gh secret set CODERABBIT_API_KEY
   ```
4. **Update CLI config:**
   ```bash
   coderabbit auth logout
   coderabbit auth login
   ```

## Related Documentation

- [GitHub Secrets Setup](GITHUB_SECRETS.md) - Complete secrets configuration guide
- [Code Quality Guide](CODE_QUALITY.md) - CodeRabbit workflow documentation
- [Testing Guide](../TESTING_CODERABBIT.md) - Integration testing procedures

---

**Status:** ✅ Active and verified
**Last Updated:** 2025-12-30
**Next Review:** Before each major deployment
