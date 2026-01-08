---
sidebar_position: 3
---

# Organizations API

Endpoints for managing organizations and membership.

## Get Current Organization

Retrieve details about your organization.

```http
GET /v1/organization
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "org_123",
    "name": "My Company",
    "slug": "my-company",
    "description": "Building cool stuff with AI",
    "plan": "pro",
    "created_at": "2024-01-15T10:30:00Z",
    "settings": {
      "pin_protection": true
    },
    "limits": {
      "mcps": 10,
      "api_keys": 10,
      "team_members": 5,
      "monthly_requests": 50000
    },
    "usage": {
      "mcps": 3,
      "api_keys": 2,
      "team_members": 2,
      "monthly_requests": 12500
    }
  }
}
```

## Get Organization Members

List all members in your organization.

```http
GET /v1/organization/members
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Page number (default: 1) |
| `per_page` | integer | Items per page (default: 20, max: 100) |
| `role` | string | Filter by role |

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "user_123",
      "email": "alice@example.com",
      "name": "Alice Smith",
      "role": "owner",
      "joined_at": "2024-01-15T10:30:00Z",
      "last_active": "2024-01-20T15:45:00Z"
    },
    {
      "id": "user_456",
      "email": "bob@example.com",
      "name": "Bob Jones",
      "role": "admin",
      "joined_at": "2024-01-18T09:00:00Z",
      "last_active": "2024-01-20T14:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 2,
    "total_pages": 1
  }
}
```

## Get Organization Usage

Get detailed usage statistics.

```http
GET /v1/organization/usage
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | string | `day`, `week`, `month` (default) |
| `start_date` | string | Start date (ISO 8601) |
| `end_date` | string | End date (ISO 8601) |

### Response

```json
{
  "success": true,
  "data": {
    "period": "month",
    "start_date": "2024-01-01T00:00:00Z",
    "end_date": "2024-01-31T23:59:59Z",
    "requests": {
      "total": 12500,
      "limit": 50000,
      "percentage": 25
    },
    "by_mcp": [
      {
        "mcp_id": "mcp_123",
        "name": "Weather API",
        "requests": 8000
      },
      {
        "mcp_id": "mcp_456",
        "name": "Calculator",
        "requests": 4500
      }
    ],
    "by_day": [
      {
        "date": "2024-01-15",
        "requests": 450
      },
      {
        "date": "2024-01-16",
        "requests": 520
      }
    ]
  }
}
```

## Update Organization

Update organization details (Owner/Admin only).

```http
PATCH /v1/organization
```

### Request Body

```json
{
  "name": "New Company Name",
  "description": "Updated description"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "org_123",
    "name": "New Company Name",
    "slug": "my-company",
    "description": "Updated description",
    "updated_at": "2024-01-20T16:00:00Z"
  }
}
```

## Invite Member

Invite a new member to your organization (Admin/Owner only).

```http
POST /v1/organization/members/invite
```

### Request Body

```json
{
  "email": "newuser@example.com",
  "role": "member"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "invite_id": "inv_789",
    "email": "newuser@example.com",
    "role": "member",
    "expires_at": "2024-01-27T16:00:00Z",
    "invite_url": "https://dashboard.plexmcp.com/invite/inv_789"
  }
}
```

## Update Member Role

Change a member's role (Admin/Owner only).

```http
PATCH /v1/organization/members/{user_id}
```

### Request Body

```json
{
  "role": "admin"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "user_456",
    "email": "bob@example.com",
    "role": "admin",
    "updated_at": "2024-01-20T16:00:00Z"
  }
}
```

## Remove Member

Remove a member from the organization (Admin/Owner only).

```http
DELETE /v1/organization/members/{user_id}
```

### Response

```json
{
  "success": true,
  "data": {
    "removed": true,
    "user_id": "user_456"
  }
}
```

## Errors

### 403 Forbidden

```json
{
  "success": false,
  "error": {
    "code": "forbidden",
    "message": "You don't have permission to perform this action"
  }
}
```

### 404 Not Found

```json
{
  "success": false,
  "error": {
    "code": "not_found",
    "message": "Member not found"
  }
}
```

### 422 Validation Error

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Invalid role specified",
    "details": {
      "role": "Must be one of: viewer, member, admin"
    }
  }
}
```
