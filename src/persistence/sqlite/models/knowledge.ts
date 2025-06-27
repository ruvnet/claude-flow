import { execute, query, queryOne, getDatabase } from '../database';
import { SwarmMemoryEntry } from './memory';

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  expertise: string[]; // Stored as JSON
  createdAt: Date;
  lastUpdated: Date;
}

export interface KnowledgeBaseEntry {
  kbId: string;
  entryId: string;
}

export interface KnowledgeBaseContributor {
  kbId: string;
  agentId: string;
  contributedAt: Date;
}

export interface KnowledgeBaseWithStats extends KnowledgeBase {
  entryCount: number;
  contributorCount: number;
}

export class KnowledgeModel {
  private static readonly TABLE_NAME = 'knowledge_bases';
  private static readonly ENTRIES_TABLE = 'knowledge_base_entries';
  private static readonly CONTRIBUTORS_TABLE = 'knowledge_base_contributors';

  static async create(kb: Omit<KnowledgeBase, 'createdAt' | 'lastUpdated'>): Promise<string> {
    await execute(
      `INSERT INTO ${this.TABLE_NAME} 
       (id, name, description, domain, expertise)
       VALUES (?, ?, ?, ?, ?)`,
      [
        kb.id,
        kb.name,
        kb.description,
        kb.domain,
        JSON.stringify(kb.expertise)
      ]
    );

    return kb.id;
  }

  static async findById(id: string): Promise<KnowledgeBaseWithStats | undefined> {
    const result = await queryOne<any>(
      `SELECT 
         kb.*,
         COUNT(DISTINCT e.entry_id) as entry_count,
         COUNT(DISTINCT c.agent_id) as contributor_count
       FROM ${this.TABLE_NAME} kb
       LEFT JOIN ${this.ENTRIES_TABLE} e ON kb.id = e.kb_id
       LEFT JOIN ${this.CONTRIBUTORS_TABLE} c ON kb.id = c.kb_id
       WHERE kb.id = ?
       GROUP BY kb.id`,
      [id]
    );

    if (!result) return undefined;
    return this.mapToKnowledgeBaseWithStats(result);
  }

  static async findByDomain(domain: string): Promise<KnowledgeBaseWithStats[]> {
    const results = await query<any>(
      `SELECT 
         kb.*,
         COUNT(DISTINCT e.entry_id) as entry_count,
         COUNT(DISTINCT c.agent_id) as contributor_count
       FROM ${this.TABLE_NAME} kb
       LEFT JOIN ${this.ENTRIES_TABLE} e ON kb.id = e.kb_id
       LEFT JOIN ${this.CONTRIBUTORS_TABLE} c ON kb.id = c.kb_id
       WHERE kb.domain = ?
       GROUP BY kb.id
       ORDER BY kb.last_updated DESC`,
      [domain]
    );

    return results.map(this.mapToKnowledgeBaseWithStats);
  }

  static async findByExpertise(expertise: string): Promise<KnowledgeBaseWithStats[]> {
    const results = await query<any>(
      `SELECT 
         kb.*,
         COUNT(DISTINCT e.entry_id) as entry_count,
         COUNT(DISTINCT c.agent_id) as contributor_count
       FROM ${this.TABLE_NAME} kb
       LEFT JOIN ${this.ENTRIES_TABLE} e ON kb.id = e.kb_id
       LEFT JOIN ${this.CONTRIBUTORS_TABLE} c ON kb.id = c.kb_id
       WHERE json_extract(kb.expertise, '$') LIKE ?
       GROUP BY kb.id
       ORDER BY kb.last_updated DESC`,
      [`%"${expertise}"%`]
    );

    return results.map(this.mapToKnowledgeBaseWithStats);
  }

  static async findAll(limit: number = 100): Promise<KnowledgeBaseWithStats[]> {
    const results = await query<any>(
      `SELECT 
         kb.*,
         COUNT(DISTINCT e.entry_id) as entry_count,
         COUNT(DISTINCT c.agent_id) as contributor_count
       FROM ${this.TABLE_NAME} kb
       LEFT JOIN ${this.ENTRIES_TABLE} e ON kb.id = e.kb_id
       LEFT JOIN ${this.CONTRIBUTORS_TABLE} c ON kb.id = c.kb_id
       GROUP BY kb.id
       ORDER BY kb.last_updated DESC
       LIMIT ?`,
      [limit]
    );

    return results.map(this.mapToKnowledgeBaseWithStats);
  }

  static async update(id: string, updates: Partial<KnowledgeBase>): Promise<boolean> {
    const fields: string[] = ['last_updated = CURRENT_TIMESTAMP'];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.domain !== undefined) {
      fields.push('domain = ?');
      values.push(updates.domain);
    }
    if (updates.expertise !== undefined) {
      fields.push('expertise = ?');
      values.push(JSON.stringify(updates.expertise));
    }

