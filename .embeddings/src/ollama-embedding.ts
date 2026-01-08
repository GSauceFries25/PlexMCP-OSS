/**
 * Ollama Embedding Client
 * Handles embedding generation using the local Ollama server with nomic-embed-text model
 */

import { Ollama } from 'ollama';

export interface EmbeddingConfig {
  model: string;
  baseUrl?: string;
}

export class OllamaEmbedding {
  private ollama: Ollama;
  private model: string;

  constructor(config: EmbeddingConfig = { model: 'nomic-embed-text' }) {
    this.model = config.model;
    this.ollama = new Ollama({
      host: config.baseUrl || 'http://localhost:11434',
    });
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.ollama.embeddings({
        model: this.model,
        prompt: text,
      });
      return response.embedding;
    } catch (error) {
      console.error(`Failed to generate embedding:`, error);
      throw new Error(`Embedding generation failed: ${error}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (const text of texts) {
      const embedding = await this.embed(text);
      embeddings.push(embedding);
    }

    return embeddings;
  }

  /**
   * Get the dimension of embeddings from this model
   */
  async getDimension(): Promise<number> {
    // Test with a small string to get dimension
    const testEmbedding = await this.embed('test');
    return testEmbedding.length;
  }

  /**
   * Check if Ollama server is reachable
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.ollama.list();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify the embedding model is available
   */
  async verifyModel(): Promise<boolean> {
    try {
      const models = await this.ollama.list();
      return models.models.some((m) => m.name.includes(this.model));
    } catch {
      return false;
    }
  }
}
