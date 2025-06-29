/**
 * SQLite backend implementation for memory storage
 */

import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { IMemoryBackend } from './base.js';
import { MemoryEntry, MemoryQuery } from '../../utils/types.js';
import { ILogger } from '../../core/logger.js';
import { MemoryBackendError } from '../../utils/errors.js';

/**
 * SQLite-based memory backend
 */
export class SQLiteBackend implements IMemoryBackend {
  private db?: Database.Database;

  constructor(
    private dbPath: string,
    private logger: ILogger,
  ) {}

  async initialize(): Promise<void> {
    this.logger.info('Initializing SQLite backend', { dbPath: this.dbPath });

    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      await fs.mkdir(dir, { recursive: true });

      // Open SQLite connection
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 1000');
      this.db.pragma('temp_store = memory');

      // Create tables
      this.createTables();

      // Create indexes
      this.createIndexes();

      this.logger.info('SQLite backend initialized');
    } catch (error) {
      throw new MemoryBackendError('Failed to initialize SQLite backend', { error });
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down SQLite backend');

    if (this.db) {
      this.db.close();
      delete this.db;
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const sql = `
      INSERT OR REPLACE INTO memory_entries (
        id, agent_id, session_id, type, content, 
        context, timestamp, tags, version, parent_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      entry.id,
      entry.agentId,
      entry.sessionId,
      entry.type,
      entry.content,
      JSON.stringify(entry.context),
      entry.timestamp.toISOString(),
      JSON.stringify(entry.tags),
      entry.version,
      entry.parentId || null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ];

    try {
      const stmt = this.db.prepare(sql);
      stmt.run(...params);
    } catch (error) {
      throw new MemoryBackendError('Failed to store entry', { error });
    }
  }

  async retrieve(id: string): Promise<MemoryEntry | undefined> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const sql = 'SELECT * FROM memory_entries WHERE id = ?';
    
    try {
      const stmt = this.db.prepare(sql);
      const row = stmt.get(id);
      
      if (!row) {
        return undefined;
      }

      return this.rowToEntry(row as Record<string, unknown>);
    } catch (error) {
      throw new MemoryBackendError('Failed to retrieve entry', { error });
    }
  }

  async update(id: string, entry: MemoryEntry): Promise<void> {
    // SQLite INSERT OR REPLACE handles updates
    await this.store(entry);
  }

  async delete(id: string): Promise<void> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const sql = 'DELETE FROM memory_entries WHERE id = ?';
    
    try {
      const stmt = this.db.prepare(sql);
      stmt.run(id);
    } catch (error) {
      throw new MemoryBackendError('Failed to delete entry', { error });
    }
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.agentId) {
      conditions.push('agent_id = ?');
      params.push(query.agentId);
    }

    if (query.sessionId) {
      conditions.push('session_id = ?');
      params.push(query.sessionId);
    }

    if (query.type) {
      conditions.push('type = ?');
      params.push(query.type);
    }

    if (query.startTime) {
      conditions.push('timestamp >= ?');
      params.push(query.startTime.toISOString());
    }

    if (query.endTime) {
      conditions.push('timestamp <= ?');
      params.push(query.endTime.toISOString());
    }

    if (query.search) {
      conditions.push('(content LIKE ? OR tags LIKE ?)');
      params.push(`%${query.search}%`, `%${query.search}%`);
    }

    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map(() => 'tags LIKE ?');
      conditions.push(`(${tagConditions.join(' OR ')})`);
      query.tags.forEach((tag: string) => params.push(`%"${tag}"%`));
    }

    let sql = 'SELECT * FROM memory_entries';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY timestamp DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset) {
      // SQLite requires LIMIT when using OFFSET
      if (!query.limit) {
        sql += ' LIMIT -1';  // -1 means no limit in SQLite
      }
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);
      return rows.map((row: any) => this.rowToEntry(row as Record<string, unknown>));
    } catch (error) {
      throw new MemoryBackendError('Failed to query entries', { error });
    }
  }

  async getAllEntries(): Promise<MemoryEntry[]> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const sql = 'SELECT * FROM memory_entries ORDER BY timestamp DESC';
    
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all();
      return rows.map((row: any) => this.rowToEntry(row as Record<string, unknown>));
    } catch (error) {
      throw new MemoryBackendError('Failed to get all entries', { error });
    }
  }

  async getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }> {
    if (!this.db) {
      return {
        healthy: false,
        error: 'Database not initialized',
      };
    }

    try {
      // Check database connectivity
      this.db.prepare('SELECT 1').get();

      // Get metrics
      const countResult = this.db.prepare('SELECT COUNT(*) as count FROM memory_entries').get() as any;
      const entryCount = countResult.count;

      const sizeResult = this.db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as any;
      const dbSize = sizeResult.size;

      return {
        healthy: true,
        metrics: {
          entryCount,
          dbSizeBytes: dbSize,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private createTables(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        context TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tags TEXT NOT NULL,
        version INTEGER NOT NULL,
        parent_id TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db!.exec(sql);
  }

  private createIndexes(): void {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_agent_id ON memory_entries(agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_session_id ON memory_entries(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_type ON memory_entries(type)',
      'CREATE INDEX IF NOT EXISTS idx_timestamp ON memory_entries(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_parent_id ON memory_entries(parent_id)',
    ];

    for (const sql of indexes) {
      this.db!.exec(sql);
    }
  }

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    const entry: MemoryEntry = {
      id: row['id'] as string,
      agentId: row['agent_id'] as string,
      sessionId: row['session_id'] as string,
      type: row['type'] as MemoryEntry['type'],
      content: row['content'] as string,
      context: JSON.parse(row['context'] as string),
      timestamp: new Date(row['timestamp'] as string),
      tags: JSON.parse(row['tags'] as string),
      version: row['version'] as number,
    };
    
    if (row['parent_id']) {
      entry.parentId = row['parent_id'] as string;
    }
    
    if (row['metadata']) {
      entry.metadata = JSON.parse(row['metadata'] as string);
    }
    
    return entry;
  }
}

