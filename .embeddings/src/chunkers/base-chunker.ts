/**
 * Base Chunker Interface
 * All language-specific chunkers implement this interface
 */

export interface CodeChunk {
  text: string;
  startLine: number;
  endLine: number;
  symbolName?: string;
  symbolType?: string;
  tags: string[];
  isTodo: boolean;
}

export abstract class BaseChunker {
  protected maxTokens: number;
  protected contextLines: number;

  constructor(maxTokens: number = 500, contextLines: number = 2) {
    this.maxTokens = maxTokens;
    this.contextLines = contextLines;
  }

  /**
   * Chunk a file into semantic chunks
   */
  abstract chunkFile(content: string, filePath: string): CodeChunk[];

  /**
   * Approximate token count (rough estimate: 1 token ≈ 4 characters)
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Extract TODO/FIXME markers
   */
  protected detectTodo(text: string): boolean {
    return /TODO|FIXME|XXX|HACK|NOTE:/i.test(text);
  }

  /**
   * Extract tags from comments
   */
  protected extractTags(text: string): string[] {
    const tags: string[] = [];

    // Common keywords to extract
    const keywords = [
      'async', 'webhook', 'stripe', 'auth', 'billing', 'api', 'database',
      'error', 'validation', 'middleware', 'handler', 'route', 'mcp',
      'proxy', 'oauth', '2fa', 'totp', 'subscription', 'invoice'
    ];

    for (const keyword of keywords) {
      if (text.toLowerCase().includes(keyword)) {
        tags.push(keyword);
      }
    }

    return Array.from(new Set(tags)); // Remove duplicates
  }

  /**
   * Get lines from content with line numbers
   */
  protected getLines(content: string): string[] {
    return content.split('\n');
  }

  /**
   * Extract a chunk with context lines
   */
  protected extractWithContext(
    lines: string[],
    startLine: number,
    endLine: number
  ): { text: string; startLine: number; endLine: number } {
    const contextStart = Math.max(0, startLine - this.contextLines);
    const contextEnd = Math.min(lines.length - 1, endLine + this.contextLines);

    const chunkLines = lines.slice(contextStart, contextEnd + 1);
    const text = chunkLines.join('\n');

    return {
      text,
      startLine: contextStart,
      endLine: contextEnd,
    };
  }
}
