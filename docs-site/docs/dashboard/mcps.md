---
sidebar_position: 2
---

# Managing MCPs

The MCPs page lets you register, configure, and monitor your Model Context Protocol servers.

## MCP List View

The main MCPs page shows all registered servers:

| Column | Description |
|--------|-------------|
| **Name** | Display name you assigned |
| **Status** | Health status indicator |
| **Endpoint** | Server URL |
| **Requests** | Total requests processed |
| **Last Active** | Most recent activity |

### Status Indicators

- **Healthy** (green): MCP is responding normally
- **Unhealthy** (red): MCP is not responding
- **Unknown** (gray): Status check pending

## Adding an MCP

1. Click **Add MCP** button
2. Fill in the details:

   | Field | Required | Description |
   |-------|----------|-------------|
   | Name | Yes | Friendly display name |
   | Endpoint URL | Yes | Your MCP server URL |
   | Description | No | Notes for your team |
   | Auth Type | No | Authentication method |
   | Auth Token | No | Token/credentials if needed |

3. Click **Test Connection** to verify
4. Click **Create MCP** to save

## MCP Detail View

Click any MCP to see its details:

### Overview Tab
- Basic information
- Health status
- Quick stats (requests, errors, latency)

### Tools Tab
Lists all tools exposed by the MCP:
- Tool names and descriptions
- Input schema
- Quick test button

### Analytics Tab
Usage metrics for this MCP:
- Request volume over time
- Error rate
- Average latency
- Top tools by usage

### Settings Tab
Configure the MCP:
- Edit name and description
- Update endpoint URL
- Change authentication
- Enable/disable health checks

### Logs Tab
Recent activity and errors:
- Request timestamps
- Tool invocations
- Error messages
- Response times

## Testing an MCP

From the MCP detail page:

1. Go to **Tools** tab
2. Select a tool to test
3. Fill in any required arguments
4. Click **Run Test**
5. View the response

This is useful for:
- Verifying new MCPs work correctly
- Debugging issues
- Understanding tool behavior

## Editing an MCP

1. Click the MCP to open details
2. Go to **Settings** tab
3. Click **Edit**
4. Make your changes
5. Click **Save**

## Disabling an MCP

Temporarily stop routing requests:

1. Open MCP details
2. Go to **Settings** tab
3. Toggle **Active** to off
4. The MCP will return errors until re-enabled

This is useful for:
- Maintenance windows
- Investigating issues
- Temporarily blocking access

## Deleting an MCP

Permanently remove an MCP:

1. Open MCP details
2. Go to **Settings** tab
3. Scroll to **Danger Zone**
4. Click **Delete MCP**
5. Confirm by typing the MCP name

:::warning
Deleting an MCP is permanent. Any API keys with access will fail when calling this MCP.
:::

## Health Monitoring

PlexMCP automatically checks MCP health:

- **Check Interval**: Every 60 seconds
- **Timeout**: 30 seconds
- **Retries**: 3 attempts before marking unhealthy

### Health Check Behavior

When an MCP becomes unhealthy:
1. Status changes to red
2. Alert notification sent (if configured)
3. Requests continue (may fail)
4. Health checks continue

When an MCP recovers:
1. Status changes to green
2. Recovery notification sent
3. Normal operation resumes

## Bulk Operations

Select multiple MCPs for bulk actions:

1. Check the boxes next to MCPs
2. Use the bulk action dropdown:
   - **Enable All**: Activate selected
   - **Disable All**: Deactivate selected
   - **Delete All**: Remove selected (with confirmation)

## Import/Export

### Export MCPs
Download your MCP configuration:
1. Click **Export** button
2. Choose format (JSON or CSV)
3. Download the file

### Import MCPs
Upload MCP configurations:
1. Click **Import** button
2. Select your file
3. Review the import preview
4. Confirm to create MCPs

## Best Practices

1. **Use Descriptive Names**: Make it easy to identify MCPs
2. **Add Descriptions**: Document what each MCP does
3. **Monitor Health**: Check the dashboard regularly
4. **Set Up Alerts**: Enable notifications for outages
5. **Use HTTPS**: Always use secure endpoints
6. **Rotate Tokens**: Update authentication regularly
