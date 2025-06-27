import { Database } from '../database';
import { execute, query, queryOne, getDatabase } from '../database';

export interface Agent {
  id: string;
  type: 'researcher' | 'developer' | 'analyzer' | 'coordinator' | 'reviewer';
  name: string;
  status: 'idle' | 'busy' | 'failed' | 'completed' | 'active';
  capabilities: string[]; // Stored as JSON
  systemPrompt?: string;
  maxConcurrentTasks: number;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentMetrics {
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalDurationMs: number;
  lastActivity: Date;
}

export interface AgentWithMetrics extends Agent {
  metrics: AgentMetrics;
}

export class AgentModel {
  private static readonly TABLE_NAME = 'agents';
  private static readonly METRICS_TABLE = 'agent_metrics';

  static async create(agent: Omit<Agent, 'createdAt' | 'updatedAt'>): Promise<string> {
    const result = await execute(
      `INSERT INTO ${this.TABLE_NAME} 
       (id, type, name, status, capabilities, system_prompt, max_concurrent_tasks, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agent.id,
        agent.type,
        agent.name,
        agent.status,
        JSON.stringify(agent.capabilities),
        agent.systemPrompt,
        agent.maxConcurrentTasks,
        agent.priority
      ]
    );

    // Initialize metrics
    await execute(
      `INSERT INTO ${this.METRICS_TABLE} (agent_id) VALUES (?)`,
      [agent.id]
    );

    return agent.id;
  }

  static async findById(id: string): Promise<AgentWithMetrics | undefined> {
    const result = await queryOne<any>(
      `SELECT 
         a.*,
         m.tasks_completed,
         m.tasks_failed,
         m.total_duration_ms,
         m.last_activity
       FROM ${this.TABLE_NAME} a
       LEFT JOIN ${this.METRICS_TABLE} m ON a.id = m.agent_id
       WHERE a.id = ?`,
      [id]
    );

    if (!result) return undefined;

    return this.mapToAgentWithMetrics(result);
  }

  static async findByType(type: Agent['type']): Promise<AgentWithMetrics[]> {
    const results = await query<any>(
      `SELECT 
         a.*,
         m.tasks_completed,
         m.tasks_failed,
         m.total_duration_ms,
         m.last_activity
       FROM ${this.TABLE_NAME} a
       LEFT JOIN ${this.METRICS_TABLE} m ON a.id = m.agent_id
       WHERE a.type = ?`,
      [type]
    );

    return results.map(this.mapToAgentWithMetrics);
  }

  static async findByStatus(status: Agent['status']): Promise<AgentWithMetrics[]> {
    const results = await query<any>(
      `SELECT 
         a.*,
         m.tasks_completed,
         m.tasks_failed,
         m.total_duration_ms,
         m.last_activity
       FROM ${this.TABLE_NAME} a
       LEFT JOIN ${this.METRICS_TABLE} m ON a.id = m.agent_id
       WHERE a.status = ?`,
      [status]
    );

    return results.map(this.mapToAgentWithMetrics);
  }

  static async findAvailable(limit: number = 10): Promise<AgentWithMetrics[]> {
    const results = await query<any>(
      `SELECT 
         a.*,
         m.tasks_completed,
         m.tasks_failed,
         m.total_duration_ms,
         m.last_activity
       FROM ${this.TABLE_NAME} a
       LEFT JOIN ${this.METRICS_TABLE} m ON a.id = m.agent_id
       WHERE a.status = 'idle'
       ORDER BY a.priority DESC, m.tasks_completed DESC
       LIMIT ?`,
      [limit]
    );

    return results.map(this.mapToAgentWithMetrics);
  }

  static async update(id: string, updates: Partial<Agent>): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.capabilities !== undefined) {
      fields.push('capabilities = ?');
      values.push(JSON.stringify(updates.capabilities));
    }
    if (updates.systemPrompt !== undefined) {
      fields.push('system_prompt = ?');
      values.push(updates.systemPrompt);
    }
    if (updates.maxConcurrentTasks !== undefined) {
      fields.push('max_concurrent_tasks = ?');
      values.push(updates.maxConcurrentTasks);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }

    if (fields.length === 0) return false;

    values.push(id);
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return result.changes > 0;
  }

  static async updateMetrics(
    agentId: string,
    updates: Partial<AgentMetrics>
  ): Promise<boolean> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      // Get current metrics
      const stmt = conn.prepare(
        `SELECT * FROM ${this.METRICS_TABLE} WHERE agent_id = ?`
      );
      const current = stmt.get(agentId) as any;

      if (!current) {
        // Create metrics if they don't exist
        const insertStmt = conn.prepare(
          `INSERT INTO ${this.METRICS_TABLE} 
           (agent_id, tasks_completed, tasks_failed, total_duration_ms)
           VALUES (?, ?, ?, ?)`
        );
        insertStmt.run(
          agentId,
          updates.tasksCompleted || 0,
          updates.tasksFailed || 0,
          updates.totalDurationMs || 0
        );
        return true;
      }

      // Update metrics
      const updateStmt = conn.prepare(
        `UPDATE ${this.METRICS_TABLE} 
         SET tasks_completed = ?,
             tasks_failed = ?,
             total_duration_ms = ?,
             last_activity = CURRENT_TIMESTAMP
         WHERE agent_id = ?`
      );

      const result = updateStmt.run(
        updates.tasksCompleted ?? current.tasks_completed,
        updates.tasksFailed ?? current.tasks_failed,
        updates.totalDurationMs ?? current.total_duration_ms,
        agentId
      );

      return result.changes > 0;
    });
  }

  static async incrementMetrics(
    agentId: string,
    taskCompleted: boolean,
    durationMs: number
  ): Promise<void> {
    await execute(
      `UPDATE ${this.METRICS_TABLE}
       SET tasks_completed = tasks_completed + ?,
           tasks_failed = tasks_failed + ?,
           total_duration_ms = total_duration_ms + ?,
           last_activity = CURRENT_TIMESTAMP
       WHERE agent_id = ?`,
      [
        taskCompleted ? 1 : 0,
        taskCompleted ? 0 : 1,
        durationMs,
        agentId
      ]
    );
  }

  static async delete(id: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  static async getPerformanceStats(): Promise<{
    totalAgents: number;
    activeAgents: number;
    totalTasksCompleted: number;
    totalTasksFailed: number;
    averageTaskDuration: number;
  }> {
    const result = await queryOne<any>(
      `SELECT 
         COUNT(DISTINCT a.id) as total_agents,
         COUNT(DISTINCT CASE WHEN a.status = 'active' THEN a.id END) as active_agents,
         SUM(m.tasks_completed) as total_tasks_completed,
         SUM(m.tasks_failed) as total_tasks_failed,
         AVG(CASE 
           WHEN m.tasks_completed > 0 
           THEN m.total_duration_ms / m.tasks_completed 
           ELSE 0 
         END) as average_task_duration
       FROM ${this.TABLE_NAME} a
       LEFT JOIN ${this.METRICS_TABLE} m ON a.id = m.agent_id`
    );

    return {
      totalAgents: result?.total_agents || 0,
      activeAgents: result?.active_agents || 0,
      totalTasksCompleted: result?.total_tasks_completed || 0,
      totalTasksFailed: result?.total_tasks_failed || 0,
      averageTaskDuration: result?.average_task_duration || 0
    };
  }

  private static mapToAgentWithMetrics(row: any): AgentWithMetrics {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      capabilities: JSON.parse(row.capabilities || '[]'),
      systemPrompt: row.system_prompt,
      maxConcurrentTasks: row.max_concurrent_tasks,
      priority: row.priority,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metrics: {
        agentId: row.id,
        tasksCompleted: row.tasks_completed || 0,
        tasksFailed: row.tasks_failed || 0,
        totalDurationMs: row.total_duration_ms || 0,
        lastActivity: new Date(row.last_activity || row.created_at)
      }
    };
  }
}