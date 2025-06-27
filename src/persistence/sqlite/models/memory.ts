import { execute, query, queryOne, getDatabase } from '../database';

export interface SwarmMemoryEntry {
  id: string;
  agentId: string;
  type: 'knowledge' | 'result' | 'state' | 'communication' | 'error';
  content: string | Record<string, any>; // JSON or text
  timestamp: Date;
  taskId?: string;
  objectiveId?: string;
  tags: string[]; // Stored as JSON
  priority: number;
  shareLevel: 'private' | 'team' | 'public';
}

export interface MemorySearchOptions {
  agentId?: string;
  type?: SwarmMemoryEntry['type'];
  tags?: string[];
  shareLevel?: SwarmMemoryEntry['shareLevel'];
  after?: Date;
  before?: Date;
  limit?: number;
  offset?: number;
  searchText?: string;
}

export class MemoryModel {
  private static readonly TABLE_NAME = 'swarm_memory_entries';
  private static readonly FTS_TABLE = 'memory_fts';

  static async create(entry: Omit<SwarmMemoryEntry, 'timestamp'>): Promise<string> {
    await execute(
      `INSERT INTO ${this.TABLE_NAME} 
       (id, agent_id, type, content, task_id, objective_id, tags, priority, share_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.agentId,
        entry.type,
        typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content),
        entry.taskId,
        entry.objectiveId,
        JSON.stringify(entry.tags),
        entry.priority,
        entry.shareLevel
      ]
    );

    return entry.id;
  }

  static async findById(id: string): Promise<SwarmMemoryEntry | undefined> {
    const result = await queryOne<any>(
      `SELECT * FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );

    if (!result) return undefined;
    return this.mapToMemoryEntry(result);
  }

  static async findByAgent(agentId: string, limit: number = 100): Promise<SwarmMemoryEntry[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE agent_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [agentId, limit]
    );

