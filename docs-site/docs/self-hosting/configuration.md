---
sidebar_position: 4
---

# Configuration Reference

Complete reference for all PlexMCP configuration options.

## Environment Variables

All configuration is done through environment variables. Create a `.env` file or set them in your deployment environment.

### Required Variables

These must be set for PlexMCP to start:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Secret for signing JWTs (32+ chars) | `openssl rand -hex 32` |
| `API_KEY_HMAC_SECRET` | Secret for API key generation (32+ chars) | `openssl rand -hex 32` |
| `TOTP_ENCRYPTION_KEY` | Key for 2FA encryption (64 hex chars) | `openssl rand -hex 32` |

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `BIND_ADDRESS` | Address to bind the server | `0.0.0.0:8080` |
| `PUBLIC_URL` | Public URL of the API | `http://localhost:8080` |
| `BASE_DOMAIN` | Base domain for multi-tenant routing | `localhost` |

### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Primary database connection | Required |
| `DATABASE_DIRECT_URL` | Direct connection (bypasses pooler) | None |
| `DATABASE_MAX_CONNECTIONS` | Max pool connections | `20` |

### Redis

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing secret | Required |
| `JWT_EXPIRY_HOURS` | Token expiration | `24` |
| `API_KEY_HMAC_SECRET` | API key signing secret | Required |
| `TOTP_ENCRYPTION_KEY` | 2FA encryption key | Required |

### Feature Flags

| Variable | Description | Default |
|----------|-------------|---------|
| `PLEXMCP_SELF_HOSTED` | Enable self-hosted mode | `false` |
| `ENABLE_SIGNUP` | Allow new user registration | `true` |
| `ENABLE_BILLING` | Enable Stripe billing | `true` |
| `ENABLE_EMAIL_ROUTING` | Enable email features | `false` |

### MCP Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_REQUEST_TIMEOUT_MS` | Request timeout | `30000` |
| `MCP_PARTIAL_TIMEOUT_MS` | Partial response timeout | `5000` |
| `MCP_MAX_CONNECTIONS_PER_ORG` | Max connections per org | `100` |
| `MCP_MAX_REQUEST_BODY_BYTES` | Max request body size | `10485760` (10MB) |

### Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `RUST_LOG` | Log level configuration | `info,plexmcp=debug` |

### Optional: Supabase (OAuth)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret |

### Optional: Email (Resend)

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend API key |
| `EMAIL_FROM` | Sender email address |
| `RESEND_WEBHOOK_SECRET` | Webhook signing secret |

### Optional: Stripe (Billing)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |
| `STRIPE_PRICE_*` | Price IDs for plans |

## Configuration Examples

### Minimal Self-Hosted

```bash
# .env
DATABASE_URL=postgresql://plexmcp:password@localhost:5432/plexmcp
REDIS_URL=redis://localhost:6379

JWT_SECRET=your-32-char-secret-here-abcdefghijklmnop
API_KEY_HMAC_SECRET=your-32-char-secret-here-abcdefghijklmnop
TOTP_ENCRYPTION_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456

PLEXMCP_SELF_HOSTED=true
ENABLE_BILLING=false
```

### With Email Support

```bash
# .env (add to minimal config)
RESEND_API_KEY=re_your_api_key
EMAIL_FROM=PlexMCP <noreply@yourdomain.com>
```

### With OAuth (Google/GitHub)

```bash
# .env (add to minimal config)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret
```

### Production Configuration

```bash
# .env
# Database (external)
DATABASE_URL=postgresql://plexmcp:secure_password@db.example.com:5432/plexmcp

# Redis (external)
REDIS_URL=redis://redis.example.com:6379

# Server
BIND_ADDRESS=0.0.0.0:8080
PUBLIC_URL=https://api.yourdomain.com
BASE_DOMAIN=yourdomain.com

# Secrets (rotate these periodically!)
JWT_SECRET=<generate with: openssl rand -hex 32>
JWT_EXPIRY_HOURS=24
API_KEY_HMAC_SECRET=<generate with: openssl rand -hex 32>
TOTP_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>

# Self-hosted mode
PLEXMCP_SELF_HOSTED=true
ENABLE_BILLING=false
ENABLE_SIGNUP=true
ENABLE_EMAIL_ROUTING=false

# MCP settings
MCP_REQUEST_TIMEOUT_MS=30000
MCP_MAX_CONNECTIONS_PER_ORG=100

# Logging (reduce verbosity in production)
RUST_LOG=info
```

## Secret Generation

Generate secure secrets:

```bash
# Generate all secrets at once
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "API_KEY_HMAC_SECRET=$(openssl rand -hex 32)"
echo "TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

Or use the setup script:

```bash
./scripts/setup.sh
```

## Validation

The API validates configuration on startup:

- `JWT_SECRET` must be at least 32 characters
- `API_KEY_HMAC_SECRET` must be at least 32 characters
- `TOTP_ENCRYPTION_KEY` must be exactly 64 hex characters
- Insecure default keys (all zeros, all ones) are rejected

## Next Steps

- [Docker Deployment →](./docker.md)
- [Manual Deployment →](./manual.md)
- [Upgrading →](./upgrading.md)
