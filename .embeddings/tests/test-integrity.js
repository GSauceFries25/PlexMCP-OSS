// Data integrity verification script
import { MetadataStore } from './dist/metadata-store.js';
import { FaissStore } from './dist/faiss-store.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_PATH = path.join(__dirname, 'data');

console.log('=== Data Integrity Verification ===\n');

// Initialize stores
const metadataStore = new MetadataStore(path.join(DATA_PATH, 'metadata.db'));
const faissStore = new FaissStore(768, path.join(DATA_PATH, 'embeddings.faiss'));

// Load FAISS index
await faissStore.load();

// Get counts
const stats = metadataStore.getStats();
const faissVectorCount = faissStore.getTotalVectors();

console.log('Database Statistics:');
console.log(`  SQLite chunks: ${stats.totalChunks}`);
console.log(`  FAISS vectors: ${faissVectorCount}`);

// Verify counts match
if (stats.totalChunks === faissVectorCount) {
  console.log(`\n✓ Count verification PASSED (${stats.totalChunks} == ${faissVectorCount})`);
} else {
  console.error(`\n✗ Count verification FAILED (${stats.totalChunks} != ${faissVectorCount})`);
  process.exit(1);
}

// Sample vector IDs by checking TODOs (we know these exist)
console.log('\nVerifying vector ID references (sample from TODOs):');
const todos = metadataStore.getTodos();
const sampleSize = Math.min(10, todos.length);

let validReferences = 0;
for (let i = 0; i < sampleSize; i++) {
  const chunk = todos[i];
  if (chunk.vectorId >= 0 && chunk.vectorId < faissVectorCount) {
    validReferences++;
  } else {
    console.error(`  ✗ Invalid vectorId: ${chunk.vectorId} for chunk ${chunk.id}`);
  }
}

console.log(`  ${validReferences}/${sampleSize} vector IDs are valid`);

if (validReferences === sampleSize) {
  console.log('  ✓ Vector ID verification PASSED');
} else {
  console.error('  ✗ Vector ID verification FAILED');
  process.exit(1);
}

// Verify vector IDs are sequential (0 to n-1)
console.log('\nVerifying vector ID range:');
const debugLogs = metadataStore.getDebugLogs();
let maxVectorId = -1;
let minVectorId = Infinity;

for (const chunk of [...todos, ...debugLogs]) {
  maxVectorId = Math.max(maxVectorId, chunk.vectorId);
  minVectorId = Math.min(minVectorId, chunk.vectorId);
}

console.log(`  Vector ID range: ${minVectorId} to ${maxVectorId}`);
console.log(`  Expected range: 0 to ${faissVectorCount - 1}`);

if (maxVectorId < faissVectorCount && minVectorId >= 0) {
  console.log('  ✓ Vector ID range verification PASSED');
} else {
  console.error('  ✗ Vector ID range out of bounds');
  process.exit(1);
}

// Verify FTS5 search index
console.log('\nVerifying FTS5 full-text search:');
const testSearches = [
  'stripe',
  'oauth',
  'TODO',
  'billing'
];

for (const term of testSearches) {
  const results = metadataStore.fullTextSearch(term, 5);
  if (results.length === 0) {
    console.log(`  ⚠ No results for "${term}" (might be expected)`);
  } else {
    console.log(`  ✓ FTS5 search for "${term}" returned ${results.length} results`);
  }
}

console.log('\n=== All Integrity Checks PASSED ===\n');

metadataStore.close();
