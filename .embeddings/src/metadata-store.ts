/**
 * SQLite Metadata Store
 * Stores chunk metadata, file paths, line numbers, tags, and supports full-text search
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface ChunkMetadata {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  domain: string;
  fileType: string;
  symbolName?: string;
  symbolType?: string;
  tags: string[];
  isTodo: boolean;
  isDebugLog: boolean;
  chunkText: string;
  lastModified: string;
  vectorId: number; // Index in FAISS
}

export class MetadataStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Main chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        domain TEXT NOT NULL,
        file_type TEXT NOT NULL,
        symbol_name TEXT,
        symbol_type TEXT,
        tags TEXT,
        is_todo INTEGER DEFAULT 0,
        is_debug_log INTEGER DEFAULT 0,
        chunk_text TEXT NOT NULL,
        last_modified TEXT NOT NULL,
        vector_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_file_path ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_domain ON chunks(domain);
      CREATE INDEX IF NOT EXISTS idx_file_type ON chunks(file_type);
      CREATE INDEX IF NOT EXISTS idx_vector_id ON chunks(vector_id);
      CREATE INDEX IF NOT EXISTS idx_is_todo ON chunks(is_todo);
      CREATE INDEX IF NOT EXISTS idx_is_debug_log ON chunks(is_debug_log);

      -- Full-text search table
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        file_path,
        symbol_name,
        tags,
        chunk_text,
        content='chunks',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, file_path, symbol_name, tags, chunk_text)
        VALUES (new.rowid, new.file_path, new.symbol_name, new.tags, new.chunk_text);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        DELETE FROM chunks_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        DELETE FROM chunks_fts WHERE rowid = old.rowid;
        INSERT INTO chunks_fts(rowid, file_path, symbol_name, tags, chunk_text)
        VALUES (new.rowid, new.file_path, new.symbol_name, new.tags, new.chunk_text);
      END;
    `);
  }

  /**
   * Insert a chunk into the metadata store
   */
  insertChunk(chunk: ChunkMetadata): void {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (
        id, file_path, start_line, end_line, domain, file_type,
        symbol_name, symbol_type, tags, is_todo, is_debug_log,
        chunk_text, last_modified, vector_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      chunk.id,
      chunk.filePath,
      chunk.startLine,
      chunk.endLine,
      chunk.domain,
      chunk.fileType,
      chunk.symbolName || null,
      chunk.symbolType || null,
      JSON.stringify(chunk.tags),
      chunk.isTodo ? 1 : 0,
      chunk.isDebugLog ? 1 : 0,
      chunk.chunkText,
      chunk.lastModified,
      chunk.vectorId
    );
  }

  /**
   * Insert multiple chunks (batch insert)
   */
  insertChunksBatch(chunks: ChunkMetadata[]): void {
    const insert = this.db.transaction((chunks: ChunkMetadata[]) => {
      for (const chunk of chunks) {
        this.insertChunk(chunk);
      }
    });

    insert(chunks);
  }

  /**
   * Get chunk by ID
   */
  getChunkById(id: string): ChunkMetadata | null {
    const stmt = this.db.prepare('SELECT * FROM chunks WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.rowToChunkMetadata(row);
  }

  /**
   * Get chunk by vector ID
   */
  getChunkByVectorId(vectorId: number): ChunkMetadata | null {
    const stmt = this.db.prepare('SELECT * FROM chunks WHERE vector_id = ?');
    const row = stmt.get(vectorId) as any;

    if (!row) return null;

    return this.rowToChunkMetadata(row);
  }

  /**
   * Get all chunks for a file
   */
  getChunksByFile(filePath: string): ChunkMetadata[] {
    const stmt = this.db.prepare('SELECT * FROM chunks WHERE file_path = ? ORDER BY start_line');
    const rows = stmt.all(filePath) as any[];

    return rows.map((row) => this.rowToChunkMetadata(row));
  }

  /**
   * Delete all chunks for a file
   */
  deleteChunksByFile(filePath: string): void {
    const stmt = this.db.prepare('DELETE FROM chunks WHERE file_path = ?');
    stmt.run(filePath);
  }

  /**
   * Full-text search across chunks
   */
  fullTextSearch(query: string, limit: number = 20): ChunkMetadata[] {
    const stmt = this.db.prepare(`
      SELECT c.* FROM chunks c
      JOIN chunks_fts fts ON c.rowid = fts.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(query, limit) as any[];
    return rows.map((row) => this.rowToChunkMetadata(row));
  }

  /**
   * Get all TODOs
   */
  getTodos(domain?: string): ChunkMetadata[] {
    let query = 'SELECT * FROM chunks WHERE is_todo = 1';
    const params: any[] = [];

    if (domain) {
      query += ' AND domain = ?';
      params.push(domain);
    }

    query += ' ORDER BY file_path, start_line';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => this.rowToChunkMetadata(row));
  }

  /**
   * Get all debug logs
   */
  getDebugLogs(): ChunkMetadata[] {
    const stmt = this.db.prepare('SELECT * FROM chunks WHERE is_debug_log = 1 ORDER BY file_path, start_line');
    const rows = stmt.all() as any[];

    return rows.map((row) => this.rowToChunkMetadata(row));
  }

  /**
   * Get total number of chunks
   */
  getTotalChunks(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Get chunks by domain
   */
  getChunksByDomain(domain: string): ChunkMetadata[] {
    const stmt = this.db.prepare('SELECT * FROM chunks WHERE domain = ? ORDER BY file_path, start_line');
    const rows = stmt.all(domain) as any[];

    return rows.map((row) => this.rowToChunkMetadata(row));
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalChunks: number;
    byDomain: Record<string, number>;
    byFileType: Record<string, number>;
    totalTodos: number;
    totalDebugLogs: number;
  } {
    const totalChunks = this.getTotalChunks();

    const domainStmt = this.db.prepare('SELECT domain, COUNT(*) as count FROM chunks GROUP BY domain');
    const domainRows = domainStmt.all() as { domain: string; count: number }[];
    const byDomain: Record<string, number> = {};
    for (const row of domainRows) {
      byDomain[row.domain] = row.count;
    }

    const fileTypeStmt = this.db.prepare('SELECT file_type, COUNT(*) as count FROM chunks GROUP BY file_type');
    const fileTypeRows = fileTypeStmt.all() as { file_type: string; count: number }[];
    const byFileType: Record<string, number> = {};
    for (const row of fileTypeRows) {
      byFileType[row.file_type] = row.count;
    }

    const todoStmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks WHERE is_todo = 1');
    const todoResult = todoStmt.get() as { count: number };

    const debugLogStmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks WHERE is_debug_log = 1');
    const debugLogResult = debugLogStmt.get() as { count: number };

    return {
      totalChunks,
      byDomain,
      byFileType,
      totalTodos: todoResult.count,
      totalDebugLogs: debugLogResult.count,
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.db.exec('DELETE FROM chunks');
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  private rowToChunkMetadata(row: any): ChunkMetadata {
    return {
      id: row.id,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      domain: row.domain,
      fileType: row.file_type,
      symbolName: row.symbol_name || undefined,
      symbolType: row.symbol_type || undefined,
      tags: JSON.parse(row.tags || '[]'),
      isTodo: row.is_todo === 1,
      isDebugLog: row.is_debug_log === 1,
      chunkText: row.chunk_text,
      lastModified: row.last_modified,
      vectorId: row.vector_id,
    };
  }
}
