/**
 * Query Engine
 *
 * Combines semantic vector search (FAISS) with keyword search (SQLite FTS5)
 * using Reciprocal Rank Fusion (RRF) for optimal result ranking.
 *
 * Architecture:
 * - Semantic search: Finds conceptually similar code via embeddings
 * - Keyword search: Finds exact term matches via full-text search
 * - RRF: Merges both result sets with position-based scoring
 */

import { FaissStore } from './faiss-store.js';
import { MetadataStore, ChunkMetadata } from './metadata-store.js';
import { OllamaEmbedding } from './ollama-embedding.js';

export interface SearchOptions {
  maxResults?: number;
  domain?: string;
  fileType?: string;
  semanticWeight?: number; // 0.0 to 1.0, default 0.7
  keywordWeight?: number;  // 0.0 to 1.0, default 0.3
}

export interface SearchResult {
  chunk: ChunkMetadata;
  score: number;
  semanticScore: number;
  keywordScore: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

export class QueryEngine {
  private faissStore: FaissStore;
  private metadataStore: MetadataStore;
  private embedding: OllamaEmbedding;

  constructor(
    faissStore: FaissStore,
    metadataStore: MetadataStore,
    embedding: OllamaEmbedding
  ) {
    this.faissStore = faissStore;
    this.metadataStore = metadataStore;
    this.embedding = embedding;
  }

  /**
   * Search using hybrid approach: semantic + keyword with RRF ranking
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      maxResults = 10,
      domain,
      fileType,
      semanticWeight = 0.7,
      keywordWeight = 0.3,
    } = options;

    // Validate maxResults (FAISS requires k > 0)
    if (maxResults <= 0) {
      return [];
    }

    // Validate weights sum to 1.0
    const totalWeight = semanticWeight + keywordWeight;
    const normalizedSemanticWeight = semanticWeight / totalWeight;
    const normalizedKeywordWeight = keywordWeight / totalWeight;

    // Run both searches in parallel for performance
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(query, maxResults * 2), // Get more candidates for fusion
      this.keywordSearch(query, maxResults * 2),
    ]);

    // Apply Reciprocal Rank Fusion (RRF)
    const fusedResults = this.applyRRF(
      semanticResults,
      keywordResults,
      normalizedSemanticWeight,
      normalizedKeywordWeight
    );

    // Filter by domain and file type if specified
    let filteredResults = fusedResults;
    if (domain) {
      filteredResults = filteredResults.filter((r) => r.chunk.domain === domain);
    }
    if (fileType) {
      filteredResults = filteredResults.filter((r) => r.chunk.fileType === fileType);
    }

    // Return top N results
    return filteredResults.slice(0, maxResults);
  }

  /**
   * Semantic search using vector embeddings
   */
  private async semanticSearch(
    query: string,
    maxResults: number
  ): Promise<Array<{ chunk: ChunkMetadata; distance: number }>> {
    // Generate query embedding
    const queryEmbedding = await this.embedding.embed(query);

    // Search FAISS index
    const searchResults = await this.faissStore.search(queryEmbedding, maxResults);

    // Retrieve metadata for each result
    const results: Array<{ chunk: ChunkMetadata; distance: number }> = [];

    for (let i = 0; i < searchResults.ids.length; i++) {
      const vectorId = searchResults.ids[i];
      const distance = searchResults.distances[i];
      const metadata = this.metadataStore.getChunkByVectorId(vectorId);

      if (metadata) {
        results.push({ chunk: metadata, distance });
      }
    }

    return results;
  }

