---
sidebar_position: 3
---

# Adding Your First MCP

Learn how to connect an MCP server to PlexMCP and start routing requests through the gateway.

## What is an MCP?

Model Context Protocol (MCP) servers expose tools and resources that AI agents can use. PlexMCP acts as a gateway, letting you:

- Access multiple MCPs through a single API key
- Monitor usage and performance
- Apply rate limiting and access controls
- Share MCPs across your team

## Supported MCP Types

PlexMCP supports any MCP server that implements the standard protocol:

- **HTTP MCPs**: Servers accessible via HTTP/HTTPS
- **SSE MCPs**: Servers using Server-Sent Events for streaming
- **WebSocket MCPs**: Real-time bidirectional communication

## Adding an MCP

### Step 1: Navigate to MCPs

1. Log into [dashboard.plexmcp.com](https://dashboard.plexmcp.com)
2. Click **MCPs** in the sidebar
3. Click **Add MCP** button

### Step 2: Configure the MCP

Fill in the required fields:

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | Friendly display name | "Weather Service" |
| **Endpoint URL** | Your MCP server URL | `https://mcp.example.com` |
| **Description** | Optional description | "Weather data and forecasts" |

### Step 3: Test the Connection

Before saving, click **Test Connection** to verify:
- The endpoint is reachable
- The server responds with valid MCP protocol
- SSL certificates are valid (for HTTPS)

### Step 4: Save and Activate

Click **Create MCP** to add it to your organization. The MCP will immediately be available for use.

## MCP Configuration Options

### Basic Settings

```json
{
  "name": "My MCP",
  "endpoint_url": "https://mcp.example.com",
  "description": "Description for your team"
}
```

### Authentication (Optional)

If your MCP requires authentication:

```json
{
  "auth_type": "bearer",
  "auth_token": "your-mcp-auth-token"
}
```

Supported auth types:
- `none` - No authentication
- `bearer` - Bearer token in Authorization header
- `api_key` - API key in custom header
- `basic` - HTTP Basic authentication

### Health Checks

PlexMCP automatically monitors your MCPs:
- Periodic health checks every 60 seconds
- Automatic status updates (healthy/unhealthy)
- Alerts for prolonged outages (Pro+ plans)

## Testing Your MCP

After adding an MCP, test it from the dashboard:

1. Go to the MCP details page
2. Click **Test** tab
3. Select a tool to invoke
4. Provide test arguments
5. Click **Run Test**

You'll see the full request/response for debugging.

## Managing MCPs

### Edit an MCP

1. Navigate to **MCPs**
2. Click the MCP you want to edit
3. Click **Edit** button
4. Update fields and save

### Disable an MCP

Temporarily disable without deleting:

1. Click the MCP
2. Toggle **Active** to off
3. The MCP won't accept requests until re-enabled

### Delete an MCP

Permanently remove an MCP:

1. Click the MCP
2. Click **Delete** in the danger zone
3. Confirm deletion (this is irreversible)

:::warning
Deleting an MCP will break any API keys or integrations using it.
:::

## Best Practices

### 1. Use Descriptive Names
Choose names that help your team understand what each MCP does.

### 2. Add Descriptions
Document what tools are available and when to use them.

### 3. Set Up Monitoring
Enable health check alerts to catch issues early (Pro+ plans).

### 4. Use HTTPS
Always use HTTPS endpoints for production MCPs.

### 5. Rotate Auth Tokens
If your MCP uses authentication, rotate tokens regularly.

## Troubleshooting

### Connection Test Fails

- Verify the endpoint URL is correct
- Check if your MCP server is running
- Ensure the server is accessible from the internet
- Check for firewall rules blocking the connection

### MCP Shows "Unhealthy"

- Check your MCP server logs
- Verify the endpoint is still accessible
- Ensure the server responds within 30 seconds

### Tools Not Appearing

- Some MCPs require authentication to list tools
- The MCP might not implement tool listing
- Try invoking a known tool directly

## Next Steps

Now that your MCP is connected:
- [Create an API key](/dashboard/api-keys) to access it
- [Connect Claude Desktop](/guides/integrations/claude-desktop)
- [Learn about invoking tools](/guides/mcps/invoking-tools)
