// Quick test script to verify TODO detection
import { MetadataStore } from './dist/metadata-store.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new MetadataStore(path.join(__dirname, 'data/metadata.db'));

console.log('=== TODO Detection Test ===\n');

const todos = store.getTodos();
console.log(`Total TODOs found: ${todos.length}\n`);

// Show first 10 TODOs
console.log('Sample TODOs:\n');
for (let i = 0; i < Math.min(10, todos.length); i++) {
  const todo = todos[i];
  console.log(`${i + 1}. ${todo.filePath}:${todo.startLine}`);
  if (todo.symbolName) {
    console.log(`   ${todo.symbolType}: ${todo.symbolName}`);
  }
  const snippet = todo.chunkText.split('\n').find(line => /TODO|FIXME/i.test(line));
  if (snippet) {
    console.log(`   ${snippet.trim()}`);
  }
  console.log();
}

// Group by domain
const byDomain = {};
todos.forEach(todo => {
  byDomain[todo.domain] = (byDomain[todo.domain] || 0) + 1;
});

console.log('TODOs by domain:');
for (const [domain, count] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${domain}: ${count}`);
}

store.close();
