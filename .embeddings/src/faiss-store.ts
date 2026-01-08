/**
 * FAISS Vector Store
 * Handles vector similarity search using FAISS
 */

import faissNode from 'faiss-node';
const { IndexFlatL2 } = faissNode;
import * as fs from 'fs';

export class FaissStore {
  private index: any = null;
  private dimension: number;
  private indexPath: string;
  private vectors: number[][] = [];

  constructor(dimension: number, indexPath: string) {
    this.dimension = dimension;
    this.indexPath = indexPath;
  }

  /**
   * Initialize a new FAISS index
   */
  async initialize(): Promise<void> {
    this.index = new IndexFlatL2(this.dimension);
    this.vectors = [];
  }

  /**
   * Add a single vector to the index
   */
  async addVector(vector: number[]): Promise<number> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}`);
    }

    const vectorId = this.vectors.length;
    this.vectors.push(vector);
    this.index.add(vector);

    return vectorId;
  }

  /**
   * Add multiple vectors to the index (batch)
   */
  async addVectorsBatch(vectors: number[][]): Promise<number[]> {
    const vectorIds: number[] = [];

    for (const vector of vectors) {
      const id = await this.addVector(vector);
      vectorIds.push(id);
    }

    return vectorIds;
  }

  /**
   * Search for k nearest neighbors
   */
  async search(queryVector: number[], k: number = 5): Promise<{ ids: number[]; distances: number[] }> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (queryVector.length !== this.dimension) {
      throw new Error(`Query vector dimension mismatch: expected ${this.dimension}, got ${queryVector.length}`);
    }

    const results = this.index.search(queryVector, k);

    return {
      ids: results.labels,
      distances: results.distances,
    };
  }

  /**
   * Get total number of vectors in the index
   */
  getTotalVectors(): number {
    return this.vectors.length;
  }

  /**
   * Save the index to disk
   */
  async save(): Promise<void> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // Save FAISS index
    this.index.write(this.indexPath);

    // Save vectors array separately
    const vectorsPath = this.indexPath.replace('.faiss', '.vectors.json');
    fs.writeFileSync(vectorsPath, JSON.stringify(this.vectors));
  }

  /**
   * Load the index from disk
   */
  async load(): Promise<void> {
    if (!fs.existsSync(this.indexPath)) {
      throw new Error(`Index file not found: ${this.indexPath}`);
    }

    this.index = IndexFlatL2.read(this.indexPath);

    // Load vectors array
    const vectorsPath = this.indexPath.replace('.faiss', '.vectors.json');
    if (fs.existsSync(vectorsPath)) {
      const vectorsData = fs.readFileSync(vectorsPath, 'utf-8');
      this.vectors = JSON.parse(vectorsData);
    }
  }

  /**
   * Check if index file exists
   */
  exists(): boolean {
    return fs.existsSync(this.indexPath);
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.index = new IndexFlatL2(this.dimension);
    this.vectors = [];
  }
}
