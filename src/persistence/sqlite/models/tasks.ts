import { execute, query, queryOne, getDatabase } from '../database';

export interface Task {
  id: string;
  type: string;
  description?: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  priority: number;
  dependencies: string[]; // Stored as JSON
  metadata: Record<string, any>; // Stored as JSON
  assignedAgent?: string;
  progress: number;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
}

export interface TaskDependency {
  taskId: string;
  dependsOnId: string;
  satisfied: boolean;
}

export class TaskModel {
  private static readonly TABLE_NAME = 'tasks';

  static async create(task: Omit<Task, 'createdAt' | 'startedAt' | 'completedAt'>): Promise<string> {
    await execute(
      `INSERT INTO ${this.TABLE_NAME} 
       (id, type, description, status, priority, dependencies, metadata, 
        assigned_agent, progress, error, retry_count, max_retries, timeout_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.type,
        task.description,
        task.status,
        task.priority,
        JSON.stringify(task.dependencies),
        JSON.stringify(task.metadata),
        task.assignedAgent,
        task.progress,
        task.error,
        task.retryCount,
        task.maxRetries,
        task.timeoutMs
      ]
    );

    return task.id;
  }

  static async findById(id: string): Promise<Task | undefined> {
    const result = await queryOne<any>(
      `SELECT * FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );

    if (!result) return undefined;
    return this.mapToTask(result);
  }

  static async findByStatus(status: Task['status'], limit: number = 100): Promise<Task[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE status = ?
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`,
      [status, limit]
    );

    return results.map(this.mapToTask);
  }

  static async findPending(limit: number = 50): Promise<Task[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE status = 'pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`,
      [limit]
    );

    return results.map(this.mapToTask);
  }

  static async findByAgent(agentId: string): Promise<Task[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE assigned_agent = ?
       ORDER BY status, priority DESC`,
      [agentId]
    );

    return results.map(this.mapToTask);
  }

  static async findWithUnsatisfiedDependencies(): Promise<Task[]> {
    const results = await query<any>(
      `SELECT t.* FROM ${this.TABLE_NAME} t
       WHERE t.status = 'pending'
       AND EXISTS (
         SELECT 1 FROM json_each(t.dependencies) d
         JOIN ${this.TABLE_NAME} dep ON dep.id = d.value
         WHERE dep.status != 'completed'
       )`
    );

    return results.map(this.mapToTask);
  }

  static async findReadyToExecute(): Promise<Task[]> {
    const results = await query<any>(
      `SELECT t.* FROM ${this.TABLE_NAME} t
       WHERE t.status = 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM json_each(t.dependencies) d
         JOIN ${this.TABLE_NAME} dep ON dep.id = d.value
         WHERE dep.status != 'completed'
       )
       ORDER BY t.priority DESC, t.created_at ASC`
    );

    return results.map(this.mapToTask);
  }

  static async update(id: string, updates: Partial<Task>): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.assignedAgent !== undefined) {
      fields.push('assigned_agent = ?');
      values.push(updates.assignedAgent);
    }
    if (updates.progress !== undefined) {
      fields.push('progress = ?');
      values.push(updates.progress);
    }
    if (updates.error !== undefined) {
      fields.push('error = ?');
      values.push(updates.error);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.retryCount !== undefined) {
      fields.push('retry_count = ?');
      values.push(updates.retryCount);
    }
    if (updates.startedAt !== undefined) {
      fields.push('started_at = ?');
      values.push(updates.startedAt?.toISOString());
    }
    if (updates.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completedAt?.toISOString());
    }

    if (fields.length === 0) return false;

    values.push(id);
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return result.changes > 0;
  }

  static async assignToAgent(taskId: string, agentId: string): Promise<boolean> {
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} 
       SET assigned_agent = ?, status = 'assigned', started_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
      [agentId, taskId]
    );

    return result.changes > 0;
  }

  static async markInProgress(taskId: string): Promise<boolean> {
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} 
       SET status = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND status IN ('assigned', 'pending')`,
      [taskId]
    );

    return result.changes > 0;
  }

  static async markCompleted(taskId: string): Promise<boolean> {
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} 
       SET status = 'completed', progress = 100, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [taskId]
    );

    return result.changes > 0;
  }

  static async markFailed(taskId: string, error: string): Promise<boolean> {
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} 
       SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [error, taskId]
    );

    return result.changes > 0;
  }

  static async incrementRetry(taskId: string): Promise<boolean> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      const task = await this.findById(taskId);
      if (!task) return false;

      if (task.retryCount >= task.maxRetries) {
        return this.markFailed(taskId, 'Max retries exceeded');
      }

      const stmt = conn.prepare(
        `UPDATE ${this.TABLE_NAME} 
         SET retry_count = retry_count + 1, status = 'pending', error = NULL
         WHERE id = ?`
      );
      const result = stmt.run(taskId);

      return result.changes > 0;
    });
  }

  static async delete(id: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  static async getStatsByStatus(): Promise<Record<Task['status'], number>> {
    const results = await query<any>(
      `SELECT status, COUNT(*) as count
       FROM ${this.TABLE_NAME}
       GROUP BY status`
    );

    const stats: Record<Task['status'], number> = {
      pending: 0,
      assigned: 0,
      in_progress: 0,
      completed: 0,
      failed: 0
    };

    results.forEach(row => {
      stats[row.status as Task['status']] = row.count;
    });

    return stats;
  }

  static async getPerformanceMetrics(): Promise<{
    averageCompletionTime: number;
    successRate: number;
    averageRetries: number;
  }> {
    const result = await queryOne<any>(
      `SELECT 
         AVG(CASE 
           WHEN completed_at IS NOT NULL AND started_at IS NOT NULL 
           THEN (julianday(completed_at) - julianday(started_at)) * 86400000
           ELSE NULL
         END) as avg_completion_time,
         CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS REAL) / 
         NULLIF(SUM(CASE WHEN status IN ('completed', 'failed') THEN 1 ELSE 0 END), 0) * 100 as success_rate,
         AVG(retry_count) as avg_retries
       FROM ${this.TABLE_NAME}`
    );

    return {
      averageCompletionTime: result?.avg_completion_time || 0,
      successRate: result?.success_rate || 0,
      averageRetries: result?.avg_retries || 0
    };
  }

  static async cleanupOldTasks(daysToKeep: number = 30): Promise<number> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME}
       WHERE status IN ('completed', 'failed')
       AND completed_at < datetime('now', '-' || ? || ' days')`,
      [daysToKeep]
    );

    return result.changes;
  }

  private static mapToTask(row: any): Task {
    return {
      id: row.id,
      type: row.type,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dependencies: JSON.parse(row.dependencies || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      assignedAgent: row.assigned_agent,
      progress: row.progress,
      error: row.error,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      timeoutMs: row.timeout_ms
    };
  }
}