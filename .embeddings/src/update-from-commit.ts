#!/usr/bin/env node

/**
 * Update Embeddings from Git Commit
 *
 * Called by post-commit hook to incrementally update embeddings
 * for files changed in the last commit.
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { Indexer } from './indexer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_PATH = path.resolve(__dirname, '../../');
const DATA_PATH = path.join(__dirname, '../data');

const DOMAINS = {
  'rust-billing': ['crates/api/src/routes/billing.rs', 'crates/billing/**/*.rs'],
  'rust-auth': ['crates/api/src/auth/**/*.rs', 'crates/api/src/routes/auth.rs', 'crates/api/src/routes/two_factor.rs'],
  'rust-mcp': ['crates/api/src/mcp/**/*.rs', 'crates/api/src/routes/mcp_proxy.rs'],
  'rust-admin': ['crates/api/src/routes/admin*.rs'],
  'rust-support': ['crates/api/src/routes/support.rs'],
  'rust-other': ['crates/**/*.rs'],
  'typescript-frontend': ['web/src/**/*.{ts,tsx}'],
  'database': ['migrations/**/*.sql'],
  'docs': ['*.md', 'docs/**/*.md'],
  'debug-logs': ['DEBUG*.md'],
};

async function updateFromCommit() {
  // Get changed files from command line argument or stdin
  const changedFiles = process.argv[2]?.split('\n').filter(f => f.trim()) || [];

  if (changedFiles.length === 0) {
    console.log('No files to update');
    return;
  }

  // Filter to only files we care about
  const relevantExtensions = ['.rs', '.ts', '.tsx', '.js', '.jsx', '.md', '.sql'];
  const filesToUpdate = changedFiles.filter(file =>
    relevantExtensions.some(ext => file.endsWith(ext))
  );

  if (filesToUpdate.length === 0) {
    console.log('No relevant files changed');
    return;
  }

  console.log(`Updating ${filesToUpdate.length} file(s)...`);

  const indexer = new Indexer({
    projectPath: PROJECT_PATH,
    dataPath: DATA_PATH,
    domains: DOMAINS,
  });

  try {
    await indexer.initialize();

    let updated = 0;
    let deleted = 0;

    for (const relativePath of filesToUpdate) {
      const absolutePath = path.join(PROJECT_PATH, relativePath);

      if (fs.existsSync(absolutePath)) {
        // File exists - update it
        indexer.getMetadataStore().deleteChunksByFile(relativePath);
        await indexer.indexSingleFile(absolutePath, relativePath);
        updated++;
        console.log(`  ✓ ${relativePath}`);
      } else {
        // File was deleted - remove chunks
        indexer.getMetadataStore().deleteChunksByFile(relativePath);
        deleted++;
        console.log(`  - ${relativePath}`);
      }
    }

    // Save updated index
    await indexer.getFaissStore().save();

    console.log(`\n✓ Updated: ${updated}, Deleted: ${deleted}`);

    indexer.close();
  } catch (error) {
    console.error('Error updating embeddings:', error);
    process.exit(1);
  }
}

updateFromCommit().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
