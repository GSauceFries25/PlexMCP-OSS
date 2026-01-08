/**
 * Main Indexer
 * Orchestrates file discovery, chunking, embedding generation, and storage
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { randomUUID } from 'crypto';
import { OllamaEmbedding } from './ollama-embedding.js';
import { MetadataStore, ChunkMetadata } from './metadata-store.js';
import { FaissStore } from './faiss-store.js';
import { RustChunker } from './chunkers/rust-chunker.js';
import { TypeScriptChunker } from './chunkers/typescript-chunker.js';
import { MarkdownChunker } from './chunkers/markdown-chunker.js';
import { CodeChunk } from './chunkers/base-chunker.js';

export interface IndexerConfig {
  projectPath: string;
  dataPath: string;
  embeddingModel?: string;
  domains: Record<string, string[]>;
}

export interface IndexingProgress {
  filesDiscovered: number;
  filesProcessed: number;
  chunksCreated: number;
  embeddingsGenerated: number;
  currentFile?: string;
}

export class Indexer {
  private config: IndexerConfig;
  private embedding: OllamaEmbedding;
  private metadataStore: MetadataStore;
  private faissStore: FaissStore | null = null;
  private rustChunker: RustChunker;
  private typescriptChunker: TypeScriptChunker;
  private markdownChunker: MarkdownChunker;
  private dimension: number = 768; // nomic-embed-text dimension

  constructor(config: IndexerConfig) {
    this.config = config;
    this.embedding = new OllamaEmbedding({
      model: config.embeddingModel || 'nomic-embed-text',
    });
    this.metadataStore = new MetadataStore(path.join(config.dataPath, 'metadata.db'));
    this.rustChunker = new RustChunker();
    this.typescriptChunker = new TypeScriptChunker();
    this.markdownChunker = new MarkdownChunker();
  }

  /**
   * Initialize the indexer (check Ollama, get embedding dimension)
   */
  async initialize(): Promise<void> {
    console.log('Checking Ollama connection...');
    const isHealthy = await this.embedding.isHealthy();
    if (!isHealthy) {
      throw new Error('Ollama server is not reachable. Please start it with: ollama serve');
    }

    const hasModel = await this.embedding.verifyModel();
    if (!hasModel) {
      throw new Error('nomic-embed-text model not found. Please run: ollama pull nomic-embed-text');
    }

    console.log('Getting embedding dimension...');
    this.dimension = await this.embedding.getDimension();
    console.log(`✓ Embedding dimension: ${this.dimension}`);

    // Initialize FAISS store
    this.faissStore = new FaissStore(this.dimension, path.join(this.config.dataPath, 'embeddings.faiss'));
    await this.faissStore.initialize();
  }

  /**
   * Run full indexing of the project
   */
  async indexProject(onProgress?: (progress: IndexingProgress) => void): Promise<void> {
    console.log('\n=== Starting PlexMCP Indexing ===\n');

    const progress: IndexingProgress = {
      filesDiscovered: 0,
      filesProcessed: 0,
      chunksCreated: 0,
      embeddingsGenerated: 0,
    };

    // Discover all files
    console.log('Discovering files...');
    const files = await this.discoverFiles();
    progress.filesDiscovered = files.length;
    console.log(`✓ Found ${files.length} files\n`);

    if (onProgress) onProgress(progress);

    // Process each file
    for (const file of files) {
      progress.currentFile = file.relativePath;
      console.log(`[${progress.filesProcessed + 1}/${files.length}] ${file.relativePath}`);

      try {
        const chunks = await this.processFile(file);
        progress.chunksCreated += chunks.length;
        progress.embeddingsGenerated += chunks.length;
        progress.filesProcessed++;

        if (onProgress) onProgress(progress);
      } catch (error) {
        console.error(`  ✗ Error processing ${file.relativePath}:`, error);
      }
    }

    // Save the indexes
    console.log('\nSaving indexes...');
    await this.faissStore!.save();
    console.log('✓ FAISS index saved');

    console.log('\n=== Indexing Complete ===');
    console.log(`Files processed: ${progress.filesProcessed}/${progress.filesDiscovered}`);
    console.log(`Total chunks: ${progress.chunksCreated}`);
    console.log(`Embeddings generated: ${progress.embeddingsGenerated}`);
  }

  /**
   * Discover files based on domain patterns
   */
  private async discoverFiles(): Promise<Array<{ path: string; relativePath: string; domain: string; fileType: string }>> {
    const files: Array<{ path: string; relativePath: string; domain: string; fileType: string }> = [];

    for (const [domain, patterns] of Object.entries(this.config.domains)) {
      for (const pattern of patterns) {
        const matches = await glob(pattern, {
          cwd: this.config.projectPath,
          absolute: false,
          ignore: ['**/node_modules/**', '**/target/**', '**/.git/**', '**/dist/**'],
        });

        for (const match of matches) {
          const fullPath = path.join(this.config.projectPath, match);
          const fileType = this.getFileType(match);

          files.push({
            path: fullPath,
            relativePath: match,
            domain,
            fileType,
          });
        }
      }
    }

    return files;
  }

  /**
   * Process a single file: chunk, embed, store
   */
  private async processFile(file: {
    path: string;
    relativePath: string;
    domain: string;
    fileType: string;
  }): Promise<ChunkMetadata[]> {
    // Read file content
    const content = fs.readFileSync(file.path, 'utf-8');

    // Chunk the file
    const chunks = this.chunkFile(content, file.path, file.fileType);
    console.log(`  → ${chunks.length} chunks`);

    // Generate embeddings and store
    const metadataChunks: ChunkMetadata[] = [];

    for (const chunk of chunks) {
      // Generate embedding
      const embedding = await this.embedding.embed(chunk.text);

      // Store in FAISS
      const vectorId = await this.faissStore!.addVector(embedding);

      // Create metadata
      const metadata: ChunkMetadata = {
        id: randomUUID(),
        filePath: file.relativePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        domain: file.domain,
        fileType: file.fileType,
        symbolName: chunk.symbolName,
        symbolType: chunk.symbolType,
        tags: chunk.tags,
        isTodo: chunk.isTodo,
        isDebugLog: file.relativePath.includes('DEBUG') && file.fileType === 'markdown',
        chunkText: chunk.text,
        lastModified: new Date().toISOString(),
        vectorId,
      };

      // Store metadata
      this.metadataStore.insertChunk(metadata);
      metadataChunks.push(metadata);
    }

    return metadataChunks;
  }

  /**
   * Chunk a file using the appropriate chunker
   */
  private chunkFile(content: string, filePath: string, fileType: string): CodeChunk[] {
    switch (fileType) {
      case 'rust':
        return this.rustChunker.chunkFile(content, filePath);
      case 'typescript':
      case 'tsx':
        return this.typescriptChunker.chunkFile(content, filePath);
      case 'markdown':
        return this.markdownChunker.chunkFile(content, filePath);
      default:
        // Fallback: treat as plain text, create one chunk
        return [
          {
            text: content.substring(0, 2000), // Limit to ~500 tokens
            startLine: 0,
            endLine: content.split('\n').length - 1,
            tags: [],
            isTodo: /TODO|FIXME/i.test(content),
          },
        ];
    }
  }

  /**
   * Get file type from extension
   */
  private getFileType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.rs':
        return 'rust';
      case '.ts':
        return 'typescript';
      case '.tsx':
        return 'tsx';
      case '.js':
      case '.jsx':
        return 'typescript'; // Use same chunker
      case '.md':
        return 'markdown';
      case '.sql':
        return 'sql';
      default:
        return 'text';
    }
  }

  /**
   * Get indexer statistics
   */
  getStats() {
    return this.metadataStore.getStats();
  }

  /**
   * Index a single file (for incremental updates)
   */
  async indexSingleFile(absolutePath: string, relativePath: string): Promise<void> {
    if (!fs.existsSync(absolutePath)) {
      return;
    }

    // Determine domain and file type
    const fileType = this.getFileType(absolutePath);
    let domain = 'unknown';

    // Find which domain this file belongs to
    for (const [domainName, patterns] of Object.entries(this.config.domains)) {
      for (const pattern of patterns) {
        const globPattern = path.join(this.config.projectPath, pattern);
        const matches = await glob(globPattern, { nodir: true });

        if (matches.some((m) => path.relative(this.config.projectPath, m) === relativePath)) {
          domain = domainName;
          break;
        }
      }
      if (domain !== 'unknown') break;
    }

    // Process the file
    const fileInfo = {
      path: absolutePath,
      relativePath,
      domain,
      fileType,
    };

    await this.processFile(fileInfo);
  }

  /**
   * Get metadata store (for watcher)
   */
  getMetadataStore(): MetadataStore {
    return this.metadataStore;
  }

  /**
   * Get FAISS store (for watcher)
   */
  getFaissStore(): FaissStore {
    if (!this.faissStore) {
      throw new Error('FAISS store not initialized');
    }
    return this.faissStore;
  }

  /**
   * Close all connections
   */
  close(): void {
    this.metadataStore.close();
  }
}
