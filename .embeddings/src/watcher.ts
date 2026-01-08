#!/usr/bin/env node

/**
 * File Watcher for Incremental Updates
 *
 * Monitors PlexMCP codebase for changes and automatically updates embeddings.
 *
 * Features:
 * - Watches configured file patterns
 * - Debounces rapid changes (2 second delay)
 * - Incremental reindexing (only changed files)
 * - Graceful error handling
 */

import chokidar from 'chokidar';
import chalk from 'chalk';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Indexer } from './indexer.js';

const execPromise = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PROJECT_PATH = path.resolve(__dirname, '../../');
const DATA_PATH = path.join(__dirname, '../data');
const DEBOUNCE_MS = 2000; // Wait 2 seconds after last change

const WATCH_PATTERNS = [
  'crates/**/*.rs',
  'web/src/**/*.{ts,tsx}',
  'migrations/**/*.sql',
  '*.md',
  'docs/**/*.md',
  'DEBUG*.md',
];

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/target/**',
  '**/dist/**',
  '**/.git/**',
  '.embeddings/**',
];

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
  'coderabbit-reviews': ['.coderabbit/reviews/**/*.{md,json}'],
};

class FileWatcher {
  private watcher: any | null = null;
  private indexer: Indexer;
  private pendingFiles: Set<string> = new Set();
  private debounceTimer: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private lastReviewTime: number = 0;
  private readonly MIN_REVIEW_INTERVAL = 60000; // 1 minute

  constructor() {
    this.indexer = new Indexer({
      projectPath: PROJECT_PATH,
      dataPath: DATA_PATH,
      domains: DOMAINS,
    });
  }

  async start(): Promise<void> {
    console.log(chalk.cyan.bold('\n🔍 PlexMCP File Watcher\n'));
    console.log('Watching for changes in:');
    WATCH_PATTERNS.forEach((pattern) => {
      console.log(chalk.gray(`  - ${pattern}`));
    });
    console.log();

    // Initialize indexer
    try {
      await this.indexer.initialize();
      console.log(chalk.green('✓ Indexer initialized\n'));
    } catch (error) {
      console.error(chalk.red('✗ Failed to initialize indexer:'), error);
      process.exit(1);
    }

    // Set up file watcher
    this.watcher = chokidar.watch(WATCH_PATTERNS, {
      cwd: PROJECT_PATH,
      ignored: IGNORE_PATTERNS,
      persistent: true,
      ignoreInitial: true, // Don't trigger on startup
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    // Watch for changes
    this.watcher
      .on('add', (filePath: string) => this.handleFileChange(filePath, 'added'))
      .on('change', (filePath: string) => this.handleFileChange(filePath, 'changed'))
      .on('unlink', (filePath: string) => this.handleFileDelete(filePath))
      .on('error', (error: Error) => {
        console.error(chalk.red('Watcher error:'), error);
      });

    console.log(chalk.green('✓ Watching for changes...\n'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
  }

  private handleFileChange(filePath: string, action: 'added' | 'changed'): void {
    const absolutePath = path.join(PROJECT_PATH, filePath);

    console.log(chalk.yellow(`${action === 'added' ? '+' : '~'} ${filePath}`));

    // Add to pending files
    this.pendingFiles.add(absolutePath);

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processChanges();
    }, DEBOUNCE_MS);
  }

  private handleFileDelete(filePath: string): void {
    const absolutePath = path.join(PROJECT_PATH, filePath);

    console.log(chalk.red(`- ${filePath}`));

    // Remove chunks for deleted file
    this.indexer.getMetadataStore().deleteChunksByFile(filePath);

    console.log(chalk.gray(`  Removed chunks for deleted file\n`));
  }

  private async processChanges(): Promise<void> {
    if (this.isProcessing || this.pendingFiles.size === 0) {
      return;
    }

    this.isProcessing = true;
    const files = Array.from(this.pendingFiles);
    this.pendingFiles.clear();

    console.log(chalk.cyan(`\n⟳ Updating ${files.length} file(s)...\n`));

    try {
      const startTime = Date.now();

      // Process each file incrementally
      for (const absolutePath of files) {
        const relativePath = path.relative(PROJECT_PATH, absolutePath);

        // Remove old chunks for this file
        this.indexer.getMetadataStore().deleteChunksByFile(relativePath);

        // Reindex the file
        await this.indexer.indexSingleFile(absolutePath, relativePath);

        console.log(chalk.gray(`  ✓ ${relativePath}`));
      }

      // Save updated indexes
      await this.indexer.getFaissStore().save();

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(chalk.green(`\n✓ Update completed in ${duration}s\n`));

      const stats = this.indexer.getStats();
      console.log(chalk.gray(`Total chunks: ${stats.totalChunks}`));
      console.log(chalk.gray(`TODOs: ${stats.totalTodos}`));
      console.log(chalk.gray(`Debug logs: ${stats.totalDebugLogs}\n`));

      // Run CodeRabbit review on changed files
      if (files.length > 0) {
        await this.runCodeRabbitReview(files);
      }
    } catch (error) {
      console.error(chalk.red('\n✗ Update failed:'), error);
    } finally {
      this.isProcessing = false;

      // Check if more changes arrived during processing
      if (this.pendingFiles.size > 0) {
        console.log(chalk.yellow('More changes detected, scheduling update...\n'));
        this.debounceTimer = setTimeout(() => {
          this.processChanges();
        }, DEBOUNCE_MS);
      }
    }
  }

  /**
   * Run CodeRabbit review with rate limiting
   */
  private async runCodeRabbitReview(files: string[]): Promise<void> {
    const now = Date.now();
    if (now - this.lastReviewTime < this.MIN_REVIEW_INTERVAL) {
      console.log(chalk.yellow('⏳ Rate limit: Waiting before next CodeRabbit review'));
      return;
    }

    try {
      console.log(chalk.cyan('🐰 Running CodeRabbit review (background)...\n'));

      // Run in background, don't wait for completion
      execPromise(
        `coderabbit --prompt-only --type uncommitted`,
        { cwd: PROJECT_PATH, timeout: 30000 }
      ).catch(err => {
        console.log(chalk.gray('CodeRabbit review pending or failed (non-blocking)'));
      });

      this.lastReviewTime = now;
    } catch (error) {
      // Silent fail - don't interrupt development
    }
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (this.watcher) {
      await this.watcher.close();
    }

    this.indexer.close();

    console.log(chalk.gray('\n✓ File watcher stopped\n'));
  }
}

// Run watcher
const watcher = new FileWatcher();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\nShutting down...'));
  await watcher.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await watcher.stop();
  process.exit(0);
});

// Start watching
watcher.start().catch((error) => {
  console.error(chalk.red('Failed to start watcher:'), error);
  process.exit(1);
});
