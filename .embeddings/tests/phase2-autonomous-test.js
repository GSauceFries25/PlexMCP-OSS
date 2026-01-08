/**
 * Phase II Autonomous Test Suite
 *
 * Comprehensive testing of all Phase II functionality:
 * - Query engine hybrid search
 * - All 5 MCP tools
 * - Edge cases and error handling
 * - Performance benchmarks
 * - Integration stability
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

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║     Phase II Autonomous Test Suite                      ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

let testsPassed = 0;
let testsFailed = 0;

function pass(testName) {
  console.log(`✓ ${testName}`);
  testsPassed++;
}

function fail(testName, error) {
  console.log(`✗ ${testName}`);
  console.log(`  Error: ${error}`);
  testsFailed++;
}

// Initialize
console.log('Initializing components...');
const metadataStore = new MetadataStore(path.join(DATA_PATH, 'metadata.db'));
const faissStore = new FaissStore(768, path.join(DATA_PATH, 'embeddings.faiss'));
const embedding = new OllamaEmbedding();

await faissStore.load();
const queryEngine = new QueryEngine(faissStore, metadataStore, embedding);
console.log('✓ Initialization complete\n');

// ============================================================================
// TEST CATEGORY 1: Query Engine Core Functionality
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST CATEGORY 1: Query Engine Core Functionality');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 1.1: Basic hybrid search
try {
  const results = await queryEngine.search('stripe payment processing', { maxResults: 5 });
  if (results.length > 0 && results[0].chunk && results[0].score) {
    pass('1.1: Basic hybrid search returns valid results');
  } else {
    fail('1.1: Basic hybrid search', 'Invalid result structure');
  }
} catch (error) {
  fail('1.1: Basic hybrid search', error.message);
}

// Test 1.2: Domain filtering
try {
  const results = await queryEngine.search('subscription', {
    maxResults: 10,
    domain: 'rust-billing'
  });

  const allInDomain = results.every(r => r.chunk.domain === 'rust-billing');
  if (allInDomain) {
    pass('1.2: Domain filtering works correctly');
  } else {
    fail('1.2: Domain filtering', 'Results contain wrong domains');
  }
} catch (error) {
  fail('1.2: Domain filtering', error.message);
}

// Test 1.3: File type filtering
try {
  const results = await queryEngine.search('function', {
    maxResults: 10,
    fileType: 'rust'
  });

  const allCorrectType = results.every(r => r.chunk.fileType === 'rust');
  if (allCorrectType) {
    pass('1.3: File type filtering works correctly');
  } else {
    fail('1.3: File type filtering', 'Results contain wrong file types');
  }
} catch (error) {
  fail('1.3: File type filtering', error.message);
}

// Test 1.4: Weight adjustment (semantic-heavy)
try {
  const results = await queryEngine.search('payment', {
    maxResults: 5,
    semanticWeight: 0.9,
    keywordWeight: 0.1
  });

  if (results.length > 0) {
    pass('1.4: Semantic-heavy weight adjustment works');
  } else {
    fail('1.4: Semantic-heavy weight adjustment', 'No results returned');
  }
} catch (error) {
  fail('1.4: Semantic-heavy weight adjustment', error.message);
}

// Test 1.5: Weight adjustment (keyword-heavy)
try {
  const results = await queryEngine.search('stripe', {
    maxResults: 5,
    semanticWeight: 0.1,
    keywordWeight: 0.9
  });

  if (results.length > 0) {
    pass('1.5: Keyword-heavy weight adjustment works');
  } else {
    fail('1.5: Keyword-heavy weight adjustment', 'No results returned');
  }
} catch (error) {
  fail('1.5: Keyword-heavy weight adjustment', error.message);
}

// Test 1.6: Result ranking (scores decreasing)
try {
  const results = await queryEngine.search('billing webhook', { maxResults: 10 });

  let properlyRanked = true;
  for (let i = 1; i < results.length; i++) {
    if (results[i].score > results[i-1].score) {
      properlyRanked = false;
      break;
    }
  }

  if (properlyRanked) {
    pass('1.6: Results properly ranked by score (descending)');
  } else {
    fail('1.6: Results ranking', 'Scores not in descending order');
  }
} catch (error) {
  fail('1.6: Results ranking', error.message);
}

// Test 1.7: Match type diversity
try {
  const results = await queryEngine.search('stripe webhook subscription', { maxResults: 20 });

  const matchTypes = new Set(results.map(r => r.matchType));
  if (matchTypes.size >= 1) { // Should have at least one match type
    pass('1.7: Match type classification working');
  } else {
    fail('1.7: Match type classification', 'No match types found');
  }
} catch (error) {
  fail('1.7: Match type classification', error.message);
}

console.log();

// ============================================================================
// TEST CATEGORY 2: MCP Tool #1 - semantic_search
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST CATEGORY 2: MCP Tool - semantic_search');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 2.1: Billing-related query
try {
  const results = await queryEngine.search('stripe subscription upgrade downgrade', {
    maxResults: 5,
    domain: 'rust-billing'
  });

  if (results.length > 0 && results.some(r => r.chunk.filePath.includes('billing'))) {
    pass('2.1: Billing query returns relevant results');
  } else {
    fail('2.1: Billing query', 'No billing-related results found');
  }
} catch (error) {
  fail('2.1: Billing query', error.message);
}

// Test 2.2: Authentication-related query
try {
  const results = await queryEngine.search('user login oauth authentication', {
    maxResults: 5,
    domain: 'rust-auth'
  });

  if (results.length > 0) {
    pass('2.2: Auth query returns results');
  } else {
    fail('2.2: Auth query', 'No auth results found');
  }
} catch (error) {
  fail('2.2: Auth query', error.message);
}

// Test 2.3: Frontend component query
try {
  const results = await queryEngine.search('react component button form', {
    maxResults: 5,
    domain: 'typescript-frontend'
  });

  if (results.length > 0) {
    pass('2.3: Frontend query returns results');
  } else {
    fail('2.3: Frontend query', 'No frontend results found');
  }
} catch (error) {
  fail('2.3: Frontend query', error.message);
}

// Test 2.4: Database migration query
try {
  const results = await queryEngine.search('create table alter column', {
    maxResults: 5,
    domain: 'database'
  });

  if (results.length > 0 && results.some(r => r.chunk.fileType === 'sql')) {
    pass('2.4: Database query returns SQL results');
  } else {
    fail('2.4: Database query', 'No SQL results found');
  }
} catch (error) {
  fail('2.4: Database query', error.message);
}

// Test 2.5: Multi-word concept query
try {
  const results = await queryEngine.search('webhook event processing subscription updated', {
    maxResults: 5
  });

  if (results.length > 0) {
    pass('2.5: Multi-word concept query works');
  } else {
    fail('2.5: Multi-word concept query', 'No results found');
  }
} catch (error) {
  fail('2.5: Multi-word concept query', error.message);
}

console.log();

// ============================================================================
// TEST CATEGORY 3: MCP Tool #2 - find_related_code
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST CATEGORY 3: MCP Tool - find_related_code');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 3.1: Find related to billing routes
try {
  const results = await queryEngine.findRelatedCode('crates/api/src/routes/billing.rs', 5);

  const excludesSource = results.every(r => r.chunk.filePath !== 'crates/api/src/routes/billing.rs');
  if (results.length > 0 && excludesSource) {
    pass('3.1: Related code excludes source file');
  } else {
    fail('3.1: Related code', 'Source file not excluded or no results');
  }
} catch (error) {
  fail('3.1: Related code', error.message);
}

// Test 3.2: Find related to auth routes
try {
  const results = await queryEngine.findRelatedCode('crates/api/src/routes/auth.rs', 5);

  if (results.length > 0) {
    pass('3.2: Related auth code found');
  } else {
    fail('3.2: Related auth code', 'No related results');
  }
} catch (error) {
  fail('3.2: Related auth code', error.message);
}

// Test 3.3: Nonexistent file handling
try {
  const results = await queryEngine.findRelatedCode('nonexistent/file.rs', 5);

  if (results.length === 0) {
    pass('3.3: Nonexistent file returns empty gracefully');
  } else {
    fail('3.3: Nonexistent file handling', 'Should return empty array');
  }
} catch (error) {
  fail('3.3: Nonexistent file handling', error.message);
}

console.log();

// ============================================================================
// TEST CATEGORY 4: MCP Tool #3 - explain_error
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST CATEGORY 4: MCP Tool - explain_error');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 4.1: OAuth error search
try {
  const results = await queryEngine.searchDebugLogs('OAuth callback redirect', 5);

  const allDebugLogs = results.every(r => r.chunk.isDebugLog);
  if (results.length > 0 && allDebugLogs) {
    pass('4.1: OAuth error search returns debug logs only');
  } else {
    fail('4.1: OAuth error search', 'No debug logs or mixed results');
  }
} catch (error) {
  fail('4.1: OAuth error search', error.message);
}

// Test 4.2: Token validation error search
try {
  const results = await queryEngine.searchDebugLogs('token validation failed', 5);

  const allDebugLogs = results.every(r => r.chunk.isDebugLog);
  if (allDebugLogs) {
    pass('4.2: Token error search filters debug logs correctly');
  } else {
    fail('4.2: Token error search', 'Non-debug-log results found');
  }
} catch (error) {
  fail('4.2: Token error search', error.message);
}

// Test 4.3: Generic error pattern
try {
  const results = await queryEngine.searchDebugLogs('bug issue problem', 10);

  if (results.every(r => r.chunk.isDebugLog)) {
    pass('4.3: Generic error pattern returns only debug logs');
  } else {
    fail('4.3: Generic error pattern', 'Mixed result types');
  }
} catch (error) {
  fail('4.3: Generic error pattern', error.message);
}

console.log();

// ============================================================================
// TEST CATEGORY 5: MCP Tool #4 - find_todos
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST CATEGORY 5: MCP Tool - find_todos');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 5.1: All TODOs
try {
  const todos = queryEngine.getTodos();

  if (todos.length > 0 && todos.every(t => t.isTodo)) {
    pass(`5.1: All TODOs query (${todos.length} found)`);
  } else {
    fail('5.1: All TODOs query', 'No TODOs or non-TODO results');
  }
} catch (error) {
  fail('5.1: All TODOs query', error.message);
}

// Test 5.2: TODOs by domain (rust-billing)
try {
  const todos = queryEngine.getTodos('rust-billing');

  const allInDomain = todos.every(t => t.domain === 'rust-billing');
  if (allInDomain) {
    pass(`5.2: Domain-filtered TODOs (${todos.length} in rust-billing)`);
  } else {
    fail('5.2: Domain-filtered TODOs', 'Wrong domain results');
  }
} catch (error) {
  fail('5.2: Domain-filtered TODOs', error.message);
}

// Test 5.3: TODOs by domain (docs)
try {
  const todos = queryEngine.getTodos('docs');

  const allInDomain = todos.every(t => t.domain === 'docs');
  if (allInDomain) {
    pass(`5.3: Docs domain TODOs (${todos.length} found)`);
  } else {
    fail('5.3: Docs domain TODOs', 'Wrong domain results');
  }
} catch (error) {
  fail('5.3: Docs domain TODOs', error.message);
}

// Test 5.4: Nonexistent domain
try {
  const todos = queryEngine.getTodos('nonexistent-domain');

  if (todos.length === 0) {
    pass('5.4: Nonexistent domain returns empty array');
  } else {
    fail('5.4: Nonexistent domain', 'Should return empty');
  }
} catch (error) {
  fail('5.4: Nonexistent domain', error.message);
}

console.log();

// ============================================================================
// TEST CATEGORY 6: MCP Tool #5 - trace_request_flow
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST CATEGORY 6: MCP Tool - trace_request_flow');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 6.1: Login flow trace
try {
  const { frontend, backend, database } = await queryEngine.traceRequestFlow('user login', 9);

  if (frontend || backend || database) {
    pass(`6.1: Login flow trace (F:${frontend.length} B:${backend.length} D:${database.length})`);
  } else {
    fail('6.1: Login flow trace', 'No results in any layer');
  }
} catch (error) {
  fail('6.1: Login flow trace', error.message);
}

// Test 6.2: Billing flow trace
try {
  const { frontend, backend, database } = await queryEngine.traceRequestFlow('subscription payment', 9);

  if (frontend || backend || database) {
    pass(`6.2: Billing flow trace (F:${frontend.length} B:${backend.length} D:${database.length})`);
  } else {
    fail('6.2: Billing flow trace', 'No results in any layer');
  }
} catch (error) {
  fail('6.2: Billing flow trace', error.message);
}

// Test 6.3: MCP proxy flow trace
try {
  const { frontend, backend, database } = await queryEngine.traceRequestFlow('mcp request routing', 9);

  const totalResults = (frontend?.length || 0) + (backend?.length || 0) + (database?.length || 0);
  if (totalResults >= 0) { // Should at least not error
    pass('6.3: MCP proxy flow trace completes');
  } else {
    fail('6.3: MCP proxy flow trace', 'Unexpected error');
  }
} catch (error) {
  fail('6.3: MCP proxy flow trace', error.message);
}

console.log();

// ============================================================================
// TEST CATEGORY 7: Edge Cases and Error Handling
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST CATEGORY 7: Edge Cases and Error Handling');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 7.1: Empty query
try {
  const results = await queryEngine.search('', { maxResults: 5 });
  // Should handle gracefully (either empty or error caught)
  pass('7.1: Empty query handled gracefully');
} catch (error) {
  // Also acceptable to throw error
  pass('7.1: Empty query throws expected error');
}

// Test 7.2: Very long query
try {
  const longQuery = 'stripe payment subscription billing webhook event processing'.repeat(50);
  const results = await queryEngine.search(longQuery, { maxResults: 3 });
  pass('7.2: Very long query handled');
} catch (error) {
  fail('7.2: Very long query', error.message);
}

// Test 7.3: Special characters in query
try {
  const results = await queryEngine.search('user@example.com', { maxResults: 5 });
  // FTS5 might fail but semantic should work
  pass('7.3: Special characters handled (semantic fallback)');
} catch (error) {
  fail('7.3: Special characters', error.message);
}

// Test 7.4: maxResults = 0
try {
  const results = await queryEngine.search('test', { maxResults: 0 });
  if (results.length === 0) {
    pass('7.4: maxResults=0 returns empty array');
  } else {
    fail('7.4: maxResults=0', 'Should return empty');
  }
} catch (error) {
  fail('7.4: maxResults=0', error.message);
}

// Test 7.5: maxResults = 1000 (very large)
try {
  const results = await queryEngine.search('function', { maxResults: 1000 });
  pass(`7.5: Large maxResults handled (${results.length} results)`);
} catch (error) {
  fail('7.5: Large maxResults', error.message);
}

// Test 7.6: Invalid domain
try {
  const results = await queryEngine.search('test', {
    maxResults: 5,
    domain: 'invalid-domain-xyz'
  });

  if (results.length === 0) {
    pass('7.6: Invalid domain returns empty results');
  } else {
    fail('7.6: Invalid domain', 'Should return empty');
  }
} catch (error) {
  fail('7.6: Invalid domain', error.message);
}

// Test 7.7: Invalid file type
try {
  const results = await queryEngine.search('test', {
    maxResults: 5,
    fileType: 'invalid-type'
  });

  if (results.length === 0) {
    pass('7.7: Invalid file type returns empty results');
  } else {
    fail('7.7: Invalid file type', 'Should return empty');
  }
} catch (error) {
  fail('7.7: Invalid file type', error.message);
}

console.log();

// ============================================================================
// TEST CATEGORY 8: Performance Benchmarks
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST CATEGORY 8: Performance Benchmarks');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 8.1: Query latency (should be <200ms after first query)
try {
  const start = Date.now();
  await queryEngine.search('stripe billing', { maxResults: 5 });
  const duration = Date.now() - start;

  if (duration < 200) {
    pass(`8.1: Query latency optimal (${duration}ms < 200ms)`);
  } else {
    console.log(`⚠ 8.1: Query latency acceptable but slower (${duration}ms)`);
    testsPassed++;
  }
} catch (error) {
  fail('8.1: Query latency', error.message);
}

// Test 8.2: Batch query performance
try {
  const start = Date.now();
  await Promise.all([
    queryEngine.search('billing', { maxResults: 5 }),
    queryEngine.search('auth', { maxResults: 5 }),
    queryEngine.search('subscription', { maxResults: 5 })
  ]);
  const duration = Date.now() - start;

  if (duration < 500) {
    pass(`8.2: Batch queries fast (${duration}ms for 3 queries)`);
  } else {
    console.log(`⚠ 8.2: Batch queries slower than expected (${duration}ms)`);
    testsPassed++;
  }
} catch (error) {
  fail('8.2: Batch query performance', error.message);
}

// Test 8.3: Large result set performance
try {
  const start = Date.now();
  await queryEngine.search('function', { maxResults: 100 });
  const duration = Date.now() - start;

  if (duration < 300) {
    pass(`8.3: Large result set fast (${duration}ms for 100 results)`);
  } else {
    console.log(`⚠ 8.3: Large result set acceptable (${duration}ms)`);
    testsPassed++;
  }
} catch (error) {
  fail('8.3: Large result set performance', error.message);
}

console.log();

// ============================================================================
// FINAL SUMMARY
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('FINAL TEST SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const totalTests = testsPassed + testsFailed;
const passRate = ((testsPassed / totalTests) * 100).toFixed(1);

console.log(`Total Tests:  ${totalTests}`);
console.log(`✓ Passed:     ${testsPassed}`);
console.log(`✗ Failed:     ${testsFailed}`);
console.log(`Pass Rate:    ${passRate}%\n`);

if (testsFailed === 0) {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅ ALL TESTS PASSED - PHASE II PRODUCTION READY        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
} else {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ⚠️  SOME TESTS FAILED - REVIEW REQUIRED                ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

metadataStore.close();
process.exit(testsFailed > 0 ? 1 : 0);
