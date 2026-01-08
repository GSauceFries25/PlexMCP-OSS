// Query Engine Test Suite
import { QueryEngine } from '../dist/query-engine.js';
import { FaissStore } from '../dist/faiss-store.js';
import { MetadataStore } from '../dist/metadata-store.js';
import { OllamaEmbedding } from '../dist/ollama-embedding.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, '../data');

console.log('=== Query Engine Test Suite ===\n');

// Initialize components
const metadataStore = new MetadataStore(path.join(DATA_PATH, 'metadata.db'));
const faissStore = new FaissStore(768, path.join(DATA_PATH, 'embeddings.faiss'));
const embedding = new OllamaEmbedding();

console.log('Loading FAISS index...');
await faissStore.load();
console.log('✓ Index loaded\n');

const queryEngine = new QueryEngine(faissStore, metadataStore, embedding);

// Test 1: Hybrid Search
console.log('Test 1: Hybrid Search (semantic + keyword)');
console.log('Query: "stripe webhook subscription updated"');
const hybridResults = await queryEngine.search('stripe webhook subscription updated', {
  maxResults: 5,
  semanticWeight: 0.7,
  keywordWeight: 0.3,
});

console.log(`Found ${hybridResults.length} results:\n`);
hybridResults.forEach((result, index) => {
  console.log(`${index + 1}. ${result.chunk.filePath}:${result.chunk.startLine}`);
  console.log(`   Score: ${(result.score * 100).toFixed(1)}% (${result.matchType})`);
  console.log(`   Semantic: ${(result.semanticScore * 100).toFixed(1)}% | Keyword: ${(result.keywordScore * 100).toFixed(1)}%`);
  if (result.chunk.symbolName) {
    console.log(`   Symbol: ${result.chunk.symbolType} ${result.chunk.symbolName}`);
  }
  console.log();
});

// Test 2: Domain Filtering
console.log('\nTest 2: Domain Filtering (rust-billing only)');
const domainResults = await queryEngine.search('payment processing', {
  maxResults: 5,
  domain: 'rust-billing',
});

console.log(`Found ${domainResults.length} results in rust-billing:\n`);
domainResults.forEach((result, index) => {
  console.log(`${index + 1}. ${result.chunk.filePath}:${result.chunk.startLine} (${result.chunk.domain})`);
});

// Test 3: Find Related Code
console.log('\n\nTest 3: Find Related Code');
const testFile = 'crates/api/src/routes/billing.rs';
console.log(`Finding code related to: ${testFile}\n`);

const relatedResults = await queryEngine.findRelatedCode(testFile, 5);

console.log(`Found ${relatedResults.length} related chunks:\n`);
relatedResults.forEach((result, index) => {
  console.log(`${index + 1}. ${result.chunk.filePath}:${result.chunk.startLine}`);
  console.log(`   Similarity: ${(result.score * 100).toFixed(1)}%`);
  console.log(`   Domain: ${result.chunk.domain}`);
  console.log();
});

// Test 4: Debug Log Search
console.log('\nTest 4: Debug Log Search');
console.log('Searching for: "OAuth callback not working"\n');

const debugResults = await queryEngine.searchDebugLogs('OAuth callback not working', 5);

console.log(`Found ${debugResults.length} debug log entries:\n`);
debugResults.forEach((result, index) => {
  console.log(`${index + 1}. ${result.chunk.filePath}:${result.chunk.startLine}`);
  console.log(`   Relevance: ${(result.score * 100).toFixed(1)}%`);
  if (result.chunk.symbolName) {
    console.log(`   Section: ${result.chunk.symbolName}`);
  }
  console.log();
});

// Test 5: TODO Tracking
console.log('\nTest 5: TODO Tracking');
const allTodos = queryEngine.getTodos();
const rustTodos = queryEngine.getTodos('rust-billing');

console.log(`Total TODOs: ${allTodos.length}`);
console.log(`TODOs in rust-billing: ${rustTodos.length}\n`);

if (rustTodos.length > 0) {
  console.log('Sample rust-billing TODOs:');
  rustTodos.slice(0, 3).forEach((todo, index) => {
    console.log(`${index + 1}. ${todo.filePath}:${todo.startLine}`);
    const todoLine = todo.chunkText.split('\n').find(line => /TODO|FIXME/i.test(line));
    if (todoLine) {
      console.log(`   ${todoLine.trim()}`);
    }
    console.log();
  });
}

// Test 6: Request Flow Tracing
console.log('\nTest 6: Request Flow Tracing');
console.log('Tracing: "user login authentication"\n');

const flowResults = await queryEngine.traceRequestFlow('user login authentication', 9);

console.log(`Frontend components: ${flowResults.frontend.length}`);
flowResults.frontend.forEach((result, index) => {
  console.log(`  ${index + 1}. ${result.chunk.filePath}:${result.chunk.startLine}`);
});

console.log(`\nBackend handlers: ${flowResults.backend.length}`);
flowResults.backend.forEach((result, index) => {
  console.log(`  ${index + 1}. ${result.chunk.filePath}:${result.chunk.startLine}`);
});

console.log(`\nDatabase queries: ${flowResults.database.length}`);
flowResults.database.forEach((result, index) => {
  console.log(`  ${index + 1}. ${result.chunk.filePath}:${result.chunk.startLine}`);
});

// Test 7: Weight Adjustment
console.log('\n\nTest 7: Search Weight Adjustment');
console.log('Query: "stripe" with different weights\n');

const semanticHeavy = await queryEngine.search('stripe', {
  maxResults: 3,
  semanticWeight: 0.9,
  keywordWeight: 0.1,
});

const keywordHeavy = await queryEngine.search('stripe', {
  maxResults: 3,
  semanticWeight: 0.1,
  keywordWeight: 0.9,
});

console.log('Semantic-heavy (90% semantic, 10% keyword):');
semanticHeavy.forEach((r, i) => {
  console.log(`  ${i + 1}. ${r.chunk.filePath}:${r.chunk.startLine} - ${r.matchType} (${(r.score * 100).toFixed(1)}%)`);
});

console.log('\nKeyword-heavy (10% semantic, 90% keyword):');
keywordHeavy.forEach((r, i) => {
  console.log(`  ${i + 1}. ${r.chunk.filePath}:${r.chunk.startLine} - ${r.matchType} (${(r.score * 100).toFixed(1)}%)`);
});

console.log('\n=== All Query Engine Tests Complete ===\n');

metadataStore.close();
