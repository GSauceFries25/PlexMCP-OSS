#!/usr/bin/env node

/**
 * PlexMCP Embeddings MCP Server
 *
 * Exposes semantic code search capabilities to Claude Code via MCP protocol.
 *
 * Available Tools:
 * - semantic_search: Main search interface for finding code
 * - find_related_code: Discover code related to a specific file
 * - explain_error: Search debug logs for error patterns
 * - find_todos: List all TODO/FIXME markers
 * - trace_request_flow: Trace frontend-to-backend request flows
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { QueryEngine } from './query-engine.js';
import { FaissStore } from './faiss-store.js';
import { MetadataStore } from './metadata-store.js';
import { OllamaEmbedding } from './ollama-embedding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DATA_PATH = path.join(__dirname, '../data');
const EMBEDDING_DIMENSION = 768;

class PlexMCPEmbeddingsServer {
  private server: Server;
  private queryEngine: QueryEngine | null = null;
  private metadataStore: MetadataStore;
  private faissStore: FaissStore;
  private embedding: OllamaEmbedding;

  constructor() {
    this.server = new Server(
      {
        name: 'plexmcp-embeddings',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize stores
    this.metadataStore = new MetadataStore(path.join(DATA_PATH, 'metadata.db'));
    this.faissStore = new FaissStore(EMBEDDING_DIMENSION, path.join(DATA_PATH, 'embeddings.faiss'));
    this.embedding = new OllamaEmbedding();

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Ensure query engine is initialized
      if (!this.queryEngine) {
        await this.initialize();
      }

      switch (name) {
        case 'semantic_search':
          return await this.handleSemanticSearch(args);
        case 'find_related_code':
          return await this.handleFindRelatedCode(args);
        case 'explain_error':
          return await this.handleExplainError(args);
        case 'find_todos':
          return await this.handleFindTodos(args);
        case 'trace_request_flow':
          return await this.handleTraceRequestFlow(args);
        case 'find_code_quality_issues':
          return await this.handleFindCodeQualityIssues(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private getToolDefinitions(): Tool[] {
    return [
      {
        name: 'semantic_search',
        description:
          'Search the PlexMCP codebase using semantic similarity. ' +
          'Finds code chunks conceptually related to your query, even if exact keywords differ. ' +
          'Best for: finding implementations, understanding patterns, locating related functionality.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language description of what to search for',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 5)',
              default: 5,
            },
            domain: {
              type: 'string',
              description:
                'Filter by domain: rust-billing, rust-auth, rust-mcp, rust-admin, rust-support, ' +
                'rust-other, typescript-frontend, database, docs, debug-logs',
            },
            file_type: {
              type: 'string',
              description: 'Filter by file type: rust, typescript, tsx, markdown, sql',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_related_code',
        description:
          'Find code related to a specific file. ' +
          'Analyzes the file content and finds similar implementations, usage patterns, or related functionality. ' +
          'Best for: understanding dependencies, finding similar patterns, discovering related features.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to find related code for',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 5)',
              default: 5,
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'explain_error',
        description:
          'Search debug logs for error patterns and explanations. ' +
          'Finds debugging attempts, root cause analyses, and solutions from DEBUG_*.md files. ' +
          'Best for: understanding past bugs, finding error solutions, learning from debugging history.',
        inputSchema: {
          type: 'object',
          properties: {
            error_description: {
              type: 'string',
              description: 'Description of the error or issue to search for',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 5)',
              default: 5,
            },
          },
          required: ['error_description'],
        },
      },
      {
        name: 'find_todos',
        description:
          'List all TODO/FIXME markers in the codebase. ' +
          'Returns unfinished work, planned improvements, and known issues with context. ' +
          'Best for: finding incomplete features, understanding technical debt, planning improvements.',
        inputSchema: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              description: 'Optional: filter TODOs by domain',
            },
          },
        },
      },
      {
        name: 'trace_request_flow',
        description:
          'Trace a request flow from frontend through backend to database. ' +
          'Finds related components across the stack for a given feature or operation. ' +
          'Best for: understanding full feature implementation, API flow analysis, debugging cross-layer issues.',
        inputSchema: {
          type: 'object',
          properties: {
            flow_description: {
              type: 'string',
              description: 'Description of the request flow to trace (e.g., "user login", "subscription upgrade")',
            },
            max_results: {
              type: 'number',
              description: 'Maximum total results to return (default: 10)',
              default: 10,
            },
          },
          required: ['flow_description'],
        },
      },
      {
        name: 'find_code_quality_issues',
        description:
          'Search CodeRabbit review history for code quality issues and patterns. ' +
          'Finds past reviews, security issues, bug patterns, and code improvements. ' +
          'Best for: learning from past mistakes, finding recurring issues, security audits.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language query (e.g., "authentication security issues", "SQL injection vulnerabilities")',
            },
            severity: {
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low'],
              description: 'Filter by issue severity',
            },
            file_pattern: {
              type: 'string',
              description: 'Filter by file path pattern (e.g., "billing.rs", "auth")',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
              default: 10,
            },
          },
          required: ['query'],
        },
      },
    ];
  }

  private async initialize(): Promise<void> {
    // Load FAISS index
    await this.faissStore.load();

    // Initialize query engine
    this.queryEngine = new QueryEngine(this.faissStore, this.metadataStore, this.embedding);
  }

  private async handleSemanticSearch(args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
    const query = args.query as string;
    const maxResults = (args.max_results as number) || 5;
    const domain = args.domain as string | undefined;
    const fileType = args.file_type as string | undefined;

    const results = await this.queryEngine!.search(query, {
      maxResults,
      domain,
      fileType,
    });

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No results found for query: "${query}"` }],
      };
    }

    const formattedResults = results.map((result, index) => {
      const { chunk, score, matchType } = result;
      const similarity = (score * 100).toFixed(1);

      let output = `### ${index + 1}. ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}\n`;
      output += `**Score:** ${similarity}% (${matchType})\n`;

      if (chunk.symbolName) {
        output += `**Symbol:** ${chunk.symbolType} \`${chunk.symbolName}\`\n`;
      }

      if (chunk.tags.length > 0) {
        output += `**Tags:** ${chunk.tags.join(', ')}\n`;
      }

      output += `\n\`\`\`${chunk.fileType}\n${chunk.chunkText}\n\`\`\`\n`;

      return output;
    });

    return {
      content: [
        {
          type: 'text',
          text: `# Search Results for: "${query}"\n\nFound ${results.length} matches:\n\n${formattedResults.join('\n---\n\n')}`,
        },
      ],
    };
  }

  private async handleFindRelatedCode(args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
    const filePath = args.file_path as string;
    const maxResults = (args.max_results as number) || 5;

    const results = await this.queryEngine!.findRelatedCode(filePath, maxResults);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No related code found for: ${filePath}` }],
      };
    }

    const formattedResults = results.map((result, index) => {
      const { chunk, score } = result;
      const similarity = (score * 100).toFixed(1);

      let output = `### ${index + 1}. ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}\n`;
      output += `**Similarity:** ${similarity}%\n`;

      if (chunk.symbolName) {
        output += `**Symbol:** ${chunk.symbolType} \`${chunk.symbolName}\`\n`;
      }

      output += `\n\`\`\`${chunk.fileType}\n${chunk.chunkText}\n\`\`\`\n`;

      return output;
    });

    return {
      content: [
        {
          type: 'text',
          text: `# Related Code for: ${filePath}\n\nFound ${results.length} related chunks:\n\n${formattedResults.join('\n---\n\n')}`,
        },
      ],
    };
  }

  private async handleExplainError(args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
    const errorDescription = args.error_description as string;
    const maxResults = (args.max_results as number) || 5;

    const results = await this.queryEngine!.searchDebugLogs(errorDescription, maxResults);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No debug logs found for error: "${errorDescription}"` }],
      };
    }

    const formattedResults = results.map((result, index) => {
      const { chunk, score } = result;
      const relevance = (score * 100).toFixed(1);

      let output = `### ${index + 1}. ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}\n`;
      output += `**Relevance:** ${relevance}%\n`;

      if (chunk.symbolName) {
        output += `**Section:** ${chunk.symbolName}\n`;
      }

      output += `\n${chunk.chunkText}\n`;

      return output;
    });

    return {
      content: [
        {
          type: 'text',
          text: `# Debug Logs for: "${errorDescription}"\n\nFound ${results.length} relevant entries:\n\n${formattedResults.join('\n---\n\n')}`,
        },
      ],
    };
  }

  private async handleFindTodos(args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
    const domain = args.domain as string | undefined;

    const todos = this.queryEngine!.getTodos(domain);

    if (todos.length === 0) {
      const domainMsg = domain ? ` in domain: ${domain}` : '';
      return {
        content: [{ type: 'text', text: `No TODOs found${domainMsg}` }],
      };
    }

    // Group by domain
    const byDomain: Record<string, typeof todos> = {};
    todos.forEach((todo) => {
      if (!byDomain[todo.domain]) {
        byDomain[todo.domain] = [];
      }
      byDomain[todo.domain].push(todo);
    });

    let output = `# TODO/FIXME Markers\n\n`;
    output += `**Total:** ${todos.length} items\n\n`;

    for (const [domainName, domainTodos] of Object.entries(byDomain)) {
      output += `## ${domainName} (${domainTodos.length})\n\n`;

      domainTodos.forEach((todo, index) => {
        output += `${index + 1}. **${todo.filePath}:${todo.startLine}**\n`;

        // Extract the TODO line
        const todoLine = todo.chunkText.split('\n').find((line) => /TODO|FIXME/i.test(line));
        if (todoLine) {
          output += `   ${todoLine.trim()}\n`;
        }

        output += '\n';
      });
    }

    return {
      content: [{ type: 'text', text: output }],
    };
  }

  private async handleTraceRequestFlow(args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
    const flowDescription = args.flow_description as string;
    const maxResults = (args.max_results as number) || 10;

    const { frontend, backend, database } = await this.queryEngine!.traceRequestFlow(flowDescription, maxResults);

    let output = `# Request Flow Trace: "${flowDescription}"\n\n`;

    if (frontend.length > 0) {
      output += `## Frontend (${frontend.length})\n\n`;
      frontend.forEach((result, index) => {
        const { chunk, score } = result;
        output += `${index + 1}. **${chunk.filePath}:${chunk.startLine}** (${(score * 100).toFixed(1)}%)\n`;
        if (chunk.symbolName) {
          output += `   ${chunk.symbolType}: \`${chunk.symbolName}\`\n`;
        }
        output += '\n';
      });
    }

    if (backend.length > 0) {
      output += `## Backend (${backend.length})\n\n`;
      backend.forEach((result, index) => {
        const { chunk, score } = result;
        output += `${index + 1}. **${chunk.filePath}:${chunk.startLine}** (${(score * 100).toFixed(1)}%)\n`;
        if (chunk.symbolName) {
          output += `   ${chunk.symbolType}: \`${chunk.symbolName}\`\n`;
        }
        output += '\n';
      });
    }

    if (database.length > 0) {
      output += `## Database (${database.length})\n\n`;
      database.forEach((result, index) => {
        const { chunk, score } = result;
        output += `${index + 1}. **${chunk.filePath}:${chunk.startLine}** (${(score * 100).toFixed(1)}%)\n`;
        output += '\n';
      });
    }

    if (frontend.length === 0 && backend.length === 0 && database.length === 0) {
      output += `\nNo results found for this request flow.\n`;
    }

    return {
      content: [{ type: 'text', text: output }],
    };
  }

  private async handleFindCodeQualityIssues(args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
    const query = args.query as string;
    const severity = args.severity as string | undefined;
    const filePattern = args.file_pattern as string | undefined;
    const maxResults = (args.max_results as number) || 10;

    // Build search query with filters
    let searchQuery = query;
    if (severity) {
      searchQuery += ` severity:${severity}`;
    }
    if (filePattern) {
      searchQuery += ` file:${filePattern}`;
    }

    // Search in coderabbit-reviews domain
    const results = await this.queryEngine!.search(searchQuery, {
      maxResults,
      domain: 'coderabbit-reviews',
    });

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No code quality issues found for query: "${query}"` }],
      };
    }

    let output = `# Code Quality Issues: "${query}"\n\n`;
    output += `Found ${results.length} review(s):\n\n`;

    results.forEach((result, index) => {
      const { chunk, score, matchType } = result;
      const similarity = (score * 100).toFixed(1);

      output += `## ${index + 1}. ${chunk.filePath}\n`;
      output += `**Relevance:** ${similarity}% (${matchType})\n\n`;

      // Display review content
      output += `\`\`\`\n${chunk.chunkText}\n\`\`\`\n\n`;

      output += '---\n\n';
    });

    return {
      content: [{ type: 'text', text: output }],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start server
const server = new PlexMCPEmbeddingsServer();
server.run().catch(console.error);
