/**
 * PlexMCP Embeddings - Main Export
 * Semantic code search using Ollama embeddings
 */

export { OllamaEmbedding, type EmbeddingConfig } from './ollama-embedding.js';
export { MetadataStore, type ChunkMetadata } from './metadata-store.js';
export { FaissStore } from './faiss-store.js';
export { BaseChunker, type CodeChunk } from './chunkers/base-chunker.js';
export { RustChunker } from './chunkers/rust-chunker.js';
export { TypeScriptChunker } from './chunkers/typescript-chunker.js';
export { MarkdownChunker } from './chunkers/markdown-chunker.js';
export { Indexer, type IndexerConfig, type IndexingProgress } from './indexer.js';
export { QueryEngine, type SearchOptions, type SearchResult } from './query-engine.js';
