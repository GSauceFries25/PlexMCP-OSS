// Error handling and edge cases test
import { MetadataStore } from './dist/metadata-store.js';
import { FaissStore } from './dist/faiss-store.js';
import { OllamaEmbedding } from './dist/ollama-embedding.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, 'data');

console.log('=== Error Handling & Edge Cases Test ===\n');

// Test 1: Missing FAISS index
console.log('Test 1: Missing FAISS index');
try {
  const fakeFaiss = new FaissStore(768, '/tmp/nonexistent.faiss');
  await fakeFaiss.load();
  console.log('  ✗ FAILED: Should have thrown error');
} catch (error) {
  console.log('  ✓ PASSED: Correctly throws error for missing index');
  console.log(`     Error: ${error.message}`);
}

// Test 2: Missing SQLite database
console.log('\nTest 2: Missing SQLite database');
try {
  const fakeDb = new MetadataStore('/tmp/nonexistent.db');
  // Should create new empty database
  const count = fakeDb.getTotalChunks();
  if (count === 0) {
    console.log('  ✓ PASSED: Creates new empty database (0 chunks)');
  } else {
    console.log(`  ✗ FAILED: Expected 0 chunks, got ${count}`);
  }
  fakeDb.close();
  fs.unlinkSync('/tmp/nonexistent.db');
} catch (error) {
  console.log(`  ✗ FAILED: Unexpected error: ${error.message}`);
}

// Test 3: Ollama connection
console.log('\nTest 3: Ollama connectivity');
try {
  const embedding = new OllamaEmbedding();
  const isHealthy = await embedding.isHealthy();
  if (isHealthy) {
    console.log('  ✓ PASSED: Ollama is running and healthy');
  } else {
    console.log('  ⚠ WARNING: Ollama is not healthy');
  }
} catch (error) {
  console.log(`  ✗ FAILED: ${error.message}`);
}

// Test 4: Empty search query
console.log('\nTest 4: Empty search query');
try {
  const metadataStore = new MetadataStore(path.join(DATA_PATH, 'metadata.db'));
  const results = metadataStore.fullTextSearch('', 5);
  console.log(`  ⚠ Empty query returned ${results.length} results (expected behavior)`);
  metadataStore.close();
} catch (error) {
  console.log(`  ✓ PASSED: Correctly handles empty query`);
  console.log(`     Error: ${error.message}`);
}

// Test 5: Invalid domain filter
console.log('\nTest 5: Invalid domain filter');
try {
  const metadataStore = new MetadataStore(path.join(DATA_PATH, 'metadata.db'));
  const results = metadataStore.getChunksByDomain('nonexistent-domain');
  if (results.length === 0) {
    console.log('  ✓ PASSED: Returns empty array for invalid domain');
  } else {
    console.log(`  ✗ FAILED: Expected 0 results, got ${results.length}`);
  }
  metadataStore.close();
} catch (error) {
  console.log(`  ✗ FAILED: Threw error instead of returning empty: ${error.message}`);
}

// Test 6: Very long search query
console.log('\nTest 6: Very long search query');
try {
  const embedding = new OllamaEmbedding();
  const longText = 'stripe billing subscription upgrade downgrade payment method '.repeat(100);
  console.log(`  Query length: ${longText.length} characters`);
  const startTime = Date.now();
  const vector = await embedding.embed(longText);
  const duration = Date.now() - startTime;

  if (vector && vector.length === 768) {
    console.log(`  ✓ PASSED: Generated embedding in ${duration}ms`);
  } else {
    console.log(`  ✗ FAILED: Invalid embedding dimension: ${vector?.length}`);
  }
} catch (error) {
  console.log(`  ✗ FAILED: ${error.message}`);
}

// Test 7: Special characters in search
console.log('\nTest 7: Special characters in search');
try {
  const metadataStore = new MetadataStore(path.join(DATA_PATH, 'metadata.db'));
  const specialQueries = [
    'user@example.com',
    'function()',
    'stripe::Error',
    'TODO: fix this',
    'email.verified == true'
  ];

  for (const query of specialQueries) {
    try {
      const results = metadataStore.fullTextSearch(query, 1);
      console.log(`  ✓ "${query}" => ${results.length} results`);
    } catch (err) {
      console.log(`  ✗ "${query}" => Error: ${err.message}`);
    }
  }
  metadataStore.close();
} catch (error) {
  console.log(`  ✗ FAILED: ${error.message}`);
}

// Test 8: Vector dimension mismatch
console.log('\nTest 8: Vector dimension mismatch');
try {
  const faissStore = new FaissStore(768, path.join(DATA_PATH, 'embeddings.faiss'));
  await faissStore.load();

  // Try to add wrong dimension vector
  const wrongVector = new Array(512).fill(0.1);
  await faissStore.addVector(wrongVector);
  console.log('  ✗ FAILED: Should have rejected wrong dimension');
} catch (error) {
  console.log('  ✓ PASSED: Correctly rejects wrong dimension vectors');
  console.log(`     Error: ${error.message}`);
}

console.log('\n=== Edge Case Testing Complete ===\n');
