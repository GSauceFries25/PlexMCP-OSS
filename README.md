# PlexMCP

**Source-available Model Context Protocol (MCP) gateway with enterprise authentication, multi-tenant isolation, and SOC 2 compliance.**

[![License: FSL-1.1-Apache-2.0](https://img.shields.io/badge/License-FSL--1.1--Apache--2.0-blue.svg)](LICENSE)
[![Docker Build](https://github.com/PlexMCP/plexmcp/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/PlexMCP/plexmcp/actions/workflows/docker-publish.yml)
[![SOC 2](https://img.shields.io/badge/SOC%202-Ready-success.svg)](docs/compliance/)
[![Self-Hosted](https://img.shields.io/badge/self--hosted-ready-green.svg)](SELF_HOSTING.md)

---

## Open-Core Model

PlexMCP is released under a source-available license ([FSL-1.1-Apache-2.0](LICENSE)).

You are free to:
- Self-host PlexMCP on your own infrastructure
- Modify the source code
- Use it internally or commercially

PlexMCP Cloud is a managed service built on top of this core with additional proprietary features and operational tooling. The license converts to Apache 2.0 after two years.

**Quick Start (Self-Hosted):**

```bash
# Clone and setup
git clone https://github.com/PlexMCP/plexmcp.git
cd plexmcp
./scripts/setup.sh

# Start with pre-built images (recommended)
docker compose --profile prebuilt up -d

# Open in browser
open http://localhost:3000
```

See the [Self-Hosting Guide](docs-site/docs/self-hosting/) for detailed instructions.

---

## Overview

PlexMCP is a complete, production-ready infrastructure for hosting Model Context Protocol (MCP) servers at scale. It provides enterprise-grade authentication, multi-tenant isolation, usage tracking, and SOC 2 Type II compliance out of the box.

Built with Rust for performance and reliability, PlexMCP handles the complex infrastructure so you can focus on building MCP tools and prompts.

### What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io) is Anthropic's open standard for connecting AI assistants to external data sources and tools. PlexMCP provides the server infrastructure to host MCP servers securely and at scale.

---

## Deployment Options

| Option | Best For | Features |
|--------|----------|----------|
| **[Self-Hosted](docs-site/docs/self-hosting/)** | Full control, data privacy, compliance | All core features, no usage limits |
| **[PlexMCP Cloud](https://plexmcp.com)** | Quick start, managed infrastructure | SLA, support, auto-scaling, SSL |

### Self-Hosted Features (Free)

- MCP server management and proxy/gateway
- API key management with scoped permissions
- Organization and team management
- Two-factor authentication (2FA/TOTP)
- Usage analytics and rate limiting
- Row-Level Security on all tables
- Full database migrations

### Cloud-Only Features

- Managed infrastructure with SLA
- Stripe billing integration
- Custom domain SSL auto-provisioning
- Multi-region deployment
- Priority support

---

## Key Features

### Enterprise Authentication
- JWT-based authentication with refresh tokens
- TOTP 2FA support (Google Authenticator, Authy)
- API key management with scoped permissions
- Row-Level Security (RLS) on all 77 database tables
- Session tracking and revocation

### Multi-Tenant Architecture
- Complete data isolation between organizations
- Per-tenant resource limits and quotas
- Team management with role-based access control (RBAC)
- Organization-level audit logs

### MCP Protocol Support
- Full MCP 1.0 protocol implementation
- SSE (Server-Sent Events) and HTTP transport
- Tool execution with timeout controls
- Prompt management and versioning
- Resource discovery and access control
- Connection pooling and session management

### Observability & Compliance
- SOC 2 Type II ready (100% compliance)
- Comprehensive audit logging (immutable)
- Security event alerting (Slack integration)
- Usage analytics and reporting
- Performance monitoring

### Production-Ready
- Zero technical debt (0 unwrap(), 0 TODO comments)
- 101 passing tests with 80%+ coverage on critical paths
- Kubernetes-ready with health checks
- Horizontal scaling support
- Database migration system (SQLx)

---

## Quick Start

### Prerequisites

- **Docker** 24.0+ and Docker Compose 2.20+ ([Install](https://docs.docker.com/get-docker/))
- 4GB+ RAM, 20GB+ disk space

### Installation

```bash
# Clone the repository
git clone https://github.com/PlexMCP/plexmcp.git
cd plexmcp

# Run setup script (generates secrets, creates .env)
./scripts/setup.sh

# Option 1: Use pre-built images (recommended, fastest)
docker compose --profile prebuilt up -d

# Option 2: Build from source
docker compose --profile build up -d

# Verify everything is running
./scripts/health-check.sh

# Open in browser
open http://localhost:3000
```

### Manual Installation (Without Docker)

See [Manual Deployment Guide](docs-site/docs/self-hosting/manual.md) for instructions on deploying without Docker.

### Development Mode

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install development dependencies
cargo install cargo-watch sqlx-cli

# Run with auto-reload
cargo watch -x run

# Run tests
cargo test --workspace

# Run with debug logging
RUST_LOG=debug cargo run
```

---

## Architecture

```
plexmcp/
├── crates/
│   ├── api/           # API server (Axum web framework)
│   │   ├── auth/      # Authentication & middleware
│   │   ├── routes/    # HTTP endpoints
│   │   └── mcp/       # MCP protocol handlers
│   │
│   ├── billing/       # Billing (optional, disable for self-host)
│   ├── shared/        # Shared types and utilities
│   └── worker/        # Background jobs
│
├── web/               # Next.js frontend
├── migrations/        # Database migrations (SQLx)
├── docs-site/         # Documentation site
└── scripts/           # Setup and utility scripts
```

### Technology Stack

- **Backend:** [Rust](https://www.rust-lang.org/) with [Axum](https://github.com/tokio-rs/axum)
- **Frontend:** [Next.js](https://nextjs.org/) 15 with TypeScript
- **Database:** PostgreSQL 15+ with [SQLx](https://github.com/launchbadge/sqlx)
- **Cache:** Redis 7+
- **Authentication:** JWT, TOTP 2FA, API keys

---

## Configuration

PlexMCP uses environment variables for configuration. The setup script generates a `.env` file with secure defaults.

### Required Variables

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/plexmcp
REDIS_URL=redis://localhost:6379
JWT_SECRET=<generate with: openssl rand -hex 32>
API_KEY_HMAC_SECRET=<generate with: openssl rand -hex 32>
TOTP_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
```

### Self-Hosted Mode

```bash
PLEXMCP_SELF_HOSTED=true
ENABLE_BILLING=false
ENABLE_SIGNUP=true
```

See [Configuration Reference](docs-site/docs/self-hosting/configuration.md) for all options.

---

## API Documentation

### Authentication

```bash
# Register a new user
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "org_name": "My Organization"
  }'

# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

### MCP Connection

```bash
# Connect to MCP server via SSE
curl -X POST http://localhost:8080/api/mcp/sse \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instance_id": "YOUR_INSTANCE_ID"}'
```

---

## Testing

```bash
# Run all tests
cargo test --workspace

# Run with output
cargo test --workspace -- --nocapture

# Run with coverage
cargo install cargo-tarpaulin
cargo tarpaulin --workspace --out Html
```

**Test Coverage:** 101 tests, 80%+ coverage on critical paths

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Run tests and linters (`cargo test && cargo clippy`)
5. Commit your changes
6. Open a Pull Request

---

## Security

PlexMCP follows security best practices:

- **SOC 2 Type II** compliance ready
- **Row-Level Security (RLS)** on all database tables
- **Encryption at rest** and in transit
- **OWASP Top 10** protections

### Reporting Security Issues

Please follow our [Security Policy](SECURITY.md). **Do not open a public issue.**

Email: **security@plexmcp.com**

---

## License

PlexMCP is licensed under the [Functional Source License (FSL-1.1-Apache-2.0)](LICENSE).

### What This Means

| Use Case | License Required? |
|----------|-------------------|
| Personal use | No |
| Business < $1M revenue | No |
| Self-hosting | No |
| Business > $1M revenue | [Commercial license](COMMERCIAL_LICENSE.md) |
| Competing hosted service | [Commercial license](COMMERCIAL_LICENSE.md) |

### License Conversion

The FSL automatically converts to **Apache 2.0** two years after each release. This means:
- Code released January 2025 becomes Apache 2.0 in January 2027
- Each new version has its own two-year conversion timeline
- Once converted, the code remains Apache 2.0 forever

### Why Source-Available?

PlexMCP uses the Functional Source License (FSL) rather than a traditional open source license (like MIT or Apache 2.0). This is a "source-available" license, which means:

- **You can:** View, modify, and self-host the code for any purpose
- **You can:** Use PlexMCP in your business without paying licensing fees
- **You cannot:** Offer PlexMCP as a competing hosted service
- **After 2 years:** The code converts to Apache 2.0 with no restrictions

This approach allows us to sustainably develop PlexMCP while keeping the code transparent and self-hostable.

See [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) for commercial licensing details.

---

## Support

### Bug Reports

Found a bug? Please [open an issue](https://github.com/PlexMCP/plexmcp/issues) with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Docker version, etc.)

### Security Issues

**Do not open a public issue for security vulnerabilities.**

Please email **security@plexmcp.com** with details. See our [Security Policy](SECURITY.md) for more information.

### What We Support

- Bug reports and feature requests via GitHub Issues
- Documentation improvements via pull requests
- Community discussions via GitHub Discussions

### What We Do Not Support

- Free debugging of self-hosted deployments
- Custom installation or configuration assistance
- Priority response times for community users

### Commercial Support

For enterprise support, SLA guarantees, or commercial licensing:
- **Email:** support@plexmcp.com
- **Website:** [https://plexmcp.com](https://plexmcp.com)

### Documentation

- **Self-Hosting:** [docs-site/docs/self-hosting/](docs-site/docs/self-hosting/)
- **Configuration:** [docs-site/docs/self-hosting/configuration.md](docs-site/docs/self-hosting/configuration.md)
- **API Reference:** [docs/api/](docs/api/)

---

## Acknowledgments

PlexMCP is built on:

- **Anthropic** for the [Model Context Protocol](https://modelcontextprotocol.io)
- **Rust Community** for exceptional libraries and tools
- **Supabase** for database and architecture inspiration
- All our [contributors](https://github.com/PlexMCP/plexmcp/graphs/contributors)

---

## Status

**Version:** 1.0.0
**Status:** Production Ready
**SOC 2 Compliance:** 100% Ready
**License:** FSL-1.1-Apache-2.0 (converts to Apache 2.0 after 2 years)

---

Made with ❤️ by the PlexMCP team and contributors