    values.push(id);
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return result.changes > 0;
  }

  static async addEntry(kbId: string, entryId: string): Promise<boolean> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      // Add entry
      const insertStmt = conn.prepare(
        `INSERT OR IGNORE INTO ${this.ENTRIES_TABLE} (kb_id, entry_id) VALUES (?, ?)`
      );
      insertStmt.run(kbId, entryId);

      // Update last_updated timestamp
      const updateStmt = conn.prepare(
        `UPDATE ${this.TABLE_NAME} SET last_updated = CURRENT_TIMESTAMP WHERE id = ?`
      );
      const result = updateStmt.run(kbId);

      return result.changes > 0;
    });
  }

  static async addEntries(kbId: string, entryIds: string[]): Promise<number> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      const insertStmt = conn.prepare(
        `INSERT OR IGNORE INTO ${this.ENTRIES_TABLE} (kb_id, entry_id) VALUES (?, ?)`
      );

      let added = 0;
      for (const entryId of entryIds) {
        const result = insertStmt.run(kbId, entryId);
        if (result.changes > 0) added++;
      }

      // Update last_updated timestamp
      const updateStmt = conn.prepare(
        `UPDATE ${this.TABLE_NAME} SET last_updated = CURRENT_TIMESTAMP WHERE id = ?`
      );
      updateStmt.run(kbId);

      return added;
    });
  }

  static async removeEntry(kbId: string, entryId: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.ENTRIES_TABLE} WHERE kb_id = ? AND entry_id = ?`,
      [kbId, entryId]
    );
    return result.changes > 0;
  }

  static async addContributor(kbId: string, agentId: string): Promise<boolean> {
    const result = await execute(
      `INSERT OR IGNORE INTO ${this.CONTRIBUTORS_TABLE} (kb_id, agent_id) VALUES (?, ?)`,
      [kbId, agentId]
    );
    return result.changes > 0;
  }

  static async getEntries(kbId: string, limit: number = 100): Promise<SwarmMemoryEntry[]> {
    const results = await query<any>(
      `SELECT m.* FROM swarm_memory_entries m
       JOIN ${this.ENTRIES_TABLE} e ON m.id = e.entry_id
       WHERE e.kb_id = ?
       ORDER BY m.timestamp DESC
       LIMIT ?`,
      [kbId, limit]
    );

    // Import the memory model mapper
    const { MemoryModel } = await import('./memory');
    return results.map((row: any) => (MemoryModel as any).mapToMemoryEntry(row));
  }

  static async getContributors(kbId: string): Promise<{ agentId: string; contributedAt: Date }[]> {
    const results = await query<any>(
      `SELECT agent_id, contributed_at FROM ${this.CONTRIBUTORS_TABLE} 
       WHERE kb_id = ?
       ORDER BY contributed_at DESC`,
      [kbId]
    );

    return results.map(row => ({
      agentId: row.agent_id,
      contributedAt: new Date(row.contributed_at)
    }));
  }

  static async delete(id: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  static async getStatistics(): Promise<{
    totalKnowledgeBases: number;
    totalEntries: number;
    totalContributors: number;
    avgEntriesPerKB: number;
    topDomains: Array<{ domain: string; count: number }>;
  }> {
    const db = getDatabase();
    return db.withConnection(async (conn) => {
      const statsStmt = conn.prepare(`
        SELECT 
          COUNT(DISTINCT kb.id) as total_kbs,
          COUNT(DISTINCT e.entry_id) as total_entries,
          COUNT(DISTINCT c.agent_id) as total_contributors,
          CAST(COUNT(DISTINCT e.entry_id) AS REAL) / NULLIF(COUNT(DISTINCT kb.id), 0) as avg_entries
        FROM ${this.TABLE_NAME} kb
        LEFT JOIN ${this.ENTRIES_TABLE} e ON kb.id = e.kb_id
        LEFT JOIN ${this.CONTRIBUTORS_TABLE} c ON kb.id = c.kb_id
      `);
      const stats = statsStmt.get() as any;

      const domainStmt = conn.prepare(`
        SELECT domain, COUNT(*) as count
        FROM ${this.TABLE_NAME}
        WHERE domain IS NOT NULL
        GROUP BY domain
        ORDER BY count DESC
        LIMIT 5
      `);
      const domains = domainStmt.all() as any[];

      return {
        totalKnowledgeBases: stats.total_kbs || 0,
        totalEntries: stats.total_entries || 0,
        totalContributors: stats.total_contributors || 0,
        avgEntriesPerKB: stats.avg_entries || 0,
        topDomains: domains.map(d => ({ domain: d.domain, count: d.count }))
      };
    });
  }

  private static mapToKnowledgeBaseWithStats(row: any): KnowledgeBaseWithStats {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      domain: row.domain,
      expertise: JSON.parse(row.expertise || '[]'),
      createdAt: new Date(row.created_at),
      lastUpdated: new Date(row.last_updated),
      entryCount: row.entry_count || 0,
      contributorCount: row.contributor_count || 0
    };
  }
}