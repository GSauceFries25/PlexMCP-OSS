/**
 * Markdown Chunker
 * Chunks markdown files by headers (H2, H3)
 */

import { BaseChunker, CodeChunk } from './base-chunker.js';

export class MarkdownChunker extends BaseChunker {
  constructor() {
    super(600, 0); // Larger chunks for docs, no context lines
  }

  chunkFile(content: string, filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = this.getLines(content);

    // Match markdown headers
    const headerPattern = /^(#{1,3})\s+(.+)$/;

    let currentChunk: { startLine: number; lines: string[]; header?: string; level?: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(headerPattern);

      if (headerMatch) {
        const level = headerMatch[1].length;
        const headerText = headerMatch[2];

        // Only split on H2 and H3 headers
        if (level <= 3) {
          if (currentChunk && currentChunk.lines.length > 0) {
            chunks.push(this.createChunk(currentChunk, lines));
          }

          currentChunk = {
            startLine: i,
            lines: [line],
            header: headerText,
            level,
          };
        } else if (currentChunk) {
          currentChunk.lines.push(line);
        }
      } else if (currentChunk) {
        currentChunk.lines.push(line);

        // Check token limit
        if (this.estimateTokens(currentChunk.lines.join('\n')) > this.maxTokens) {
          chunks.push(this.createChunk(currentChunk, lines));
          currentChunk = null;
        }
      } else {
        // No current chunk yet, start one
        currentChunk = {
          startLine: i,
          lines: [line],
        };
      }
    }

    // Add final chunk
    if (currentChunk && currentChunk.lines.length > 0) {
      chunks.push(this.createChunk(currentChunk, lines));
    }

    return chunks;
  }

  private createChunk(
    chunk: { startLine: number; lines: string[]; header?: string; level?: number },
    allLines: string[]
  ): CodeChunk {
    const endLine = chunk.startLine + chunk.lines.length - 1;
    const text = chunk.lines.join('\n');

    // For DEBUG_LOG.md, check for "Attempt" patterns
    const isDebugLog = text.includes('Attempt ') || text.includes('### Attempt');

    return {
      text,
      startLine: chunk.startLine,
      endLine,
      symbolName: chunk.header,
      symbolType: 'section',
      tags: this.extractTags(text),
      isTodo: this.detectTodo(text) || isDebugLog,
    };
  }
}
