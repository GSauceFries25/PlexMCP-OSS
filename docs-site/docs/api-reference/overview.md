---
sidebar_position: 1
---

# API Overview

The PlexMCP API lets you programmatically interact with your MCPs, manage resources, and integrate PlexMCP into your applications.

## Base URL

All API requests use the following base URL:

```
https://api.plexmcp.com/v1
```

## Authentication

All API requests require authentication via API key:

```bash
curl -X GET https://api.plexmcp.com/v1/mcps \
  -H "Authorization: Bearer YOUR_API_KEY"
```

See [Authentication](/api-reference/authentication) for details.

## Request Format

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer YOUR_API_KEY` |
| `Content-Type` | Yes* | `application/json` for POST/PUT |
| `Accept` | No | `application/json` (default) |

### Body

For POST and PUT requests, send JSON:

```bash
curl -X POST https://api.plexmcp.com/v1/mcp/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mcp_id": "mcp_123",
    "tool": "get_weather",
    "arguments": {
      "location": "San Francisco"
    }
  }'
```

## Response Format

All responses are JSON with consistent structure:

### Success Response

```json
{
  "success": true,
  "data": {
    // Response data here
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "invalid_request",
    "message": "The request was invalid",
    "details": {
      // Additional error context
    }
  }
}
```

## HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Server Error |

## Pagination

List endpoints support pagination:

```bash
GET /v1/mcps?page=1&per_page=20
```

Response includes pagination metadata:

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 45,
    "total_pages": 3
  }
}
```

## Rate Limits

Rate limits vary by plan:

| Plan | Requests/second |
|------|-----------------|
| Free | 10 |
| Pro | 100 |
| Team | 1,000 |

Rate limit headers:
- `X-RateLimit-Limit`: Max requests per window
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when limit resets

## API Endpoints

### MCP Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/mcps` | List all MCPs |
| GET | `/v1/mcps/{id}` | Get MCP details |
| POST | `/v1/mcp/invoke` | Invoke an MCP tool |
| POST | `/v1/mcp/resources` | Read MCP resources |

### Organization

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/organization` | Get current org |
| GET | `/v1/organization/members` | List members |

### API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/api-keys` | List API keys |
| POST | `/v1/api-keys` | Create API key |
| DELETE | `/v1/api-keys/{id}` | Revoke API key |

### Usage

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/usage` | Get usage stats |
| GET | `/v1/usage/history` | Usage history |

## SDKs

Official SDKs are coming soon:

- **TypeScript/JavaScript**: `@plexmcp/sdk` (npm)
- **Python**: `plexmcp` (PyPI)
- **Go**: `plexmcp-go` (GitHub)

For now, use the REST API directly with cURL or your HTTP client of choice:

```bash
# List MCPs
curl -X GET https://api.plexmcp.com/v1/mcps \
  -H "Authorization: Bearer YOUR_API_KEY"

# Invoke a tool
curl -X POST https://api.plexmcp.com/v1/mcp/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mcp_id": "mcp_123",
    "tool": "get_weather",
    "arguments": {"location": "San Francisco"}
  }'
```

## Versioning

The API uses URL versioning (`/v1/`). We maintain backward compatibility within a version.

Breaking changes:
- Announced 6 months in advance
- Old versions supported for 12 months after deprecation
- Migration guides provided

## Support

- **API Status**: [status.plexmcp.com](https://status.plexmcp.com)
- **Documentation Issues**: [GitHub](https://github.com/PlexMCP/plexmcp/issues)
- **Support Email**: support@plexmcp.com