    return results.map(this.mapToMemoryEntry);
  }

  static async search(options: MemorySearchOptions): Promise<SwarmMemoryEntry[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.agentId) {
      conditions.push('agent_id = ?');
      params.push(options.agentId);
    }

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.shareLevel) {
      conditions.push('share_level = ?');
      params.push(options.shareLevel);
    }

    if (options.after) {
      conditions.push('timestamp > ?');
      params.push(options.after.toISOString());
    }

    if (options.before) {
      conditions.push('timestamp < ?');
      params.push(options.before.toISOString());
    }

    if (options.tags && options.tags.length > 0) {
      // Search for entries containing any of the specified tags
      const tagConditions = options.tags.map(() => "json_extract(tags, '$') LIKE ?").join(' OR ');
      conditions.push(`(${tagConditions})`);
      options.tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    let queryText = `SELECT * FROM ${this.TABLE_NAME}`;
    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ' ORDER BY timestamp DESC';

    if (options.limit) {
      queryText += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      queryText += ' OFFSET ?';
      params.push(options.offset);
    }

    const results = await query<any>(queryText, params);
    return results.map(this.mapToMemoryEntry);
  }

  static async searchFullText(searchText: string, options: MemorySearchOptions = {}): Promise<SwarmMemoryEntry[]> {
    let baseQuery = `
      SELECT m.* FROM ${this.TABLE_NAME} m
      JOIN ${this.FTS_TABLE} f ON m.id = f.entry_id
      WHERE ${this.FTS_TABLE} MATCH ?
    `;

    const conditions: string[] = [];
    const params: any[] = [searchText];

    if (options.agentId) {
      conditions.push('m.agent_id = ?');
      params.push(options.agentId);
    }

    if (options.type) {
      conditions.push('m.type = ?');
      params.push(options.type);
    }

    if (options.shareLevel) {
      conditions.push('m.share_level = ?');
      params.push(options.shareLevel);
    }

    if (conditions.length > 0) {
      baseQuery += ' AND ' + conditions.join(' AND ');
    }

    baseQuery += ' ORDER BY rank, m.timestamp DESC';

    if (options.limit) {
      baseQuery += ' LIMIT ?';
      params.push(options.limit);
    }

    const results = await query<any>(baseQuery, params);
    return results.map(this.mapToMemoryEntry);
  }

  static async findRelated(entryId: string, limit: number = 10): Promise<SwarmMemoryEntry[]> {
    const entry = await this.findById(entryId);
    if (!entry) return [];

    // Find entries with similar tags or from the same task/objective
    const results = await query<any>(
      `SELECT DISTINCT m.* FROM ${this.TABLE_NAME} m
       WHERE m.id != ?
       AND (
         m.task_id = ? OR 
         m.objective_id = ? OR
         EXISTS (
           SELECT 1 FROM json_each(m.tags) mt
           JOIN json_each(?) et ON mt.value = et.value
         )
       )
       ORDER BY 
         CASE WHEN m.task_id = ? THEN 0 ELSE 1 END,
         CASE WHEN m.objective_id = ? THEN 0 ELSE 1 END,
         m.timestamp DESC
       LIMIT ?`,
      [
        entryId,
        entry.taskId,
        entry.objectiveId,
        JSON.stringify(entry.tags),
        entry.taskId,
        entry.objectiveId,
        limit
      ]
    );

    return results.map(this.mapToMemoryEntry);
  }

  static async update(id: string, updates: Partial<SwarmMemoryEntry>): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(
        typeof updates.content === 'string' 
          ? updates.content 
          : JSON.stringify(updates.content)
      );
    }

    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }

    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }

    if (updates.shareLevel !== undefined) {
      fields.push('share_level = ?');
      values.push(updates.shareLevel);
    }

    if (fields.length === 0) return false;

    values.push(id);
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return result.changes > 0;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  static async deleteByAgent(agentId: string): Promise<number> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE agent_id = ?`,
      [agentId]
    );
    return result.changes;
  }

  static async getMemoryStats(): Promise<{
    totalEntries: number;
    entriesByType: Record<SwarmMemoryEntry['type'], number>;
    entriesByShareLevel: Record<SwarmMemoryEntry['shareLevel'], number>;
    recentActivity: number;
  }> {
    const db = getDatabase();
    return db.withConnection(async (conn) => {
      const totalStmt = conn.prepare(
        `SELECT COUNT(*) as count FROM ${this.TABLE_NAME}`
      );
      const total = totalStmt.get() as any;

      const typeStmt = conn.prepare(
        `SELECT type, COUNT(*) as count FROM ${this.TABLE_NAME} GROUP BY type`
      );
      const typeResults = typeStmt.all() as any[];

      const shareLevelStmt = conn.prepare(
        `SELECT share_level, COUNT(*) as count FROM ${this.TABLE_NAME} GROUP BY share_level`
      );
      const shareLevelResults = shareLevelStmt.all() as any[];

      const recentStmt = conn.prepare(
        `SELECT COUNT(*) as count FROM ${this.TABLE_NAME} 
         WHERE timestamp > datetime('now', '-1 hour')`
      );
      const recent = recentStmt.get() as any;

      const entriesByType: Record<SwarmMemoryEntry['type'], number> = {
        knowledge: 0,
        result: 0,
        state: 0,
        communication: 0,
        error: 0
      };

      typeResults.forEach(row => {
        entriesByType[row.type as SwarmMemoryEntry['type']] = row.count;
      });

      const entriesByShareLevel: Record<SwarmMemoryEntry['shareLevel'], number> = {
        private: 0,
        team: 0,
        public: 0
      };

      shareLevelResults.forEach(row => {
        entriesByShareLevel[row.share_level as SwarmMemoryEntry['shareLevel']] = row.count;
      });

      return {
        totalEntries: total.count,
        entriesByType,
        entriesByShareLevel,
        recentActivity: recent.count
      };
    });
  }

  static async cleanupOldEntries(daysToKeep: number = 90): Promise<number> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME}
       WHERE timestamp < datetime('now', '-' || ? || ' days')`,
      [daysToKeep]
    );

    return result.changes;
  }

  private static mapToMemoryEntry(row: any): SwarmMemoryEntry {
    let content: string | Record<string, any>;
    try {
      content = JSON.parse(row.content);
    } catch {
      content = row.content;
    }

    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type,
      content,
      timestamp: new Date(row.timestamp),
      taskId: row.task_id,
      objectiveId: row.objective_id,
      tags: JSON.parse(row.tags || '[]'),
      priority: row.priority,
      shareLevel: row.share_level
    };
  }
}