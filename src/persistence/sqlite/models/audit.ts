import { execute, query, queryOne } from '../database';

export interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  userId: string;
  action: string;
  details?: Record<string, any>; // Stored as JSON
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export interface AuditSearchOptions {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class AuditModel {
  private static readonly TABLE_NAME = 'audit_log';

  static async create(audit: Omit<AuditLog, 'timestamp'>): Promise<string> {
    await execute(
      `INSERT INTO ${this.TABLE_NAME} 
       (id, entity_type, entity_id, user_id, action, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        audit.id,
        audit.entityType,
        audit.entityId,
        audit.userId,
        audit.action,
        audit.details ? JSON.stringify(audit.details) : null,
        audit.ipAddress,
        audit.userAgent
      ]
    );

    return audit.id;
  }

  static async findById(id: string): Promise<AuditLog | undefined> {
    const result = await queryOne<any>(
      `SELECT * FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );

    if (!result) return undefined;
    return this.mapToAuditLog(result);
  }

  static async findByEntity(entityType: string, entityId: string, limit: number = 100): Promise<AuditLog[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [entityType, entityId, limit]
    );

    return results.map(this.mapToAuditLog);
  }

  static async findByUser(userId: string, limit: number = 100): Promise<AuditLog[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [userId, limit]
    );

    return results.map(this.mapToAuditLog);
  }

  static async search(options: AuditSearchOptions): Promise<AuditLog[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.entityType) {
      conditions.push('entity_type = ?');
      params.push(options.entityType);
    }

    if (options.entityId) {
      conditions.push('entity_id = ?');
      params.push(options.entityId);
    }

    if (options.userId) {
      conditions.push('user_id = ?');
      params.push(options.userId);
    }

    if (options.action) {
      conditions.push('action = ?');
      params.push(options.action);
    }

    if (options.startDate) {
      conditions.push('timestamp >= ?');
      params.push(options.startDate.toISOString());
    }

    if (options.endDate) {
      conditions.push('timestamp <= ?');
      params.push(options.endDate.toISOString());
    }

    let query = `SELECT * FROM ${this.TABLE_NAME}`;
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY timestamp DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const results = await query<any>(query, params);
    return results.map(this.mapToAuditLog);
  }

  static async getEntityHistory(
    entityType: string, 
    entityId: string
  ): Promise<Array<{
    action: string;
    userId: string;
    timestamp: Date;
    changes?: Record<string, any>;
  }>> {
    const results = await query<any>(
      `SELECT action, user_id, timestamp, details
       FROM ${this.TABLE_NAME}
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY timestamp ASC`,
      [entityType, entityId]
    );

    return results.map(row => ({
      action: row.action,
      userId: row.user_id,
      timestamp: new Date(row.timestamp),
      changes: row.details ? JSON.parse(row.details) : undefined
    }));
  }

  static async getUserActivity(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{
    date: string;
    actions: Record<string, number>;
    totalActions: number;
  }>> {
    const results = await query<any>(
      `SELECT 
         DATE(timestamp) as date,
         action,
         COUNT(*) as count
       FROM ${this.TABLE_NAME}
       WHERE user_id = ?
         AND timestamp >= ?
         AND timestamp <= ?
       GROUP BY DATE(timestamp), action
       ORDER BY date DESC`,
      [userId, startDate.toISOString(), endDate.toISOString()]
    );

    // Group by date
    const activityByDate = new Map<string, { actions: Record<string, number>; totalActions: number }>();
    
    results.forEach(row => {
      const date = row.date;
      if (!activityByDate.has(date)) {
        activityByDate.set(date, { actions: {}, totalActions: 0 });
      }
      
      const dayActivity = activityByDate.get(date)!;
      dayActivity.actions[row.action] = row.count;
      dayActivity.totalActions += row.count;
    });

    return Array.from(activityByDate.entries()).map(([date, activity]) => ({
      date,
      ...activity
    }));
  }

  static async getActionStatistics(
    startDate?: Date,
    endDate?: Date
  ): Promise<Record<string, number>> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (startDate) {
      conditions.push('timestamp >= ?');
      params.push(startDate.toISOString());
    }

    if (endDate) {
      conditions.push('timestamp <= ?');
      params.push(endDate.toISOString());
    }

    let sql = `SELECT action, COUNT(*) as count FROM ${this.TABLE_NAME}`;
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' GROUP BY action ORDER BY count DESC';

    const results = await query<any>(sql, params);
    
    const statistics: Record<string, number> = {};
    results.forEach(row => {
      statistics[row.action] = row.count;
    });

    return statistics;
  }

  static async getEntityTypeStatistics(): Promise<Record<string, number>> {
    const results = await query<any>(
      `SELECT entity_type, COUNT(*) as count
       FROM ${this.TABLE_NAME}
       GROUP BY entity_type
       ORDER BY count DESC`
    );

    const statistics: Record<string, number> = {};
    results.forEach(row => {
      statistics[row.entity_type] = row.count;
    });

    return statistics;
  }

  static async cleanupOld(daysToKeep: number = 90): Promise<number> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME}
       WHERE timestamp < datetime('now', '-' || ? || ' days')`,
      [daysToKeep]
    );

    return result.changes;
  }

  static async getRecentActivity(minutes: number = 60): Promise<{
    totalActions: number;
    uniqueUsers: number;
    topActions: Array<{ action: string; count: number }>;
    topEntityTypes: Array<{ entityType: string; count: number }>;
  }> {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    const totalResult = await queryOne<any>(
      `SELECT COUNT(*) as count FROM ${this.TABLE_NAME} WHERE timestamp > ?`,
      [cutoff]
    );

    const usersResult = await queryOne<any>(
      `SELECT COUNT(DISTINCT user_id) as count FROM ${this.TABLE_NAME} WHERE timestamp > ?`,
      [cutoff]
    );

    const topActionsResults = await query<any>(
      `SELECT action, COUNT(*) as count
       FROM ${this.TABLE_NAME}
       WHERE timestamp > ?
       GROUP BY action
       ORDER BY count DESC
       LIMIT 5`,
      [cutoff]
    );

    const topEntityTypesResults = await query<any>(
      `SELECT entity_type, COUNT(*) as count
       FROM ${this.TABLE_NAME}
       WHERE timestamp > ?
       GROUP BY entity_type
       ORDER BY count DESC
       LIMIT 5`,
      [cutoff]
    );

    return {
      totalActions: totalResult?.count || 0,
      uniqueUsers: usersResult?.count || 0,
      topActions: topActionsResults.map(r => ({ action: r.action, count: r.count })),
      topEntityTypes: topEntityTypesResults.map(r => ({ entityType: r.entity_type, count: r.count }))
    };
  }

  static async createBulk(audits: Array<Omit<AuditLog, 'timestamp'>>): Promise<number> {
    let created = 0;

    for (const audit of audits) {
      try {
        await this.create(audit);
        created++;
      } catch (error) {
        console.error('Failed to create audit log:', error);
      }
    }

    return created;
  }

  static async exportToCSV(
    options: AuditSearchOptions
  ): Promise<string> {
    const logs = await this.search(options);
    
    const headers = ['ID', 'Entity Type', 'Entity ID', 'User ID', 'Action', 'Details', 'IP Address', 'User Agent', 'Timestamp'];
    const rows = logs.map(log => [
      log.id,
      log.entityType,
      log.entityId,
      log.userId,
      log.action,
      log.details ? JSON.stringify(log.details) : '',
      log.ipAddress || '',
      log.userAgent || '',
      log.timestamp.toISOString()
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    return csv;
  }

  private static mapToAuditLog(row: any): AuditLog {
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      userId: row.user_id,
      action: row.action,
      details: row.details ? JSON.parse(row.details) : undefined,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      timestamp: new Date(row.timestamp)
    };
  }

  // Helper method for creating audit logs
  static async log(
    entityType: string,
    entityId: string,
    userId: string,
    action: string,
    details?: Record<string, any>,
    request?: { ip?: string; userAgent?: string }
  ): Promise<string> {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return this.create({
      id,
      entityType,
      entityId,
      userId,
      action,
      details,
      ipAddress: request?.ip,
      userAgent: request?.userAgent
    });
  }
}