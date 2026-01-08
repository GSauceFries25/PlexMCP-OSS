---
sidebar_position: 4
---

# Team Management

Collaborate with your team by inviting members and managing their permissions.

## Roles Overview

PlexMCP has four roles with different permission levels:

| Permission | Viewer | Member | Admin | Owner |
|------------|--------|--------|-------|-------|
| View Dashboard | ✓ | ✓ | ✓ | ✓ |
| View MCPs | ✓ | ✓ | ✓ | ✓ |
| Use MCPs via API | - | ✓ | ✓ | ✓ |
| Create API Keys | - | ✓ | ✓ | ✓ |
| Manage Own Keys | - | ✓ | ✓ | ✓ |
| Add/Edit MCPs | - | - | ✓ | ✓ |
| Delete MCPs | - | - | ✓ | ✓ |
| Invite Members | - | - | ✓ | ✓ |
| Change Roles | - | - | ✓ | ✓ |
| Remove Members | - | - | ✓ | ✓ |
| Manage Billing | - | - | - | ✓ |
| Delete Organization | - | - | - | ✓ |
| Transfer Ownership | - | - | - | ✓ |

### Role Descriptions

**Viewer**
- Read-only access to dashboard
- Cannot make changes or use API
- Good for stakeholders and observers

**Member**
- Can use MCPs via API
- Can create and manage their own API keys
- Cannot modify MCPs or team settings

**Admin**
- Full MCP management access
- Can invite and manage team members
- Cannot access billing or delete org

**Owner**
- Full access to everything
- Manages billing and subscription
- Can delete the organization
- Only one owner per organization

## Inviting Team Members

1. Navigate to **Team** in the sidebar
2. Click **Invite Member**
3. Enter their email address
4. Select their role
5. Click **Send Invite**

The invitee will receive an email with a link to join.

## Managing Invitations

### Pending Invites
View and manage outstanding invitations:
- See when invite was sent
- Resend the invitation
- Cancel the invitation

### Resending an Invite
1. Find the pending invite
2. Click **Resend**
3. A new email is sent

### Canceling an Invite
1. Find the pending invite
2. Click **Cancel**
3. The invite link becomes invalid

## Changing Roles

To update a member's role:

1. Find the member in the team list
2. Click their current role
3. Select the new role
4. Confirm the change

:::note
You cannot change your own role or the owner's role.
:::

## Removing Members

To remove someone from your organization:

1. Find the member in the team list
2. Click **Remove**
3. Confirm the removal

When a member is removed:
- They lose access immediately
- Their API keys are revoked
- Their activity history is preserved

## Transferring Ownership

Owners can transfer ownership to an admin:

1. Go to **Settings**
2. Find **Transfer Ownership**
3. Select the new owner
4. Enter your password to confirm
5. Click **Transfer**

After transfer:
- You become an Admin
- The new owner has full control

## Team Limits

Based on your plan:

| Plan | Team Members |
|------|--------------|
| Free | 1 |
| Pro | 5 |
| Team | Unlimited |

## Activity Log

View team activity in the dashboard:
- Who made what changes
- When actions occurred
- What was affected

This helps with:
- Auditing changes
- Troubleshooting issues
- Compliance requirements

## Best Practices

### Use Appropriate Roles
Don't give more access than needed:
- Developers → Member
- Team leads → Admin
- Finance/billing → Viewer with billing access

### Review Access Regularly
Periodically audit team access:
- Remove inactive members
- Downgrade roles when appropriate
- Update roles for role changes

### Document Your Team Structure
Keep track of who has what access:
- Maintain a team directory
- Note the purpose of each role
- Plan for succession

## Troubleshooting

### Invite Not Received
- Check spam/junk folders
- Verify the email address
- Resend the invitation
- Ask them to check their email filters

### Cannot Change Role
- Verify you have Admin or Owner role
- You cannot change your own role
- You cannot change the Owner's role

### Member Cannot Access MCPs
- Verify their role allows MCP access (Member or higher)
- Check if specific API key permissions are set
- Ensure the MCPs they need are active
