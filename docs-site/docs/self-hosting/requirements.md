---
sidebar_position: 2
---

# System Requirements

This page outlines the hardware and software requirements for self-hosting PlexMCP.

## Hardware Requirements

### Minimum (Development/Testing)

| Resource | Requirement |
|----------|-------------|
| CPU | 2 cores |
| RAM | 4 GB |
| Storage | 20 GB |
| Network | 100 Mbps |

### Recommended (Production)

| Resource | Requirement |
|----------|-------------|
| CPU | 4+ cores |
| RAM | 8+ GB |
| Storage | 100+ GB SSD |
| Network | 1 Gbps |

### Scaling Guidelines

| Users | CPU | RAM | Storage |
|-------|-----|-----|---------|
| 1-10 | 2 cores | 4 GB | 20 GB |
| 10-50 | 4 cores | 8 GB | 50 GB |
| 50-200 | 8 cores | 16 GB | 100 GB |
| 200+ | 16+ cores | 32+ GB | 200+ GB |

## Software Requirements

### Operating System

PlexMCP runs on any Linux distribution. Tested on:

- Ubuntu 22.04 LTS (recommended)
- Debian 12
- Amazon Linux 2023
- Rocky Linux 9
- macOS 13+ (for development)

### Docker (Recommended)

- Docker Engine 24.0+
- Docker Compose 2.20+

Or:
- Podman 4.0+
- Podman Compose 1.0+

### Manual Deployment

If not using Docker:

- PostgreSQL 15+ (16 recommended)
- Redis 7+
- Rust 1.75+ (for building from source)
- Node.js 20+ (for frontend)

## Network Requirements

### Ports

| Port | Service | Required |
|------|---------|----------|
| 3000 | Web Frontend | Yes |
| 8080 | API Server | Yes |
| 5432 | PostgreSQL | Internal only |
| 6379 | Redis | Internal only |

### Firewall Rules

**Inbound:**
- 80/443 (if using reverse proxy)
- 3000 (web frontend, if exposing directly)
- 8080 (API, if exposing directly)

**Outbound:**
- 443 (for MCP server connections)
- 5432 (if using external PostgreSQL)
- 6379 (if using external Redis)

### TLS/SSL

For production deployments:
- TLS 1.2+ required
- Valid SSL certificate recommended
- Use a reverse proxy (nginx, Caddy, Traefik)

## Database Requirements

### PostgreSQL

- Version 15 or higher (16 recommended)
- Extensions required: `uuid-ossp`, `pgcrypto`
- Connection pooling recommended for 50+ users

**Sizing Guidelines:**

| Users | Connections | Storage |
|-------|-------------|---------|
| 1-10 | 20 | 1 GB |
| 10-50 | 50 | 5 GB |
| 50-200 | 100 | 20 GB |
| 200+ | 200+ | 50+ GB |

### Redis

- Version 7 or higher
- Persistence enabled (AOF recommended)
- 512MB+ memory

## Optional Requirements

### Email (Transactional)

To enable email features (password reset, notifications):
- SMTP server or
- Resend API key or
- SendGrid API key

### OAuth (Social Login)

To enable Google/GitHub login:
- Supabase project or
- Custom OAuth implementation

### GeoIP (Location Data)

To enable IP geolocation:
- MaxMind GeoLite2 database

## Cloud Provider Compatibility

PlexMCP can be deployed on any cloud provider:

| Provider | Tested | Notes |
|----------|--------|-------|
| AWS | ✅ | EC2, ECS, EKS |
| Google Cloud | ✅ | GCE, Cloud Run, GKE |
| Azure | ✅ | VMs, Container Apps, AKS |
| DigitalOcean | ✅ | Droplets, App Platform |
| Hetzner | ✅ | Dedicated servers, Cloud |
| Fly.io | ✅ | Our cloud runs here |
| Railway | ✅ | One-click deploy |
| Render | ✅ | One-click deploy |

## Verifying Requirements

Run this script to check your system:

```bash
#!/bin/bash
echo "Checking PlexMCP requirements..."

# Check Docker
if command -v docker &> /dev/null; then
    echo "✅ Docker: $(docker --version)"
else
    echo "❌ Docker not found"
fi

# Check Docker Compose
if command -v docker compose &> /dev/null; then
    echo "✅ Docker Compose: $(docker compose version)"
else
    echo "❌ Docker Compose not found"
fi

# Check memory
mem=$(free -g | awk '/^Mem:/{print $2}')
if [ "$mem" -ge 4 ]; then
    echo "✅ Memory: ${mem}GB"
else
    echo "⚠️ Memory: ${mem}GB (4GB+ recommended)"
fi

# Check disk
disk=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
if [ "$disk" -ge 20 ]; then
    echo "✅ Disk space: ${disk}GB available"
else
    echo "⚠️ Disk space: ${disk}GB (20GB+ recommended)"
fi

echo "Done!"
```

## Next Steps

- [Docker Deployment →](./docker.md)
- [Manual Deployment →](./manual.md)
- [Configuration Reference →](./configuration.md)
