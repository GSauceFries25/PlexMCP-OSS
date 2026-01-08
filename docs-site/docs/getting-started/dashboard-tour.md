---
sidebar_position: 2
---

# Dashboard Tour

A complete walkthrough of the PlexMCP dashboard and all its features.

## Overview Page

When you log in, you'll see your organization's overview dashboard with:

- **Usage Summary**: Requests made this billing period
- **Quick Stats**: Active MCPs, team members, and API keys
- **Recent Activity**: Latest API calls and events
- **Usage Chart**: Request volume over time

## Navigation

The left sidebar contains all main sections:

| Section | Description |
|---------|-------------|
| **Dashboard** | Overview and quick stats |
| **MCPs** | Manage your MCP servers |
| **API Keys** | Create and manage API keys |
| **Team** | Invite and manage team members |
| **Billing** | Subscription and usage |
| **Settings** | Organization settings |

## MCPs Page

View and manage all your connected MCP servers:

- **Add MCP**: Register a new MCP server
- **Status Indicators**: See which MCPs are healthy
- **Quick Actions**: Test, edit, or delete MCPs
- **Search & Filter**: Find MCPs quickly

For each MCP, you can view:
- Connection status (healthy, unhealthy, unknown)
- Total requests processed
- Last activity timestamp
- Available tools

## API Keys Page

Manage your API keys for secure access:

- **Create Key**: Generate new API keys with specific permissions
- **View Keys**: See all active keys (secrets are hidden)
- **Revoke Keys**: Immediately disable compromised keys
- **Key Analytics**: See usage per key

Key details include:
- Creation date
- Last used timestamp
- Expiration date
- Associated permissions

## Team Page

Collaborate with your team:

- **Invite Members**: Add team members by email
- **Role Management**: Assign roles (Owner, Admin, Member, Viewer)
- **Pending Invites**: See and resend pending invitations
- **Remove Members**: Remove access when needed

### Role Permissions

| Permission | Viewer | Member | Admin | Owner |
|------------|--------|--------|-------|-------|
| View MCPs | ✓ | ✓ | ✓ | ✓ |
| Use MCPs | - | ✓ | ✓ | ✓ |
| Manage MCPs | - | - | ✓ | ✓ |
| Manage API Keys | - | ✓ | ✓ | ✓ |
| Manage Team | - | - | ✓ | ✓ |
| Billing | - | - | - | ✓ |
| Delete Org | - | - | - | ✓ |

## Billing Page

Monitor and manage your subscription:

- **Current Plan**: See your active subscription tier
- **Usage Metrics**: Requests used this period
- **Upgrade/Downgrade**: Change your plan
- **Billing History**: View past invoices
- **Payment Method**: Update your payment details

## Settings Page

Configure your organization:

- **Organization Details**: Name, slug, description
- **PIN Protection**: Enable/disable sensitive action protection
- **Danger Zone**: Delete organization (requires confirmation)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `G` then `D` | Go to Dashboard |
| `G` then `M` | Go to MCPs |
| `G` then `K` | Go to API Keys |
| `G` then `T` | Go to Team |
| `G` then `B` | Go to Billing |
| `G` then `S` | Go to Settings |
| `/` | Focus search |
| `?` | Show help |

## Mobile Experience

The dashboard is fully responsive. On mobile devices:
- Navigation moves to a hamburger menu
- Tables become scrollable cards
- Touch-friendly controls throughout

## Next Steps

Now that you know your way around:
- [Add your first MCP](/getting-started/first-mcp)
- [Create an API key](/dashboard/api-keys)
- [Invite team members](/dashboard/team)