  /**
   * Keyword search using SQLite FTS5
   */
  private keywordSearch(
    query: string,
    maxResults: number
  ): Promise<Array<{ chunk: ChunkMetadata; rank: number }>> {
    return new Promise((resolve) => {
      try {
        const results = this.metadataStore.fullTextSearch(query, maxResults);

        // FTS5 returns results in rank order (best first)
        // Assign synthetic rank scores: 1.0 for first result, decreasing linearly
        const rankedResults = results.map((chunk, index) => ({
          chunk,
          rank: 1.0 - (index / results.length),
        }));

        resolve(rankedResults);
      } catch (error) {
        // FTS5 can fail on certain query syntax (e.g., special characters)
        // Return empty results rather than failing the entire search
        resolve([]);
      }
    });
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   *
   * Merges two ranked lists using position-based scoring:
   * score = 1 / (k + rank)
   *
   * Where k=60 is a constant that reduces impact of high rankings
   * (standard value from research literature)
   */
  private applyRRF(
    semanticResults: Array<{ chunk: ChunkMetadata; distance: number }>,
    keywordResults: Array<{ chunk: ChunkMetadata; rank: number }>,
    semanticWeight: number,
    keywordWeight: number
  ): SearchResult[] {
    const k = 60; // RRF constant
    const scoreMap = new Map<string, SearchResult>();

    // Process semantic results
    semanticResults.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1); // +1 because rank is 1-indexed
      const similarity = 1 / (1 + result.distance); // Convert distance to similarity

      scoreMap.set(result.chunk.id, {
        chunk: result.chunk,
        score: rrfScore * semanticWeight,
        semanticScore: similarity,
        keywordScore: 0,
        matchType: 'semantic',
      });
    });

    // Process keyword results and merge
    keywordResults.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1);
      const existing = scoreMap.get(result.chunk.id);

      if (existing) {
        // Chunk appears in both searches - boost it
        existing.score += rrfScore * keywordWeight;
        existing.keywordScore = result.rank;
        existing.matchType = 'hybrid';
      } else {
        // Keyword-only result
        scoreMap.set(result.chunk.id, {
          chunk: result.chunk,
          score: rrfScore * keywordWeight,
          semanticScore: 0,
          keywordScore: result.rank,
          matchType: 'keyword',
        });
      }
    });

    // Sort by final score (highest first)
    return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Find related code by analyzing a specific file or chunk
   */
  async findRelatedCode(
    filePath: string,
    maxResults: number = 5
  ): Promise<SearchResult[]> {
    // Get all chunks from the target file
    const targetChunks = this.metadataStore.getChunksByFile(filePath);

    if (targetChunks.length === 0) {
      return [];
    }

    // Use the first chunk's text as the search query
    // (Could be enhanced to combine multiple chunks)
    const queryText = targetChunks[0].chunkText;

    // Search for similar code, excluding the source file
    const results = await this.search(queryText, { maxResults: maxResults * 2 });

    // Filter out chunks from the same file
    return results
      .filter((r) => r.chunk.filePath !== filePath)
      .slice(0, maxResults);
  }

  /**
   * Search debug logs for error patterns
   */
  async searchDebugLogs(
    errorPattern: string,
    maxResults: number = 10
  ): Promise<SearchResult[]> {
    const results = await this.search(errorPattern, {
      maxResults,
      semanticWeight: 0.8, // Favor semantic matching for error descriptions
      keywordWeight: 0.2,
    });

    // Filter to only debug log chunks
    return results.filter((r) => r.chunk.isDebugLog);
  }

  /**
   * Find all TODOs, optionally filtered by domain
   */
  getTodos(domain?: string): ChunkMetadata[] {
    return this.metadataStore.getTodos(domain);
  }

  /**
   * Trace a request flow by finding related endpoints and handlers
   *
   * For example: "user login" → finds frontend login component,
   * API auth route, JWT generation, database queries, etc.
   */
  async traceRequestFlow(
    flowDescription: string,
    maxResults: number = 10
  ): Promise<{
    frontend: SearchResult[];
    backend: SearchResult[];
    database: SearchResult[];
  }> {
    // Search each domain separately for better organization
    const [frontend, backend, database] = await Promise.all([
      this.search(flowDescription, {
        domain: 'typescript-frontend',
        maxResults: Math.ceil(maxResults / 3),
      }),
      this.search(flowDescription, {
        domain: 'rust-auth', // Could be generalized
        maxResults: Math.ceil(maxResults / 3),
      }),
      this.search(flowDescription, {
        domain: 'database',
        maxResults: Math.ceil(maxResults / 3),
      }),
    ]);

    return { frontend, backend, database };
  }
}
