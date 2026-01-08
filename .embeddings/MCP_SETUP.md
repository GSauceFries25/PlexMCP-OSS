# MCP Server Setup for Claude Code

This guide shows you how to integrate the PlexMCP Embeddings MCP server with Claude Code.

## Configuration

Add the following to your Claude Code MCP configuration file:

**Location:** `~/.config/claude/claude_desktop_config.json` (or equivalent for your platform)

```json
{
  "mcpServers": {
    "plexmcp-embeddings": {
      "command": "node",
      "args": [
        "/Users/tylermailman/Documents/GitHub/PlexMCP/.embeddings/dist/mcp-server.js"
      ],
      "description": "Semantic code search for PlexMCP project"
    }
  }
}
```

**Note:** Adjust the path if your PlexMCP project is located elsewhere.

## Available Tools

Once configured, Claude Code will have access to these tools:

### 1. `semantic_search`
Search the codebase using natural language queries.

**Example:**
```
Use semantic_search to find where Stripe webhooks are handled
```

**Parameters:**
- `query` (required): Natural language description
- `max_results` (optional): Number of results (default: 5)
- `domain` (optional): Filter by domain (rust-billing, typescript-frontend, etc.)
- `file_type` (optional): Filter by file type (rust, typescript, tsx, etc.)

---

### 2. `find_related_code`
Find code similar to a specific file.

**Example:**
```
Use find_related_code to find code similar to crates/api/src/routes/billing.rs
```

**Parameters:**
- `file_path` (required): Path to the reference file
- `max_results` (optional): Number of results (default: 5)

---

### 3. `explain_error`
Search debug logs for error patterns and solutions.

**Example:**
```
Use explain_error to find information about "OAuth callback not working"
```

**Parameters:**
- `error_description` (required): Description of the error
- `max_results` (optional): Number of results (default: 5)

---

### 4. `find_todos`
List all TODO/FIXME markers in the codebase.

**Example:**
```
Use find_todos to list all pending tasks in the rust-billing domain
```

**Parameters:**
- `domain` (optional): Filter by domain

---

### 5. `trace_request_flow`
Trace a feature across frontend, backend, and database.

**Example:**
```
Use trace_request_flow to understand how "user login" works
```

**Parameters:**
- `flow_description` (required): Feature or operation to trace
- `max_results` (optional): Total results (default: 10)

---

## Usage Examples

### Finding Implementation Details
```
I need to understand how subscription upgrades work.
Can you use semantic_search to find the relevant code?
```

Claude Code will call:
```json
{
  "tool": "semantic_search",
  "arguments": {
    "query": "subscription upgrade downgrade tier change",
    "domain": "rust-billing",
    "max_results": 5
  }
}
```

### Debugging Issues
```
Users are reporting OAuth login issues.
Can you search the debug logs for similar problems?
```

Claude Code will call:
```json
{
  "tool": "explain_error",
  "arguments": {
    "error_description": "OAuth login callback redirect failure",
    "max_results": 5
  }
}
```

### Understanding Features
```
How does the billing webhook flow work from frontend to backend?
```

Claude Code will call:
```json
{
  "tool": "trace_request_flow",
  "arguments": {
    "flow_description": "billing webhook payment processing",
    "max_results": 10
  }
}
```

---

## Verifying Installation

After adding the configuration:

1. **Restart Claude Code**
2. **Check available tools:**
   - You should see 5 new tools from plexmcp-embeddings
   - Tools should appear when you ask questions about the codebase

3. **Test with a simple query:**
   ```
   Use semantic_search to find code related to "stripe payment"
   ```

If the tool isn't available, check:
- Path to mcp-server.js is correct
- Node.js is installed and in PATH
- Embeddings index exists (run `npm run index` if not)
- Ollama is running (`ollama serve`)

---

## Troubleshooting

### "Tool not found" error
- Verify the path in the config file is absolute and correct
- Ensure `npm run build` has been run in `.embeddings/`
- Check that `dist/mcp-server.js` exists

### "Index file not found" error
- Run `cd .embeddings && npm run index` to create the index
- Wait for indexing to complete (~2 minutes for PlexMCP)

### "Ollama connection failed" error
- Start Ollama server: `ollama serve`
- Verify nomic-embed-text model is installed: `ollama pull nomic-embed-text`

### Slow responses
- First query is slower (loading index into memory)
- Subsequent queries should be fast (<100ms)
- Check Ollama is not rate-limiting requests

---

## Performance Notes

- **First query:** ~1-2 seconds (loads FAISS index into memory)
- **Subsequent queries:** ~50-100ms (index cached)
- **Memory usage:** ~80MB (index + metadata)
- **Disk usage:** ~70MB (stored index files)

---

## Updating the Index

When code changes significantly:

```bash
cd /Users/tylermailman/Documents/GitHub/PlexMCP/.embeddings
npm run index
```

This will rebuild the embeddings (takes ~2 minutes).

**Auto-updating (Phase 3):** File watcher for automatic incremental updates
