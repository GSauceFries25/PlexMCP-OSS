# GitHub Secrets Configuration

This document explains how to configure the required GitHub secrets for PlexMCP's CI/CD pipelines.

## Required Secrets

### 1. CODERABBIT_API_KEY

**Used by:**
- `.github/workflows/pr-checks.yml` - CodeRabbit PR reviews
- `.github/workflows/daily-quality.yml` - Daily code quality scans

**Purpose:** Authenticates CodeRabbit CLI for automated code reviews

**How to obtain:**

1. **Sign up for CodeRabbit:**
   - Visit [https://coderabbit.ai](https://coderabbit.ai)
   - Create an account or log in

2. **Generate API Key:**
   - Navigate to Settings → API Keys
   - Click "Generate New API Key"
   - Copy the key (you won't be able to see it again)

3. **Add to GitHub:**
   - Go to your repository on GitHub
   - Navigate to **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Name: `CODERABBIT_API_KEY`
   - Value: Paste your API key
   - Click **Add secret**

**Validation:**

After adding the secret, trigger a workflow to test:

```bash
# Trigger PR checks workflow manually
gh workflow run pr-checks.yml

# Or push to a branch and create a PR
git checkout -b test-coderabbit
git commit --allow-empty -m "test: CodeRabbit integration"
git push origin test-coderabbit
gh pr create --fill
```

**Graceful Degradation:**

If this secret is not configured:
- Workflows will skip CodeRabbit steps with a warning
- Other checks (Rust tests, frontend lint, etc.) will still run
- No workflow will fail due to missing CodeRabbit key

---

### 2. FLY_API_TOKEN

**Used by:**
- `.github/workflows/deploy.yml` - Production deployment to Fly.io

**Purpose:** Authenticates Fly.io CLI for automated deployments

**How to obtain:**

1. **Install Fly.io CLI (if not already installed):**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Log in to Fly.io:**
   ```bash
   fly auth login
   ```

3. **Generate Deploy Token:**

**Output example:**

4. **Add to GitHub:**
   - Go to your repository on GitHub
   - Navigate to **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Name: `FLY_API_TOKEN`
   - Value: Paste the token from step 3
   - Click **Add secret**

**Validation:**

Test the deployment workflow:

```bash
# Trigger deploy workflow manually
gh workflow run deploy.yml

# Or push to main branch (auto-deploys)
git checkout main
git merge your-feature-branch
git push origin main
```

**Graceful Degradation:**

If this secret is not configured:
- Deploy workflow will skip deployment with a warning
- Quality checks will still run
- No deployment will occur

---

## Optional Secrets

### 3. GITHUB_TOKEN (Auto-provided)

**Used by:**
- All workflows (automatically provided by GitHub Actions)

**Purpose:** GitHub API authentication for creating issues, comments, etc.

**No action required** - GitHub automatically provides this to all workflows.

---

## Security Best Practices

### Token Rotation

**CodeRabbit:**
- Rotate API keys every 90 days
- Revoke old keys after updating

**Fly.io:**
- Create app-specific deploy tokens (not personal tokens)
- Use limited-scope tokens when possible

### Monitoring

**Check secret usage:**

```bash
# View workflow runs
gh run list --limit 10

# View specific run logs
gh run view <run-id> --log
```

**Audit trail:**
- GitHub logs all secret access in workflow runs
- Review audit logs: **Settings** → **Security** → **Audit log**

### Revocation

**If a secret is compromised:**

1. **Immediately revoke** the token at the source (CodeRabbit or Fly.io)
2. **Generate a new token** following the steps above
3. **Update GitHub secret** with the new value
4. **Review workflow logs** for unauthorized usage

---

## Environment-Specific Secrets

If you're using multiple environments (staging, production), consider using GitHub Environments:

**Setup:**

1. Go to **Settings** → **Environments**
2. Create environments: `staging`, `production`
3. Add environment-specific secrets

**Modify workflows to use environments:**

```yaml
jobs:
  deploy:
    environment:
      name: production  # or staging
    steps:
      - name: Deploy
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

---

## Troubleshooting

### Error: "CODERABBIT_API_KEY not set"

**Symptoms:** Workflow logs show:
```text
⚠️  CODERABBIT_API_KEY not set. Skipping scan.
```

**Solution:**
- Verify secret exists: **Settings** → **Secrets and variables** → **Actions**
- Check secret name matches exactly: `CODERABBIT_API_KEY`
- Re-run workflow after adding secret

### Error: "FLY_API_TOKEN not set"

**Symptoms:** Workflow logs show:
```text
⚠️  FLY_API_TOKEN not set. Skipping deployment.
```

**Solution:**
- Generate new Fly.io token: `fly tokens create deploy`
- Add to GitHub secrets as `FLY_API_TOKEN`
- Ensure token has deploy permissions

### Error: "Authentication failed"

**Symptoms:** CodeRabbit or Fly.io commands fail with auth errors

**Solutions:**

**CodeRabbit:**
```bash
# Test locally
coderabbit auth status

# Re-authenticate
coderabbit auth logout
coderabbit auth login
```

**Fly.io:**
```bash
# Test locally
fly auth whoami

# Re-authenticate
fly auth login
```

---

## Verification Checklist

After configuring all secrets, verify:

- [ ] `CODERABBIT_API_KEY` added to GitHub secrets
- [ ] `FLY_API_TOKEN` added to GitHub secrets
- [ ] PR workflow runs successfully
- [ ] Deploy workflow runs successfully
- [ ] Daily quality scan runs successfully
- [ ] No secret values appear in workflow logs
- [ ] Secrets documented in team knowledge base

---

## Additional Resources

- [GitHub Actions Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [CodeRabbit CLI Documentation](https://docs.coderabbit.ai/cli)
- [Fly.io Deploy Tokens](https://fly.io/docs/reference/deploy-tokens/)
- [Security Hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
