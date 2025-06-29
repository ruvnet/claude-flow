import { getDatabase } from '../database';
import Database from 'better-sqlite3';

/**
 * Prepared statement manager for common queries
 * Caches prepared statements for performance
 */
export class PreparedStatements {
  private statements = new Map<string, Database.Statement>();

  constructor() {}

  /**
   * Get or create a prepared statement
   */
  async getStatement(key: string, sql: string): Promise<Database.Statement> {
    if (this.statements.has(key)) {
      return this.statements.get(key)!;
    }

    const db = getDatabase();
    const stmt = await db.withConnection(conn => conn.prepare(sql));
    this.statements.set(key, stmt);
    return stmt;
  }

  /**
   * Execute a prepared statement with parameters
   */
  async execute<T = any>(
    key: string,
    sql: string,
    params: any[],
    type: 'all' | 'get' | 'run' = 'all'
  ): Promise<T> {
    const db = getDatabase();
    return db.withConnection(conn => {
      const stmt = conn.prepare(sql);
      
      switch (type) {
        case 'get':
          return stmt.get(...params) as T;
        case 'run':
          return stmt.run(...params) as T;
        case 'all':
        default:
          return stmt.all(...params) as T;
      }
    });
  }

  /**
   * Clear all cached statements
   */
  clear(): void {
    this.statements.clear();
  }
}

// Common prepared statements
export const CommonQueries = {
  // Agent queries
  FIND_IDLE_AGENTS: `
    SELECT a.*, m.* FROM agents a
    LEFT JOIN agent_metrics m ON a.id = m.agent_id
    WHERE a.status = 'idle'
    ORDER BY a.priority DESC, m.tasks_completed DESC
    LIMIT ?
  `,

  UPDATE_AGENT_STATUS: `
    UPDATE agents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `,

  // Task queries
  FIND_READY_TASKS: `
    SELECT t.* FROM tasks t
    WHERE t.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM json_each(t.dependencies) d
      JOIN tasks dep ON dep.id = d.value
      WHERE dep.status != 'completed'
    )
    ORDER BY t.priority DESC, t.created_at ASC
    LIMIT ?
  `,

  ASSIGN_TASK: `
    UPDATE tasks 
    SET assigned_agent = ?, status = 'assigned', started_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `,

  // Memory queries
  SEARCH_MEMORY_BY_TAGS: `
    SELECT * FROM swarm_memory_entries
    WHERE json_extract(tags, '$') LIKE ?
    ORDER BY timestamp DESC
    LIMIT ?
  `,

  MEMORY_FULL_TEXT_SEARCH: `
    SELECT m.* FROM swarm_memory_entries m
    JOIN memory_fts f ON m.id = f.entry_id
    WHERE memory_fts MATCH ?
    ORDER BY rank, m.timestamp DESC
    LIMIT ?
  `,

  // Message queries
  FIND_UNDELIVERED_MESSAGES: `
    SELECT m.* FROM messages m
    WHERE json_extract(m.receivers, '$') LIKE ?
    AND NOT EXISTS (
      SELECT 1 FROM message_acknowledgments a
      WHERE a.message_id = m.id AND a.agent_id = ?
    )
    ORDER BY m.priority DESC, m.created_at ASC
    LIMIT ?
  `,

  // Performance queries
  AGENT_PERFORMANCE_STATS: `
    SELECT 
      a.type,
      COUNT(DISTINCT a.id) as agent_count,
      SUM(m.tasks_completed) as total_completed,
      SUM(m.tasks_failed) as total_failed,
      AVG(CASE 
        WHEN m.tasks_completed > 0 
        THEN m.total_duration_ms / m.tasks_completed 
        ELSE 0 
      END) as avg_task_duration
    FROM agents a
    LEFT JOIN agent_metrics m ON a.id = m.agent_id
    GROUP BY a.type
  `,

  TASK_COMPLETION_RATES: `
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
      AVG(CASE 
        WHEN completed_at IS NOT NULL AND started_at IS NOT NULL 
        THEN (julianday(completed_at) - julianday(started_at)) * 86400
        ELSE NULL
      END) as avg_completion_seconds
    FROM tasks
    WHERE created_at >= ?
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `,

  // Health check queries
  DATABASE_HEALTH: `
    SELECT 
      (SELECT COUNT(*) FROM agents WHERE status = 'active') as active_agents,
      (SELECT COUNT(*) FROM tasks WHERE status IN ('pending', 'in_progress')) as active_tasks,
      (SELECT COUNT(*) FROM swarm_memory_entries WHERE timestamp > datetime('now', '-1 hour')) as recent_memories,
      (SELECT COUNT(*) FROM messages WHERE created_at > datetime('now', '-5 minutes')) as recent_messages,
      (SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()) as db_size_bytes,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table') as table_count,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index') as index_count
  `
};

