# PlexMCP Embeddings

Semantic code search for PlexMCP using Ollama embeddings and FAISS vector similarity search.

## Features

- **Semantic Search**: Find code by meaning, not just keywords
- **Hybrid Search**: Combines vector embeddings with full-text search (SQLite FTS5)
- **MCP Integration**: 5 specialized tools for Claude Code
- **Smart Chunking**: Language-aware code parsing (Rust, TypeScript, Markdown, SQL)
- **TODO Tracking**: Automatic extraction and categorization of TODO/FIXME markers
- **Debug Log Search**: Find past debugging attempts and solutions
- **Request Flow Tracing**: Track features across frontend, backend, and database

## Quick Start

### 1. Install Dependencies

```bash
cd .embeddings
npm install
```

### 2. Start Ollama

```bash
# Install Ollama (if not installed)
brew install ollama

# Start Ollama server
ollama serve

# Pull embedding model
ollama pull nomic-embed-text
```

### 3. Build and Index

```bash
# Build TypeScript
npm run build

# Index the codebase (takes ~2 minutes)
npm run index
```

### 4. Try It Out

```bash
# Search the codebase
npm run search "stripe webhook subscription"

# View index statistics
npm run stats
```

## MCP Server Setup

See [MCP_SETUP.md](./MCP_SETUP.md) for detailed Claude Code integration instructions.

**Quick setup:**

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "plexmcp-embeddings": {
      "command": "node",
      "args": [
        "/Users/tylermailman/Documents/GitHub/PlexMCP/.embeddings/dist/mcp-server.js"
      ]
    }
  }
}
```

Restart Claude Code, and you'll have 5 new semantic search tools!

## Available Tools

### CLI Commands

```bash
# Index or re-index the codebase
npm run index

# Search with natural language
npm run search "how does billing work"

# Search with domain filter
node dist/cli.js search "auth" --domain rust-auth

# Show index statistics
npm run stats

# Phase 3: Automation
npm run watch                # Real-time file watching
npm run install-hooks        # Install git post-commit hook
npm run daily-update         # Update files changed in last 24h
```

### MCP Tools (for Claude Code)

1. **semantic_search** - Main search interface
2. **find_related_code** - Discover similar code
3. **explain_error** - Search debug logs
4. **find_todos** - List TODO/FIXME markers
5. **trace_request_flow** - Trace frontend-to-backend flows

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code                          │
│                  (via MCP Protocol)                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
           ┌─────────────────────┐
           │    MCP Server       │
           │  (mcp-server.ts)    │
           └──────────┬──────────┘
                      │
                      ▼
           ┌─────────────────────┐
           │   Query Engine      │
           │ (query-engine.ts)   │
           │                     │
           │ ┌─────────────────┐ │
           │ │ Hybrid Search:  │ │
           │ │  - Semantic     │ │
           │ │  - Keyword      │ │
           │ │  - RRF Ranking  │ │
           │ └─────────────────┘ │
           └──────┬──────────┬───┘
                  │          │
        ┌─────────▼────┐  ┌──▼──────────┐
        │ FAISS Store  │  │ SQLite DB   │
        │ (768-dim)    │  │ (FTS5)      │
        │              │  │             │
        │ 3,625 vectors│  │ 3,625 chunks│
        └──────────────┘  └─────────────┘
```

### Components

**Indexing Pipeline**:
1. **File Discovery** - Glob patterns by domain
2. **Chunking** - Language-specific parsing
3. **Embedding** - Ollama nomic-embed-text (768-dim)
4. **Storage** - FAISS index + SQLite metadata

**Query Pipeline**:
1. **Query Embedding** - Convert search to vector
2. **Parallel Search** - Semantic (FAISS) + Keyword (FTS5)
3. **RRF Fusion** - Merge and re-rank results
4. **Filtering** - Domain and file type filters
5. **Formatting** - Return top N with context

## Performance

| Metric | Value |
|--------|-------|
| **Indexing** | ~97 seconds (3,625 chunks) |
| **Index Size** | ~70MB (FAISS + metadata) |
| **First Query** | ~1-2 seconds (load index) |
| **Subsequent Queries** | ~50-100ms |
| **Accuracy** | High (hybrid search) |

## Project Structure

