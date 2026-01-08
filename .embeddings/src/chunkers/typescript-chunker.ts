/**
 * TypeScript/React Chunker
 * Chunks TypeScript and React files by function/component definitions
 */

import { BaseChunker, CodeChunk } from './base-chunker.js';

export class TypeScriptChunker extends BaseChunker {
  chunkFile(content: string, filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = this.getLines(content);

    // Match functions, arrow functions, React components
    const functionPattern = /^(\s*)(export\s+)?(async\s+)?function\s+(\w+)/;
    const arrowFunctionPattern = /^(\s*)(export\s+)?const\s+(\w+)\s*=\s*(\([^)]*\)|[\w]+)\s*=>/;
    const reactComponentPattern = /^(\s*)(export\s+)?(?:function|const)\s+(\w+).*(?:React\.FC|JSX\.Element)/;

    let currentChunk: { startLine: number; lines: string[]; symbol?: string; type?: string } | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const functionMatch = line.match(functionPattern);
      const arrowMatch = line.match(arrowFunctionPattern);
      const componentMatch = line.match(reactComponentPattern);

      // Count braces to track scope
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Start new chunk on function declaration
      if (functionMatch || arrowMatch || componentMatch) {
        if (currentChunk && currentChunk.lines.length > 0) {
          chunks.push(this.createChunk(currentChunk, lines));
        }

        const symbolName = functionMatch?.[4] || arrowMatch?.[3] || componentMatch?.[3];
        const type = componentMatch ? 'component' : 'function';

        currentChunk = {
          startLine: i,
          lines: [line],
          symbol: symbolName,
          type,
        };
        braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      }
      // Continue current chunk
      else if (currentChunk) {
        currentChunk.lines.push(line);

        // End chunk when braces balance out
        if (braceDepth === 0 && currentChunk.lines.length > 5) {
          chunks.push(this.createChunk(currentChunk, lines));
          currentChunk = null;
        }
        // Or if max tokens reached
        else if (this.estimateTokens(currentChunk.lines.join('\n')) > this.maxTokens) {
          chunks.push(this.createChunk(currentChunk, lines));
          currentChunk = null;
          braceDepth = 0;
        }
      }
    }

    // Add final chunk
    if (currentChunk && currentChunk.lines.length > 0) {
      chunks.push(this.createChunk(currentChunk, lines));
    }

    // Fallback for files with no recognizable functions
    if (chunks.length === 0) {
      const text = content.substring(0, this.maxTokens * 4);
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