// Query builder utilities
export class QueryBuilder {
  private conditions: string[] = [];
  private parameters: any[] = [];
  private orderBy: string[] = [];
  private limitValue?: number;
  private offsetValue?: number;

  constructor(private baseQuery: string) {}

  where(condition: string, ...params: any[]): this {
    this.conditions.push(condition);
    this.parameters.push(...params);
    return this;
  }

  whereIn(column: string, values: any[]): this {
    if (values.length === 0) return this;
    
    const placeholders = values.map(() => '?').join(', ');
    this.conditions.push(`${column} IN (${placeholders})`);
    this.parameters.push(...values);
    return this;
  }

  whereJson(column: string, path: string, value: any): this {
    this.conditions.push(`json_extract(${column}, ?) = ?`);
    this.parameters.push(path, value);
    return this;
  }

  whereJsonContains(column: string, value: string): this {
    this.conditions.push(`json_extract(${column}, '$') LIKE ?`);
    this.parameters.push(`%"${value}"%`);
    return this;
  }

  orderByAsc(column: string): this {
    this.orderBy.push(`${column} ASC`);
    return this;
  }

  orderByDesc(column: string): this {
    this.orderBy.push(`${column} DESC`);
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }

  build(): { sql: string; params: any[] } {
    let sql = this.baseQuery;

    if (this.conditions.length > 0) {
      sql += ' WHERE ' + this.conditions.join(' AND ');
    }

    if (this.orderBy.length > 0) {
      sql += ' ORDER BY ' + this.orderBy.join(', ');
    }

    if (this.limitValue !== undefined) {
      sql += ' LIMIT ?';
      this.parameters.push(this.limitValue);
    }

    if (this.offsetValue !== undefined) {
      sql += ' OFFSET ?';
      this.parameters.push(this.offsetValue);
    }

    return { sql, params: this.parameters };
  }

  async execute<T = any>(): Promise<T[]> {
    const { sql, params } = this.build();
    const db = getDatabase();
    return db.withConnection(conn => {
      const stmt = conn.prepare(sql);
      return stmt.all(...params) as T[];
    });
  }

  async executeOne<T = any>(): Promise<T | undefined> {
    const { sql, params } = this.build();
    const db = getDatabase();
    return db.withConnection(conn => {
      const stmt = conn.prepare(sql);
      return stmt.get(...params) as T | undefined;
    });
  }
}

// Transaction utilities
export class TransactionBuilder {
  private operations: Array<{ sql: string; params: any[] }> = [];

  add(sql: string, params: any[] = []): this {
    this.operations.push({ sql, params });
    return this;
  }

  async execute(): Promise<void> {
    const db = getDatabase();
    await db.withTransaction(conn => {
      for (const { sql, params } of this.operations) {
        const stmt = conn.prepare(sql);
        stmt.run(...params);
      }
    });
  }
}

// Batch operations
export class BatchOperations {
  static async insertMany<T extends Record<string, any>>(
    table: string,
    records: T[]
  ): Promise<number> {
    if (records.length === 0) return 0;

    const firstRecord = records[0];
    if (!firstRecord) return 0;
    
    const columns = Object.keys(firstRecord);
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

    const db = getDatabase();
    return db.withTransaction(conn => {
      const stmt = conn.prepare(sql);
      let inserted = 0;

      for (const record of records) {
        const values = columns.map(col => {
          const value = record[col];
          return typeof value === 'object' ? JSON.stringify(value) : value;
        });
        const result = stmt.run(...values);
        if (result.changes > 0) inserted++;
      }

      return inserted;
    });
  }

  static async updateMany<T extends Record<string, any>>(
    table: string,
    updates: Array<{ id: string; data: Partial<T> }>
  ): Promise<number> {
    if (updates.length === 0) return 0;

    const db = getDatabase();
    return db.withTransaction(conn => {
      let updated = 0;

      for (const { id, data } of updates) {
        const fields: string[] = [];
        const values: any[] = [];

        for (const [key, value] of Object.entries(data)) {
          fields.push(`${key} = ?`);
          values.push(typeof value === 'object' ? JSON.stringify(value) : value);
        }

        if (fields.length === 0) continue;

        values.push(id);
        const sql = `UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`;
        const stmt = conn.prepare(sql);
        const result = stmt.run(...values);
        if (result.changes > 0) updated++;
      }

      return updated;
    });
  }

  static async deleteMany(
    table: string,
    ids: string[]
  ): Promise<number> {
    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => '?').join(', ');
    const sql = `DELETE FROM ${table} WHERE id IN (${placeholders})`;

    const db = getDatabase();
    return db.withConnection(conn => {
      const stmt = conn.prepare(sql);
      const result = stmt.run(...ids);
      return result.changes;
    });
  }
}

// Export singleton instance
export const preparedStatements = new PreparedStatements();