```
.embeddings/
├── src/
│   ├── chunkers/              # Language-specific chunking
│   │   ├── base-chunker.ts
│   │   ├── rust-chunker.ts
│   │   ├── typescript-chunker.ts
│   │   └── markdown-chunker.ts
│   ├── cli.ts                 # CLI interface
│   ├── indexer.ts             # Main indexing orchestrator
│   ├── query-engine.ts        # Hybrid search engine
│   ├── mcp-server.ts          # MCP server for Claude Code
│   ├── faiss-store.ts         # FAISS vector store wrapper
│   ├── metadata-store.ts      # SQLite metadata + FTS5
│   ├── ollama-embedding.ts    # Ollama client
│   └── index.ts               # Public exports
├── tests/                     # Test suites
│   ├── test-todos.js
│   ├── test-integrity.js
│   ├── test-errors.js
│   ├── test-query-engine.js
│   └── test-mcp-tools.js
├── data/                      # Generated data (git-ignored)
│   ├── embeddings.faiss       # FAISS index
│   ├── embeddings.vectors.json # Vector data
│   └── metadata.db            # SQLite database
├── dist/                      # Compiled JavaScript
├── package.json
├── tsconfig.json
├── README.md
├── MCP_SETUP.md              # Claude Code integration guide
└── PHASE1_REVIEW.md          # Phase 1 testing results
```

## Domains

The codebase is organized into domains for better search filtering:

- **rust-billing** - Stripe billing, subscriptions, webhooks
- **rust-auth** - Authentication, 2FA, OAuth
- **rust-mcp** - MCP proxy and routing
- **rust-admin** - Admin operations
- **rust-support** - Support features
- **rust-other** - Other Rust code
- **typescript-frontend** - React/Next.js frontend
- **database** - SQL migrations
- **docs** - Documentation (*.md)
- **debug-logs** - Debugging history (DEBUG_*.md)

## Testing

```bash
# Run all tests
npm run build
node tests/test-integrity.js      # Data integrity
node tests/test-errors.js         # Error handling
node tests/test-query-engine.js   # Query engine
node tests/test-mcp-tools.js      # MCP tools

# Quick health check
npm run stats
```

## Implementation Phases

- ✅ **Phase 1** - Setup & Initial Indexing
  - Ollama integration
  - FAISS + SQLite stores
  - Language-aware chunking
  - CLI interface
  - 3,625 chunks indexed

- ✅ **Phase 2** - Query Interface & MCP Integration
  - Hybrid search engine
  - RRF re-ranking
  - MCP server with 5 tools
  - Claude Code integration

- ✅ **Phase 3** - Automation
  - File watcher for real-time updates
  - Git hooks (post-commit)
  - Daily batch updates
  - Incremental reindexing

- 📅 **Phase 4** - Advanced Features (Future)
  - Code graph navigation
  - Query suggestions
  - Performance optimizations

## Configuration

Customize domain patterns in `src/cli.ts`:

```typescript
const DOMAINS = {
  'rust-billing': ['crates/api/src/routes/billing.rs', 'crates/billing/**/*.rs'],
  'rust-auth': ['crates/api/src/auth/**/*.rs', 'crates/api/src/routes/auth.rs'],
  // ...
};
```

Adjust chunking behavior in `src/chunkers/`.

## Dependencies

**Runtime**:
- `ollama` - Embedding model client
- `faiss-node` - Vector similarity search
- `better-sqlite3` - Metadata + FTS5
- `@modelcontextprotocol/sdk` - MCP server
- `commander` - CLI interface
- `chalk` - Terminal colors
- `glob` - File discovery

**Development**:
- `typescript` - Type safety
- `@types/node` - Node.js types

## Troubleshooting

### Index not found
```bash
cd .embeddings && npm run index
```

### Ollama connection failed
```bash
ollama serve
ollama pull nomic-embed-text
```

### Slow queries
- First query loads index into memory (~1-2 seconds)
- Subsequent queries are fast (<100ms)

### Out of date results
```bash
npm run index  # Re-index the codebase
```

## Contributing

When adding new features:
1. Follow existing patterns
2. Add tests to `tests/`
3. Update documentation
4. Keep code self-documenting
5. No "AI slop" - production-quality only

## License

MIT (same as PlexMCP Cloud project)

---

**Status**: ✅ All Phases Complete - Production Ready
- ✅ Phase 1: Indexing
- ✅ Phase 2: MCP Integration
- ✅ Phase 3: Automation

For questions or issues, see [MCP_SETUP.md](./MCP_SETUP.md) or check the test suites in `tests/`.

See also:
- [PHASE1_REVIEW.md](./PHASE1_REVIEW.md) - Phase 1 testing results
- [PHASE2_COMPLETE.md](./PHASE2_COMPLETE.md) - Phase 2 implementation summary
- [PHASE3_COMPLETE.md](./PHASE3_COMPLETE.md) - Phase 3 automation guide
