/**
 * Rust Code Chunker
 * Chunks Rust files by function, impl block, and struct definitions
 */

import { BaseChunker, CodeChunk } from './base-chunker.js';

export class RustChunker extends BaseChunker {
  chunkFile(content: string, filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = this.getLines(content);

    // Match Rust functions: pub fn, async fn, fn
    const functionPattern = /^(\s*)(pub\s+)?(async\s+)?fn\s+(\w+)/;
    // Match impl blocks: impl, impl<T>
    const implPattern = /^(\s*)impl(<[^>]+>)?\s+(\w+)/;
    // Match struct definitions
    const structPattern = /^(\s*)(pub\s+)?struct\s+(\w+)/;

    let currentChunk: { startLine: number; lines: string[]; symbol?: string; type?: string } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const functionMatch = line.match(functionPattern);
      const implMatch = line.match(implPattern);
      const structMatch = line.match(structPattern);

      // Start of a new function
      if (functionMatch) {
        if (currentChunk && currentChunk.lines.length > 0) {
          chunks.push(this.createChunk(currentChunk, lines));
        }

        currentChunk = {
          startLine: i,
          lines: [line],
          symbol: functionMatch[4],
          type: 'function',
        };
      }
      // Start of an impl block
      else if (implMatch) {
        if (currentChunk && currentChunk.lines.length > 0) {
          chunks.push(this.createChunk(currentChunk, lines));
        }

        currentChunk = {
          startLine: i,
          lines: [line],
          symbol: implMatch[3],
          type: 'impl',
        };
      }
      // Start of a struct
      else if (structMatch) {
        if (currentChunk && currentChunk.lines.length > 0) {
          chunks.push(this.createChunk(currentChunk, lines));
        }

        currentChunk = {
          startLine: i,
          lines: [line],
          symbol: structMatch[3],
          type: 'struct',
        };
      }
      // Continue current chunk
      else if (currentChunk) {
        currentChunk.lines.push(line);

        // Check if we've reached max tokens
        const currentText = currentChunk.lines.join('\n');
        if (this.estimateTokens(currentText) > this.maxTokens) {
          chunks.push(this.createChunk(currentChunk, lines));
          currentChunk = null;
        }
      }
    }

    // Add final chunk
    if (currentChunk && currentChunk.lines.length > 0) {
      chunks.push(this.createChunk(currentChunk, lines));
    }

    // If no chunks were created (no functions found), create one chunk for the whole file
    if (chunks.length === 0) {
      const text = content.substring(0, this.maxTokens * 4); // Rough token limit
      chunks.push({
        text,
        startLine: 0,
        endLine: Math.min(lines.length - 1, 100),
        symbolName: undefined,
        symbolType: 'file',
        tags: this.extractTags(text),
        isTodo: this.detectTodo(text),
      });
    }

    return chunks;
  }

  private createChunk(
    chunk: { startLine: number; lines: string[]; symbol?: string; type?: string },
    allLines: string[]
  ): CodeChunk {
    const endLine = chunk.startLine + chunk.lines.length - 1;
    const withContext = this.extractWithContext(allLines, chunk.startLine, endLine);

    return {
      text: withContext.text,
      startLine: withContext.startLine,
      endLine: withContext.endLine,
      symbolName: chunk.symbol,
      symbolType: chunk.type,
      tags: this.extractTags(withContext.text),
      isTodo: this.detectTodo(withContext.text),
    };
  }
}
