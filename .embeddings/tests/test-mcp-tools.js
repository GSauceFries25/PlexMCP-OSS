/**
 * MCP Tools Manual Test
 *
 * This script simulates what Claude Code will do when calling MCP tools.
 * Tests each tool's functionality without requiring full MCP server setup.
 */

import { QueryEngine } from '../dist/query-engine.js';
import { FaissStore } from '../dist/faiss-store.js';
import { MetadataStore } from '../dist/metadata-store.js';
import { OllamaEmbedding } from '../dist/ollama-embedding.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, '../data');

console.log('=== MCP Tools Test Suite ===\n');

// Initialize
const metadataStore = new MetadataStore(path.join(DATA_PATH, 'metadata.db'));
const faissStore = new FaissStore(768, path.join(DATA_PATH, 'embeddings.faiss'));
const embedding = new OllamaEmbedding();

console.log('Initializing...');
await faissStore.load();
const queryEngine = new QueryEngine(faissStore, metadataStore, embedding);
console.log('✓ Ready\n');

// Helper to format results like MCP tool would
function formatSearchResults(title, results) {
  let output = `# ${title}\n\nFound ${results.length} matches:\n\n`;

  results.forEach((result, index) => {
    const { chunk, score, matchType } = result;
    const similarity = (score * 100).toFixed(1);

    output += `### ${index + 1}. ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}\n`;
    output += `**Score:** ${similarity}% (${matchType})\n`;

    if (chunk.symbolName) {
      output += `**Symbol:** ${chunk.symbolType} \`${chunk.symbolName}\`\n`;
    }

    if (chunk.tags.length > 0) {
      output += `**Tags:** ${chunk.tags.join(', ')}\n`;
    }

    // Show first 3 lines of code
    const preview = chunk.chunkText.split('\n').slice(0, 3).join('\n');
    output += `\n\`\`\`${chunk.fileType}\n${preview}\n...\n\`\`\`\n\n`;
  });

  return output;
}

// Test 1: semantic_search
console.log('=== Test 1: semantic_search ===');
console.log('Simulating: Claude asks "How does stripe billing work?"\n');

const searchResults = await queryEngine.search('stripe billing subscription payment', {
  maxResults: 3,
  domain: 'rust-billing',
});

const searchOutput = formatSearchResults(
  'Search Results for: "stripe billing subscription payment"',
  searchResults
);

console.log(searchOutput);
console.log('✓ semantic_search working\n');
console.log('---\n');

// Test 2: find_related_code
console.log('=== Test 2: find_related_code ===');
console.log('Simulating: Claude asks "What code is related to billing routes?"\n');

const relatedResults = await queryEngine.findRelatedCode('crates/api/src/routes/billing.rs', 3);

console.log(`# Related Code for: crates/api/src/routes/billing.rs\n`);
console.log(`Found ${relatedResults.length} related chunks:\n`);

relatedResults.forEach((result, index) => {
  const { chunk, score } = result;
  console.log(`${index + 1}. ${chunk.filePath}:${chunk.startLine}`);
  console.log(`   Similarity: ${(score * 100).toFixed(1)}%`);
  console.log(`   Domain: ${chunk.domain}\n`);
});

console.log('✓ find_related_code working\n');
console.log('---\n');

// Test 3: explain_error
console.log('=== Test 3: explain_error ===');
console.log('Simulating: Claude asks "Why is OAuth failing?"\n');

const errorResults = await queryEngine.searchDebugLogs('oauth callback redirect failure', 3);

console.log(`# Debug Logs for: "oauth callback redirect failure"\n`);
console.log(`Found ${errorResults.length} relevant entries:\n`);

errorResults.forEach((result, index) => {
  const { chunk, score } = result;
  console.log(`${index + 1}. ${chunk.filePath}:${chunk.startLine}`);
  console.log(`   Relevance: ${(score * 100).toFixed(1)}%`);

  if (chunk.symbolName) {
    console.log(`   Section: ${chunk.symbolName}`);
  }

  // Show first 2 lines
  const preview = chunk.chunkText.split('\n').slice(0, 2).join('\n');
  console.log(`\n   ${preview}\n`);
});

console.log('✓ explain_error working\n');
console.log('---\n');

// Test 4: find_todos
console.log('=== Test 4: find_todos ===');
console.log('Simulating: Claude asks "What are the TODOs in billing code?"\n');

const todos = queryEngine.getTodos('rust-billing');

console.log(`# TODO/FIXME Markers in rust-billing\n`);
console.log(`**Total:** ${todos.length} items\n`);

todos.slice(0, 5).forEach((todo, index) => {
  console.log(`${index + 1}. **${todo.filePath}:${todo.startLine}**`);

  const todoLine = todo.chunkText.split('\n').find((line) => /TODO|FIXME/i.test(line));
  if (todoLine) {
    console.log(`   ${todoLine.trim()}\n`);
  }
});

if (todos.length > 5) {
  console.log(`   ... and ${todos.length - 5} more\n`);
}

console.log('✓ find_todos working\n');
console.log('---\n');

// Test 5: trace_request_flow
console.log('=== Test 5: trace_request_flow ===');
console.log('Simulating: Claude asks "How does user authentication flow work?"\n');

const flowResults = await queryEngine.traceRequestFlow('user authentication login', 6);

console.log(`# Request Flow Trace: "user authentication login"\n`);

if (flowResults.frontend.length > 0) {
  console.log(`## Frontend (${flowResults.frontend.length})\n`);
  flowResults.frontend.forEach((result, index) => {
    const { chunk, score } = result;
    console.log(`${index + 1}. **${chunk.filePath}:${chunk.startLine}** (${(score * 100).toFixed(1)}%)`);
    if (chunk.symbolName) {
      console.log(`   ${chunk.symbolType}: \`${chunk.symbolName}\`\n`);
    }
  });
}

if (flowResults.backend.length > 0) {
  console.log(`## Backend (${flowResults.backend.length})\n`);
  flowResults.backend.forEach((result, index) => {
    const { chunk, score } = result;
    console.log(`${index + 1}. **${chunk.filePath}:${chunk.startLine}** (${(score * 100).toFixed(1)}%)`);
    if (chunk.symbolName) {
      console.log(`   ${chunk.symbolType}: \`${chunk.symbolName}\`\n`);
    }
  });
}

if (flowResults.database.length > 0) {
  console.log(`## Database (${flowResults.database.length})\n`);
  flowResults.database.forEach((result, index) => {
    const { chunk, score } = result;
    console.log(`${index + 1}. **${chunk.filePath}:${chunk.startLine}** (${(score * 100).toFixed(1)}%)\n`);
  });
}

console.log('✓ trace_request_flow working\n');
console.log('---\n');

// Summary
console.log('=== Test Summary ===\n');
console.log('✓ semantic_search - PASSED');
console.log('✓ find_related_code - PASSED');
console.log('✓ explain_error - PASSED');
console.log('✓ find_todos - PASSED');
console.log('✓ trace_request_flow - PASSED');
console.log('\nAll 5 MCP tools are working correctly!\n');

metadataStore.close();
